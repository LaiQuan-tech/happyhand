/**
 * flush-email-outbox — 每兩分鐘把 email_outbox 裡還沒寄出去的信寄掉。
 *
 * 為什麼需要這支：apps/web 排信之後會用 Next 的 after() 立刻試寄一次，
 * 大多數情況下客人幾秒內就收到。但 after() 沒有重試 ——
 * Resend 掛三十秒，那一批「設定密碼」信就永遠不會送達，而且哪裡都查不到。
 * 對「客人付了錢拿不到課」這件事，這不可接受。
 *
 * 這支就是那個重試迴圈。它與 web 端跑的是同一張表、同一套搶佔邏輯，
 * 兩邊同時跑不會重複寄：送出前用條件式 update（status 仍是 pending
 * 且 attempts 沒變）搶下那一列，搶不到就跳過。
 *
 * 沒有 RESEND_API_KEY 時 mailer 是 dry run，這支會把信標成 skipped
 * 而不是無限重試堆積。
 */

import type { JobContext, JobDefinition, JobResult } from "../lib/runner.js";
import { maskEmail } from "../lib/privacy.js";

/** 一輪最多處理幾封。Resend 免費方案約 2 req/s，mailer 本身還會再節流。 */
const BATCH = 20;

/** 重試上限。到頂標 failed，由 /admin 總覽顯示「有 N 封信寄不出去」。 */
const MAX_ATTEMPTS = 8;

interface OutboxRow {
  id: string;
  dedupe_key: string;
  to_email: string;
  subject: string;
  body_text: string;
  body_html: string;
  attempts: number;
}

/** 第 n 次失敗後隔多久再試（分鐘）。與 web 端的 backoff 一致。 */
function backoffMinutes(attempts: number): number {
  return Math.min(360, 2 ** Math.min(attempts, 8));
}

async function handler(ctx: JobContext): Promise<JobResult> {
  const { data, error } = await ctx.supabase
    .from("email_outbox")
    .select("id, dedupe_key, to_email, subject, body_text, body_html, attempts")
    .eq("status", "pending")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(BATCH);

  if (error) {
    ctx.log.error("outbox_read_failed", { message: error.message });
    return { read_failed: true };
  }

  const rows = (data ?? []) as OutboxRow[];
  if (rows.length === 0) return { pending: 0 };

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let exhausted = 0;

  for (const row of rows) {
    // 條件式搶佔。web 端的 after() 可能正在處理同一列。
    const { data: claimed } = await ctx.supabase
      .from("email_outbox")
      .update({
        attempts: row.attempts + 1,
        next_attempt_at: new Date(
          Date.now() + backoffMinutes(row.attempts + 1) * 60_000,
        ).toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .eq("attempts", row.attempts)
      .select("id")
      .maybeSingle();

    if (!claimed) {
      skipped += 1;
      continue;
    }

    const result = await ctx.mailer.send({
      to: row.to_email,
      subject: row.subject,
      text: row.body_text,
      html: row.body_html,
    });

    if (result.outcome === "failed") {
      const giveUp = row.attempts + 1 >= MAX_ATTEMPTS;
      await ctx.supabase
        .from("email_outbox")
        .update({
          status: giveUp ? "failed" : "pending",
          last_error: `attempt ${row.attempts + 1} failed`,
        })
        .eq("id", row.id);
      failed += 1;
      if (giveUp) {
        exhausted += 1;
        ctx.log.error("outbox_gave_up", {
          dedupe_key: row.dedupe_key,
          to: maskEmail(row.to_email),
          attempts: row.attempts + 1,
        });
      }
      continue;
    }

    // dry run 標 skipped 而不是 sent：本機沒有 API key 時不該讓它無限重試，
    // 但也不能謊稱寄出去了。
    await ctx.supabase
      .from("email_outbox")
      .update({
        status: result.outcome === "dry_run" ? "skipped" : "sent",
        sent_at: new Date().toISOString(),
        provider_id: result.id,
        last_error: null,
      })
      .eq("id", row.id);
    sent += 1;
  }

  if (sent > 0 || failed > 0) {
    ctx.log.info("outbox_flushed", { sent, failed, skipped, exhausted });
  }

  return { picked: rows.length, sent, failed, skipped, exhausted };
}

export const flushEmailOutboxJob: JobDefinition = {
  name: "flush-email-outbox",
  schedule: "*/2 * * * *",
  description: "每兩分鐘把 email_outbox 裡待寄的信寄出去，失敗指數退避重試",
  handler,
};

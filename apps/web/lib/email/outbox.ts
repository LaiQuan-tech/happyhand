import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { sendEmail, maskEmail, type EmailMessage } from "@/lib/email/resend";

/**
 * email_outbox —— 交易信的收件匣模式。
 *
 * 為什麼不直接在 route handler 裡呼叫 Resend：
 * Next 的 after() 沒有重試也沒有紀錄。Resend 掛 30 秒就會有一批人永遠收不到
 * 「設定密碼」信，而且任何地方都查不到。對「付了錢拿不到課」這件事不可接受。
 *
 * 流程：
 *   enqueue()（insert on conflict do nothing，dedupe_key 就是冪等保證）
 *   → after(() => flushOutbox()) 立刻試寄一次（>90% 的情況使用者秒收到）
 *   → 失敗則 backoff，由 worker 的 flush-email-outbox job 每 2 分鐘重試
 *
 * 這張表沒有 grant，只有 service role 進得去。
 */

/** 重試上限。到頂就標 failed，由 /admin 總覽顯示「有 N 封信寄不出去」。 */
const MAX_ATTEMPTS = 8;

/** 一次 flush 最多處理幾封。web 端只是「順手寄一下」，主力在 worker。 */
const FLUSH_BATCH = 5;

export type OutboxEntry = EmailMessage & {
  /** 冪等鍵，格式 <用途>:<實體 id>。同一把鑰匙只會寄一次。 */
  dedupeKey: string;
};

/** 第 n 次失敗後隔多久再試（分鐘）。指數退避，上限 6 小時。 */
function backoffMinutes(attempts: number): number {
  return Math.min(360, 2 ** Math.min(attempts, 8));
}

/**
 * 把信排進 outbox。
 *
 * 回傳 true 代表這封是**新排進去的**（可以接著 flush）；
 * false 代表 dedupe_key 已存在（之前排過了，不要重複寄）。
 *
 * ⚠️ 這支永不 throw。寄信失敗不該讓下單失敗 —— 與 /api/orders 的既有原則一致。
 */
export async function enqueueEmail(entry: OutboxEntry): Promise<boolean> {
  try {
    const db = createServiceClient();
    const { data, error } = await db
      .from("email_outbox")
      .upsert(
        {
          dedupe_key: entry.dedupeKey,
          to_email: entry.to,
          subject: entry.subject,
          body_text: entry.text,
          body_html: entry.html,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (error) {
      // 只記 message：error.details 可能帶上整列內容（含收件者 Email 與內文）
      console.error("[outbox] 排入失敗", entry.dedupeKey, error.message);
      return false;
    }

    // ignoreDuplicates 時，撞到既有 dedupe_key 會回 null（沒有新列）
    return data !== null;
  } catch (err) {
    console.error("[outbox] 排入例外", entry.dedupeKey, err);
    return false;
  }
}

/**
 * 掃 pending 並試寄。
 *
 * web 端用 after() 呼叫（不阻塞回應），worker 也會每 2 分鐘呼叫一次同樣的邏輯。
 * 兩邊同時跑不會重複寄：送出前先用 `.eq("status","pending")` 條件式搶佔那一列，
 * 搶不到就跳過（跟 transitionOrder 的冪等手法一樣）。
 */
export async function flushOutbox(limit = FLUSH_BATCH): Promise<{
  sent: number;
  failed: number;
  skipped: number;
}> {
  const tally = { sent: 0, failed: 0, skipped: 0 };

  try {
    const db = createServiceClient();
    const { data: rows, error } = await db
      .from("email_outbox")
      .select("id, dedupe_key, to_email, subject, body_text, body_html, attempts")
      .eq("status", "pending")
      .lte("next_attempt_at", new Date().toISOString())
      .order("next_attempt_at", { ascending: true })
      .limit(limit);

    if (error) {
      console.error("[outbox] 讀取待寄清單失敗", error.message);
      return tally;
    }
    if (!rows?.length) return tally;

    for (const row of rows) {
      // 條件式搶佔：把 next_attempt_at 推到未來，另一個 flush 就撈不到這列。
      // 影響 0 列 = 有人搶先了，跳過。
      const { data: claimed } = await db
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
        tally.skipped += 1;
        continue;
      }

      const result = await sendEmail({
        to: row.to_email,
        subject: row.subject,
        text: row.body_text,
        html: row.body_html,
      });

      if (result.outcome === "failed") {
        const exhausted = row.attempts + 1 >= MAX_ATTEMPTS;
        await db
          .from("email_outbox")
          .update({
            status: exhausted ? "failed" : "pending",
            last_error: result.error?.slice(0, 500) ?? "unknown",
          })
          .eq("id", row.id);
        tally.failed += 1;
        if (exhausted) {
          console.error(
            "[outbox] 放棄重試",
            row.dedupe_key,
            maskEmail(row.to_email),
            `attempts=${row.attempts + 1}`,
          );
        }
        continue;
      }

      // dry run 也標 sent：本機沒有 API key 時不該讓 outbox 無限重試堆積。
      // status = 'skipped' 留給「決定不寄」的情況（例如客人取消訂閱）。
      await db
        .from("email_outbox")
        .update({
          status: result.outcome === "dry_run" ? "skipped" : "sent",
          sent_at: new Date().toISOString(),
          provider_id: result.id,
          last_error: null,
        })
        .eq("id", row.id);
      tally.sent += 1;
    }
  } catch (err) {
    console.error("[outbox] flush 例外", err);
  }

  return tally;
}

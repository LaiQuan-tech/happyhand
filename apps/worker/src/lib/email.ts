/**
 * 寄信 — Resend HTTP API。
 *
 * 刻意不裝 `resend` 套件：只用到一個 POST endpoint，
 * Node 20 內建 fetch 就夠，少一個相依就少一個要維護的東西。
 *
 * 沒有設定 RESEND_API_KEY（或 WORKER_DRY_RUN=1）時 → dry run：
 * 只記 log 不真的寄出，收件者在 log 裡是遮罩過的。
 */

import type { WorkerEnv } from "./env.js";
import type { Logger } from "./logger.js";
import { serializeError } from "./logger.js";
import { maskEmail } from "./privacy.js";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;
/** Resend 免費方案約 2 req/s，保守一點排隊寄。 */
const SEND_INTERVAL_MS = 600;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export type SendOutcome = "sent" | "dry_run" | "failed";

export interface SendResult {
  outcome: SendOutcome;
  /** Resend 的訊息 id，dry run 或失敗時為 null */
  id: string | null;
}

export interface Mailer {
  /** 是否為 dry run 模式（沒 API key 或強制 dry run） */
  readonly dryRun: boolean;
  send(message: EmailMessage): Promise<SendResult>;
  /** 依序寄出並自動節流，回傳各狀態的計數。 */
  sendAll(messages: readonly EmailMessage[]): Promise<Record<SendOutcome, number>>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createMailer(env: WorkerEnv, log: Logger): Mailer {
  const apiKey = env.resendApiKey;
  const dryRun = apiKey === null || env.dryRun;

  async function postToResend(message: EmailMessage, key: string): Promise<SendResult> {
    const payload: Record<string, string | string[]> = {
      from: env.mailFrom,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    };
    if (env.mailReplyTo !== null) {
      payload["reply_to"] = env.mailReplyTo;
    }

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const bodyText = await response.text();

    if (!response.ok) {
      log.error("email_send_failed", {
        to: maskEmail(message.to),
        subject: message.subject,
        status: response.status,
        // Resend 的錯誤 body 不含收件者資料，可以整段留著協助除錯
        body: bodyText.slice(0, 500),
      });
      return { outcome: "failed", id: null };
    }

    let id: string | null = null;
    try {
      const parsed: unknown = JSON.parse(bodyText);
      if (typeof parsed === "object" && parsed !== null) {
        const maybeId: unknown = (parsed as Record<string, unknown>)["id"];
        if (typeof maybeId === "string") id = maybeId;
      }
    } catch {
      // 寄成功但 body 解析失敗不影響結果，id 留 null
    }

    log.info("email_sent", {
      to: maskEmail(message.to),
      subject: message.subject,
      resend_id: id,
    });
    return { outcome: "sent", id };
  }

  async function send(message: EmailMessage): Promise<SendResult> {
    if (dryRun || apiKey === null) {
      log.info("email_dry_run", {
        to: maskEmail(message.to),
        subject: message.subject,
        reason: env.dryRun ? "WORKER_DRY_RUN" : "RESEND_API_KEY_not_set",
        // 內文長度而不是內文本身：內文含姓名與課程資訊，不進 log
        text_length: message.text.length,
      });
      return { outcome: "dry_run", id: null };
    }

    try {
      return await postToResend(message, apiKey);
    } catch (err) {
      log.error("email_send_error", {
        to: maskEmail(message.to),
        subject: message.subject,
        ...serializeError(err),
      });
      return { outcome: "failed", id: null };
    }
  }

  async function sendAll(
    messages: readonly EmailMessage[],
  ): Promise<Record<SendOutcome, number>> {
    const tally: Record<SendOutcome, number> = { sent: 0, dry_run: 0, failed: 0 };

    for (let i = 0; i < messages.length; i += 1) {
      const message = messages[i];
      if (message === undefined) continue;

      const result = await send(message);
      tally[result.outcome] += 1;

      // dry run 不打外部 API，不需要節流
      if (!dryRun && i < messages.length - 1) {
        await sleep(SEND_INTERVAL_MS);
      }
    }
    return tally;
  }

  return { dryRun, send, sendAll };
}

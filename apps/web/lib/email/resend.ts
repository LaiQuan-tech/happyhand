import "server-only";

/**
 * 寄信 — Resend HTTP API（web 端）。
 *
 * ⚠️ 這支是 apps/worker/src/lib/email.ts 的姊妹實作，**刻意抄一份而不是抽共用套件**：
 *    兩邊 runtime 不同（worker 是 ESM，import 要帶 .js 副檔名；web 走 Next 的
 *    bundler），硬共用得動 tsconfig 與 build 設定，而核心只有一個 POST。
 *    維持既有「刻意不裝 resend 套件」的決定 —— Node 內建 fetch 就夠。
 *    改這支的時候記得看一眼那一支，反之亦然。
 *
 * 寄件人用 noreply@gathertaiwan.com：Resend 帳號裡只有 gathertaiwan.com 與
 * realreal.cc 兩個網域通過驗證。Supabase Auth 現在寄驗證信也是用這個位址。
 *
 * ⚠️ 站的網域是 happyhands.com.tw，但**不要**直接把寄件人改成
 *    @happyhands.com.tw —— 那個網域的 MX 指向 Google Workspace（客戶公司信箱
 *    在上面），要拿它寄信得先在 Resend 完成網域驗證並加 DKIM/SPF 紀錄，而
 *    現有的 SPF 已經有一筆 include，加錯會連客戶自己寄信都被判垃圾郵件。
 *    在那之前，寄件人與網站網域不同是正常的、也寄得出去。
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

export const MAIL_FROM =
  process.env.MAIL_FROM ?? "快樂手 Happy Healing Hands <noreply@gathertaiwan.com>";

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
  /** 失敗原因，寫進 email_outbox.last_error 供後台顯示 */
  error: string | null;
}

/** 沒設 RESEND_API_KEY 就是 dry run：本機開發不會亂寄信給真人。 */
export function isDryRun(): boolean {
  return !process.env.RESEND_API_KEY;
}

/**
 * 遮罩 Email。log 與上課教室的浮水印共用。
 *
 * 星號數量固定，不跟著原本的長度走：一來長度本身也是一點資訊，
 * 二來浮水印用的就是這支，`a****************@gmail.com` 那種一長串很難看。
 */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const name = email.slice(0, at);
  const domain = email.slice(at);
  // 兩碼以上的帳號留前兩碼比較認得出是誰，只有一碼的就留一碼
  const head = name.slice(0, name.length > 1 ? 2 : 1);
  return `${head}***${domain}`;
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(
      "[email] dry run（沒有 RESEND_API_KEY）",
      maskEmail(message.to),
      message.subject,
      // 內文長度而不是內文本身：內文含姓名與課程資訊，不進 log
      `text=${message.text.length}`,
    );
    return { outcome: "dry_run", id: null, error: null };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const bodyText = await response.text();

    if (!response.ok) {
      // Resend 的錯誤 body 不含收件者資料，可以留著協助除錯
      const error = `HTTP ${response.status} ${bodyText.slice(0, 300)}`;
      console.error("[email] 寄送失敗", maskEmail(message.to), error);
      return { outcome: "failed", id: null, error };
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

    console.info("[email] 已寄出", maskEmail(message.to), id ?? "(no id)");
    return { outcome: "sent", id, error: null };
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[email] 寄送例外", maskEmail(message.to), error);
    return { outcome: "failed", id: null, error };
  }
}

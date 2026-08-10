import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";
import { maskEmail } from "@/lib/email/resend";

/**
 * 訪客結帳自動建帳號。
 *
 * 台灣的線上課程平台（Hahow、PressPlay、知識衛星）全部要求「先註冊登入才能買」，
 * 好處是訂單天生綁帳號。但快樂手的客群是 60–75 歲，「註冊 → 收驗證信 → 回來買」
 * 三道關卡會掉一大截轉換。
 *
 * 所以走中間路線：訪客結帳流程完全不變（不擋單），但下單成功後用他填的 Email
 * 把帳號建起來、把訂單綁上去，再寄一封「設定密碼」信。客人想登入的時候就登入，
 * 不想登入也不影響他買東西。
 */

/** Admin API 的容忍時間。逾時就放棄綁定，交給 backfill 補（見 migration 的說明）。 */
const ADMIN_API_TIMEOUT_MS = 3_000;

export type ProvisionResult = {
  userId: string;
  /** true = 這個帳號是這一單新建的（只有新建才寄「設定密碼」信） */
  created: boolean;
};

/**
 * 收 PromiseLike 而不是 Promise：supabase-js 的 query builder 是 thenable
 * 但不是真的 Promise（沒有 catch/finally），直接丟進 Promise.race 型別過不了。
 */
function withTimeout<T>(work: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(work),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 逾時（${ms}ms）`)), ms),
    ),
  ]);
}

/**
 * 用 Email 找帳號，找不到就建一個。
 *
 * 回 null 代表「這次沒能綁定」——**呼叫端必須照樣讓訂單成立**。
 * 漏掉的 user_id 由 claim_guest_orders()（登入即認領）與
 * backfill_order_user_ids()（worker 每小時）自動補上，這一步失敗是自癒的。
 */
export async function findOrCreateUser(
  email: string,
  fullName: string,
): Promise<ProvisionResult | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  try {
    const db = createServiceClient();

    // 1. 先找。用 security definer RPC 而不是 admin.listUsers() ——
    //    後者是 O(全站帳號數)，不能放在結帳熱路徑上。
    const { data: existingId, error: findError } = await withTimeout(
      db.rpc("find_auth_user_id", { p_email: normalized }),
      ADMIN_API_TIMEOUT_MS,
      "find_auth_user_id",
    );

    if (findError) {
      console.error("[provision] 查帳號失敗", maskEmail(normalized), findError.message);
      return null;
    }
    if (typeof existingId === "string" && existingId) {
      return { userId: existingId, created: false };
    }

    // 2. 沒有就建。
    //
    // 🔴 email_confirm: true 是整個設計的關鍵依賴，不能改成 false。
    //    Supabase 的自動身分歸戶（之後用 Google / LINE 登入時，找相同 email 的
    //    既有帳號掛上去）**明文要求 email 已驗證**。設 false 的話長輩用 Google
    //    登入會變成第二個帳號，然後看不到自己買的課 —— 而且不會報錯。
    //
    //    把它當成已驗證的依據是：我們接著會寄一封「設定密碼」信到這個信箱，
    //    只有收得到信的人拿得到密碼。在那之前這個帳號是完全惰性的
    //    （沒有密碼可以被猜、沒有 session、沒有 entitlement）。
    //
    // 刻意不設密碼，理由同上。
    const { data: created, error: createError } = await withTimeout(
      db.auth.admin.createUser({
        email: normalized,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : {},
      }),
      ADMIN_API_TIMEOUT_MS,
      "createUser",
    );

    if (createError) {
      // 併發下單同一個 email 時可能兩邊都判定「不存在」，慢的那個會撞 email_exists。
      // 這不是錯誤，重查一次就好。
      const code = (createError as { code?: string }).code;
      if (code === "email_exists" || /already been registered/i.test(createError.message)) {
        const { data: retryId } = await db.rpc("find_auth_user_id", { p_email: normalized });
        if (typeof retryId === "string" && retryId) {
          return { userId: retryId, created: false };
        }
      }
      console.error("[provision] 建帳號失敗", maskEmail(normalized), createError.message);
      return null;
    }

    if (!created?.user?.id) return null;
    return { userId: created.user.id, created: true };
  } catch (err) {
    // 逾時走這裡。訂單照樣要成立。
    console.error("[provision] 例外", maskEmail(normalized), err);
    return null;
  }
}

/**
 * 產生「設定密碼」連結。
 *
 * 用 recovery 類型：對**無密碼帳號同樣有效**，所以「首次設定密碼」與
 * 「忘記密碼」可以共用同一種 token。
 *
 * ⚠️ 刻意不用回傳的 action_link —— 它指向 <ref>.supabase.co/auth/v1/verify，
 *    會多跳一次，而且網址列出現陌生的 supabase.co 會讓長輩懷疑是詐騙信。
 *    自己組成本站的 /auth/confirm。
 *
 * ⚠️ 走 token_hash 而不是 PKCE 的 ?code=：PKCE 的 code_verifier 綁在發起請求的
 *    那個瀏覽器，而長輩最典型的行為是「在手機 Gmail App 的內建瀏覽器點連結」，
 *    那不是他原本的 Safari。verifyOtp 不需要 code_verifier，任何瀏覽器都能開。
 */
export async function generateSetupLink(email: string): Promise<string | null> {
  try {
    const db = createServiceClient();
    const { data, error } = await withTimeout(
      db.auth.admin.generateLink({ type: "recovery", email: email.trim().toLowerCase() }),
      ADMIN_API_TIMEOUT_MS,
      "generateLink",
    );

    if (error || !data?.properties?.hashed_token) {
      console.error("[provision] 產生設定密碼連結失敗", maskEmail(email), error?.message);
      return null;
    }

    const url = new URL("/auth/confirm", SITE.url);
    url.searchParams.set("token_hash", data.properties.hashed_token);
    url.searchParams.set("type", "recovery");
    url.searchParams.set("next", "/reset-password");
    return url.toString();
  } catch (err) {
    console.error("[provision] 產生連結例外", maskEmail(email), err);
    return null;
  }
}

import "server-only";
import { cache } from "react";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

/**
 * 學員身分。lib/admin/guard.ts 的姊妹檔。
 *
 * 兩者刻意分開而不是共用一支：
 * 後台問的是「這個人是不是員工、有沒有某個能力」，
 * 會員中心問的是「這個人是誰、他買了什麼」。
 * 前者是能力矩陣，後者是資料歸屬，硬湊在一起只會兩邊都難讀。
 *
 * 授權模型也不一樣：後台靠 TS 層的 capability 檢查加 service role 寫入；
 * 會員中心**靠 RLS 本身**——orders_select_own、entitlements_select_own
 * 這些 policy 保證使用者只查得到自己的東西，所以這裡一律用 session client，
 * 完全不碰 service role。少一個能繞過權限的東西就少一個出事的方式。
 *
 * 唯一的例外是 /api/lessons/[id]/video：那裡要讀 course_lessons.youtube_id，
 * 而那一欄刻意沒有 grant 給 authenticated。所以那支會在**驗證完權限之後**
 * 才切到 service role 去拿 ID。
 */

export type Member = {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  birthYear: number | null;
};

export class MemberAuthError extends Error {
  constructor(
    message: string,
    readonly reason: "unauthenticated" | "unconfigured",
  ) {
    super(message);
    this.name = "MemberAuthError";
  }
}

/**
 * 目前登入的學員。未登入或環境變數沒設定都回 null，不 throw。
 *
 * 用 React.cache() 包起來的理由與 getStaff() 完全相同：
 * layout 與 page 會各自呼叫一次，不去重的話每個請求跑兩次 auth.getUser()。
 */
export const getMember = cache(async function getMember(): Promise<Member | null> {
  if (!hasSupabaseEnv()) return null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // profiles 查不到不算失敗：handle_new_user() trigger 會建，
    // 但萬一沒建成也不該把人擋在門外——他的訂單與課程在別的表裡，照樣看得到。
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, phone, birth_year")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[account/guard] 讀取 profile 失敗", error.message);
    }

    return {
      id: user.id,
      email: user.email ?? null,
      fullName: (data?.full_name as string | null) ?? null,
      phone: (data?.phone as string | null) ?? null,
      birthYear: (data?.birth_year as number | null) ?? null,
    };
  } catch (err) {
    console.error("[account/guard] getMember 例外", err);
    return null;
  }
});

/** 要求已登入，否則 throw。給 server action 與 route handler 用。 */
export async function requireMember(): Promise<Member> {
  const member = await getMember();
  if (!member) {
    throw new MemberAuthError("請先登入", "unauthenticated");
  }
  return member;
}

export function memberErrorMessage(err: unknown): string {
  if (err instanceof MemberAuthError) return err.message;
  if (err instanceof Error) return err.message;
  return "發生未預期的錯誤，請重試一次";
}

/**
 * 認領這個帳號名下的訪客訂單。
 *
 * 這一支是「用 Google／LINE 登入後看得到之前用同一個信箱下的單」真的成立的
 * 那一段。RPC 只認 email_confirmed_at 有值的帳號（見 migration 的紅字警告）。
 *
 * 每次進 /account 都跑一次：成本是一個 index scan，而漏跑的代價是
 * 客人看到空的「我的學習」然後打 LINE 來問。用 cache() 保證同一個請求只跑一次。
 */
export const claimGuestOrders = cache(async function claimGuestOrders(): Promise<number> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("claim_guest_orders");
    if (error) {
      console.error("[account/guard] claim_guest_orders 失敗", error.message);
      return 0;
    }
    return typeof data === "number" ? data : 0;
  } catch (err) {
    console.error("[account/guard] claim_guest_orders 例外", err);
    return 0;
  }
});

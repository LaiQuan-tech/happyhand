import "server-only";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import { can, toRole, isStaffRole, type Capability, type Role } from "@/lib/admin/roles";

/**
 * 後台授權。
 *
 * 這是計畫裡「第 3 層」——唯一不能少的一層。
 * middleware 只看有沒有登入（不查 DB），admin/layout.tsx 擋的是「進得了頁面嗎」，
 * 但 server action 的 POST 不會經過 layout 的 render，
 * 所以每一支寫入都必須自己再呼叫一次 requireCapability()。
 *
 * ⚠️ 與 goodday 不同：那邊有 requireAdmin()（throw）與 isAdminRequest()（boolean）
 *    兩份各自獨立的實作，原始碼註解說明那是既有爆炸半徑造成的取捨。
 *    快樂手從零開始，這裡只有一份查詢 getStaff()，另外兩支只是薄包裝。
 *    改授權邏輯只要改一個地方。
 *
 * 身分讀取刻意用使用者自己的 session client（受 RLS 保護）而不是 service role：
 * profiles_select_own 保證他只讀得到自己那一列，
 * 而 role 欄位已經由 20260810000001 的欄位級 grant 擋住不讓他自己寫。
 */

export type Staff = {
  id: string;
  email: string | null;
  role: Role;
};

export class AdminAuthError extends Error {
  constructor(
    message: string,
    readonly reason: "unauthenticated" | "forbidden" | "unconfigured",
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

/**
 * 目前登入者的員工身分。未登入、不是員工、或環境變數沒設定都回 null。
 * 不 throw —— 給 layout 與顯示層用。
 */
export async function getStaff(): Promise<Staff | null> {
  if (!hasSupabaseEnv()) return null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    // 查詢失敗一律當「不是員工」。這裡刻意不 fallback 成放行。
    if (error) {
      console.error("[admin/guard] 讀取 profile 失敗", error.message);
      return null;
    }

    const role = toRole(data?.role);
    if (!isStaffRole(role)) return null;

    return { id: user.id, email: user.email ?? null, role };
  } catch (err) {
    console.error("[admin/guard] getStaff 例外", err);
    return null;
  }
}

/**
 * 要求特定能力，不符合就 throw。給 server action 用。
 *
 * 用法：
 *   const staff = await requireCapability("orders:write");
 */
export async function requireCapability(cap: Capability): Promise<Staff> {
  const staff = await getStaff();

  if (!staff) {
    throw new AdminAuthError("請先登入", "unauthenticated");
  }
  if (!can(staff.role, cap)) {
    throw new AdminAuthError("你的帳號沒有這項權限", "forbidden");
  }
  return staff;
}

/**
 * 同上但不 throw，回 null。給 route handler 用
 * （route handler 要自己決定回 401 還是 403 與回應格式）。
 */
export async function checkCapability(cap: Capability): Promise<Staff | null> {
  const staff = await getStaff();
  if (!staff || !can(staff.role, cap)) return null;
  return staff;
}

/**
 * 把 AdminAuthError 轉成給使用者看的一句話。
 * 其他例外不吞掉——那是真的 bug，應該讓它冒上去。
 */
export function adminErrorMessage(err: unknown): string {
  if (err instanceof AdminAuthError) return err.message;
  if (err instanceof Error) return err.message;
  return "發生未預期的錯誤，請重試一次";
}

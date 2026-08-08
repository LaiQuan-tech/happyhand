/**
 * 手寫的資料列型別。
 *
 * 來源：design_handoff_happyhands/STACK.md §3「Supabase 資料模型（起手式）」。
 * 這些型別只涵蓋 worker 會讀到的欄位，不是完整 schema。
 *
 * ⚠️ 限制：這是手寫的，不是 `supabase gen types` 產出的，
 * 也就是說「schema 改了但這裡沒改」編譯期不會報錯，會在執行期才發現。
 * migration 定案後應改成產生型別，見 README「已知限制」。
 */

export type OrderStatus = "pending" | "paid" | "cancelled" | "refunded";
export type PaymentMethod = "credit" | "atm" | "manual";
export type SessionStatus = "open" | "full" | "closed" | "cancelled";

export interface WorkshopSessionRow {
  id: string;
  product_id: string | null;
  starts_at: string;
  ends_at: string;
  location: string | null;
  address: string | null;
  capacity: number;
  seats_taken: number;
  status: string | null;
}

export interface ProductRow {
  id: string;
  slug: string;
  title: string;
  type: string | null;
}

export interface OrderRow {
  id: string;
  /** 可為 null：電話／LINE 代訂（客服以 service role 建單），或會員已刪帳號 */
  user_id: string | null;
  order_no: string;
  status: string | null;
  payment_method: string | null;
  total: number;
  created_at: string;
  /** 結帳表單填的收件人姓名 */
  contact_name: string | null;
  /** 結帳表單填的 email — 提醒信的首選收件地址 */
  contact_email: string | null;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  session_id: string | null;
  qty: number | null;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  line_user_id: string | null;
}

/** 一位報名者：把 order + profile + auth email 併起來的結果。 */
export interface Attendee {
  /** 可為 null：電話／LINE 代訂沒有綁會員帳號 */
  userId: string | null;
  orderNo: string;
  /** 可能為 null：沒填 contact_email 且查不到 auth 帳號 → 需人工聯絡 */
  email: string | null;
  fullName: string | null;
  /** email 從哪來，方便查問題 */
  emailSource: "order_contact" | "auth_user" | "none";
}

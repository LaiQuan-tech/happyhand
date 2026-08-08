/**
 * 資料存取層。
 *
 * 所有 PostgREST 查詢集中在這裡，job 只呼叫具名函式、拿到具名型別。
 * 刻意不用 PostgREST 的 embedded select（`orders!inner(...)`）：
 *   1. embedded 查詢要靠 FK constraint 名稱，而 migration 由另一位負責，
 *      這裡不該對它的命名做假設；
 *   2. 這個規模（單場工作坊上限十幾人）多一次往返的成本可以忽略。
 * 改成分批查詢後在記憶體 join，行為好預測也好測。
 */

import type { ServiceClient, QueryError } from "./supabase.js";
import { describeError, isSchemaMissingError } from "./supabase.js";
import type {
  NotificationChannel,
  NotificationLogRow,
  OrderItemRow,
  OrderRow,
  ProductRow,
  ProfileRow,
  ReminderStage,
  WorkshopSessionRow,
} from "./types.js";

/** PostgREST 用 URL query 傳條件，`in.()` 太長會被 gateway 擋掉，因此分批。 */
const IN_CHUNK_SIZE = 50;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export class DbError extends Error {
  readonly code: string | undefined;
  readonly schemaMissing: boolean;
  readonly fields: Record<string, string>;

  constructor(operation: string, error: QueryError) {
    super(`${operation} failed: ${error.message}`);
    this.name = "DbError";
    this.code = error.code;
    this.schemaMissing = isSchemaMissingError(error);
    this.fields = describeError(error);
  }
}

/** supabase-js 回傳的 { data, error }；用最小介面避免綁死內部型別。 */
interface Result<T> {
  data: T | null;
  error: QueryError | null;
}

function unwrapRows<T>(operation: string, result: Result<T[]>): T[] {
  if (result.error !== null) throw new DbError(operation, result.error);
  return result.data ?? [];
}

// ---------------------------------------------------------------------------
// 1. 名額暫扣回收
// ---------------------------------------------------------------------------

/**
 * 呼叫 migration 提供的 `release_expired_seat_holds()`。
 *
 * ⚠️ 這個 function 的回傳形狀由 supabase/migrations 那邊決定，worker 這裡不做假設：
 * 可能是 integer（釋放筆數）、可能是 void（null）、也可能是 setof/table。
 * 因此做寬鬆解析，解析不出數字時回傳 null 並把原始形狀記進 log，
 * 而不是硬轉型然後在 log 裡印出 NaN。
 */
export async function releaseExpiredSeatHolds(
  client: ServiceClient,
): Promise<{ released: number | null; rawKind: string }> {
  const { data, error } = (await client.rpc("release_expired_seat_holds")) as Result<unknown>;
  if (error !== null) throw new DbError("rpc release_expired_seat_holds", error);

  return { released: coerceCount(data), rawKind: describeShape(data) };
}

function coerceCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value)) {
    // setof/table 回傳：優先看第一列有沒有數字欄位，否則以列數為準
    const first: unknown = value[0];
    const inner = coerceCountFromObject(first);
    return inner ?? value.length;
  }
  if (typeof value === "object" && value !== null) {
    return coerceCountFromObject(value);
  }
  return null;
}

function coerceCountFromObject(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ["released", "released_count", "count", "seats_released", "n"]) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string") {
      const parsed = Number.parseInt(candidate, 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function describeShape(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  return typeof value;
}

// ---------------------------------------------------------------------------
// 2. 工作坊場次與商品
// ---------------------------------------------------------------------------

const SESSION_COLUMNS =
  "id, product_id, starts_at, ends_at, location, address, capacity, seats_taken, status";

/** 取出 starts_at 落在 [startIso, endIso) 的場次；已取消的場次不回傳。 */
export async function findSessionsStartingBetween(
  client: ServiceClient,
  startIso: string,
  endIso: string,
): Promise<WorkshopSessionRow[]> {
  const result = (await client
    .from("workshop_sessions")
    .select(SESSION_COLUMNS)
    .gte("starts_at", startIso)
    .lt("starts_at", endIso)
    .neq("status", "cancelled")
    .order("starts_at", { ascending: true })) as Result<WorkshopSessionRow[]>;

  return unwrapRows("select workshop_sessions", result);
}

export async function findProductsByIds(
  client: ServiceClient,
  ids: readonly string[],
): Promise<Map<string, ProductRow>> {
  const out = new Map<string, ProductRow>();
  if (ids.length === 0) return out;

  for (const batch of chunk(ids, IN_CHUNK_SIZE)) {
    const result = (await client
      .from("products")
      .select("id, slug, title, type")
      .in("id", batch)) as Result<ProductRow[]>;

    for (const row of unwrapRows("select products", result)) {
      out.set(row.id, row);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 訂單 / 訂單項目 / 個人資料
// ---------------------------------------------------------------------------

export async function findOrderItemsBySessionIds(
  client: ServiceClient,
  sessionIds: readonly string[],
): Promise<OrderItemRow[]> {
  if (sessionIds.length === 0) return [];

  const out: OrderItemRow[] = [];
  for (const batch of chunk(sessionIds, IN_CHUNK_SIZE)) {
    const result = (await client
      .from("order_items")
      .select("id, order_id, product_id, session_id, qty")
      .in("session_id", batch)) as Result<OrderItemRow[]>;

    out.push(...unwrapRows("select order_items by session", result));
  }
  return out;
}

export async function findOrderItemsByOrderIds(
  client: ServiceClient,
  orderIds: readonly string[],
): Promise<OrderItemRow[]> {
  if (orderIds.length === 0) return [];

  const out: OrderItemRow[] = [];
  for (const batch of chunk(orderIds, IN_CHUNK_SIZE)) {
    const result = (await client
      .from("order_items")
      .select("id, order_id, product_id, session_id, qty")
      .in("order_id", batch)) as Result<OrderItemRow[]>;

    out.push(...unwrapRows("select order_items by order", result));
  }
  return out;
}

const ORDER_COLUMNS =
  "id, user_id, order_no, status, payment_method, total, created_at, contact_name, contact_email";

/** 依 id 取出已付款訂單（狀態過濾交給 DB，避免把未付款的資料拉進記憶體）。 */
export async function findPaidOrdersByIds(
  client: ServiceClient,
  orderIds: readonly string[],
): Promise<OrderRow[]> {
  if (orderIds.length === 0) return [];

  const out: OrderRow[] = [];
  for (const batch of chunk(orderIds, IN_CHUNK_SIZE)) {
    const result = (await client
      .from("orders")
      .select(ORDER_COLUMNS)
      .in("id", batch)
      .eq("status", "paid")) as Result<OrderRow[]>;

    out.push(...unwrapRows("select paid orders", result));
  }
  return out;
}

/** ATM 對帳用：付款方式 atm、狀態 pending、且建立時間早於 cutoff 的訂單。 */
export async function findStaleAtmOrders(
  client: ServiceClient,
  createdBeforeIso: string,
  limit: number,
): Promise<OrderRow[]> {
  const result = (await client
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("payment_method", "atm")
    .eq("status", "pending")
    .lt("created_at", createdBeforeIso)
    .order("created_at", { ascending: true })
    .limit(limit)) as Result<OrderRow[]>;

  return unwrapRows("select stale atm orders", result);
}

export async function findProfilesByIds(
  client: ServiceClient,
  userIds: readonly string[],
): Promise<Map<string, ProfileRow>> {
  const out = new Map<string, ProfileRow>();
  if (userIds.length === 0) return out;

  for (const batch of chunk(userIds, IN_CHUNK_SIZE)) {
    const result = (await client
      .from("profiles")
      .select("id, full_name, phone, line_user_id")
      .in("id", batch)) as Result<ProfileRow[]>;

    for (const row of unwrapRows("select profiles", result)) {
      out.set(row.id, row);
    }
  }
  return out;
}

/**
 * 取使用者 email —— **只在 orders.contact_email 是空的時候才需要走這裡**。
 *
 * email 存在 auth.users，PostgREST 讀不到，必須走 auth admin API，
 * 而 admin API 只能一次查一個人 → 逐一查詢。
 * 因為多數訂單結帳時就填了 contact_email，實際會落到這裡的人數很少。
 */
export async function fetchUserEmails(
  client: ServiceClient,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();

  for (const userId of userIds) {
    const response = await client.auth.admin.getUserById(userId);
    if (response.error !== null) continue;
    const email = response.data.user?.email;
    if (typeof email === "string" && email !== "") {
      out.set(userId, email);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. 通知寄送記錄（提醒信去重）
// ---------------------------------------------------------------------------

/**
 * Postgres 的 unique_violation。PostgREST 會把 SQLSTATE 原樣放在 `error.code`，
 * 所以在這一層就能分辨「撞到去重鍵」與「真的壞掉」。
 */
const UNIQUE_VIOLATION = "23505";

const DEFAULT_CHANNEL: NotificationChannel = "email";

/**
 * 宣告「這個場次的這個階段由我來寄」。
 *
 * 回傳 `true` = 搶到了，這一輪該寄；
 * 回傳 `false` = 別人已經寄過（另一個副本、或重啟前的自己）。
 *
 * 互斥完全靠 `notification_log_session_stage_key` 這個 unique constraint：
 * insert 成功就是搶到，撞到 23505 就是別人先搶到。單一 statement 完成，
 * 不需要交易、advisory lock 或 Redis —— 所以重啟與多副本都安全。
 *
 * ⚠️ 刻意「先宣告、再寄信」。
 *    反過來（寄完才記錄）的話，兩個副本會同時通過檢查、同一封信寄兩次，
 *    而重複寄信正是這張表要解決的問題，所以寧可先佔位。
 *    代價：宣告成功之後、信還沒寄完之前 process 被強制砍掉（SIGKILL）的話，
 *    那個場次的提醒會漏掉且不會重試。見 apps/worker/README.md「已知限制」。
 */
export async function claimNotification(
  client: ServiceClient,
  sessionId: string,
  stage: ReminderStage,
  channel: NotificationChannel = DEFAULT_CHANNEL,
): Promise<boolean> {
  // 不加 .select()：預設是 return=minimal，寄信只需要知道成功與否，不需要把列拉回來
  const { error } = (await client
    .from("notification_log")
    .insert({ session_id: sessionId, stage, channel })) as Result<unknown>;

  if (error === null) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new DbError("insert notification_log", error);
}

/**
 * 這批場次裡，哪些已經寄過這個階段的通知。
 *
 * 真正的互斥在 `claimNotification()`，這個查詢只是為了「先剔除再查資料」：
 * 已寄過的場次不必再撈報名者、訂單與商品，省掉大部分往返。
 * 掃描視窗帶了一天寬限（見 jobs/workshop-reminders.ts），
 * 每個場次平均會被掃到兩次，這個預先剔除因此不是可有可無的優化。
 */
export async function findNotifiedSessionIds(
  client: ServiceClient,
  sessionIds: readonly string[],
  stage: ReminderStage,
  channel: NotificationChannel = DEFAULT_CHANNEL,
): Promise<Set<string>> {
  const out = new Set<string>();
  if (sessionIds.length === 0) return out;

  for (const batch of chunk(sessionIds, IN_CHUNK_SIZE)) {
    const result = (await client
      .from("notification_log")
      .select("session_id")
      .eq("stage", stage)
      .eq("channel", channel)
      .in("session_id", batch)) as Result<Pick<NotificationLogRow, "session_id">[]>;

    for (const row of unwrapRows("select notification_log", result)) {
      if (row.session_id !== null) out.add(row.session_id);
    }
  }
  return out;
}

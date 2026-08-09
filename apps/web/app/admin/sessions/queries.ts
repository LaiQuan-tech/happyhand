import "server-only";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * 場次報名管理的共用查詢。
 *
 * 總覽頁、明細頁、CSV route 三個地方都要「這一場有誰報名」，
 * 抽在這裡是為了讓那個定義只有一份 —— 三份各自 join 的話，
 * 哪天有人只在其中一份加上 status 過濾，畫面上的人數與匯出的 CSV
 * 就會對不起來，而且不會有任何錯誤訊息告訴你。
 *
 * ⚠️ 這支只負責讀，不做授權。呼叫端自己要先 requireCapability()／checkCapability()。
 */

export type Db = ReturnType<typeof createServiceClient>;

/* --------------------------------------------------------------- 狀態定義 */

export const SESSION_STATUSES = ["open", "full", "closed", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  open: "開放報名",
  full: "已額滿",
  closed: "已關閉報名",
  cancelled: "已取消",
};

export function toSessionStatus(value: string | null | undefined): SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as SessionStatus)
    : "open";
}

export const WAITLIST_STATUSES = ["waiting", "offered", "converted", "cancelled"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

export const WAITLIST_STATUS_LABEL: Record<WaitlistStatus, string> = {
  waiting: "候補中",
  offered: "已通知有位",
  converted: "已轉正式報名",
  cancelled: "已取消",
};

export function toWaitlistStatus(value: string | null | undefined): WaitlistStatus {
  return (WAITLIST_STATUSES as readonly string[]).includes(value ?? "")
    ? (value as WaitlistStatus)
    : "waiting";
}

/* ------------------------------------------------------------------- 型別 */

export type SessionListRow = {
  id: string;
  productTitle: string;
  productSlug: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  capacity: number;
  seatsTaken: number;
  status: SessionStatus;
  /** 由已付款訂單推導出來的實際報名人數（sum of qty） */
  paidHeadcount: number;
  /** 已付款訂單的筆數。一筆訂單可能報名兩個位子，所以與 headcount 不同。 */
  paidOrderCount: number;
  waitingCount: number;
};

export type SessionDetail = {
  id: string;
  productId: string;
  productTitle: string;
  productSlug: string | null;
  startsAt: string;
  endsAt: string;
  location: string | null;
  address: string | null;
  capacity: number;
  seatsTaken: number;
  status: SessionStatus;
};

export type RosterEntry = {
  /** 以訂單為單位，不是以 order_items 為單位（見 loadRoster 的合併說明） */
  orderId: string;
  orderNo: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  /** 這筆訂單在這一場買了幾個位子 */
  qty: number;
  paidAt: string | null;
  createdAt: string;
};

export type WaitlistEntry = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  note: string | null;
  status: WaitlistStatus;
  createdAt: string;
};

/** PostgREST 的內嵌關聯有時是物件、有時是陣列（同 app/admin/page.tsx 的處理） */
function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/* ------------------------------------------------------- 報名名單（核心）*/

/**
 * 🔴 「誰報名了這一場」的唯一定義。
 *
 *   order_items.session_id = 這一場
 *     join orders on orders.id = order_items.order_id
 *     where orders.status = 'paid'
 *
 * 為什麼是 status = 'paid' 而不是全部訂單：
 * pending 是「還沒匯款」（本站有 ATM 轉帳與人工匯款），那些人隨時可能不付；
 * cancelled / refunded 是已經退掉的。把他們算進名單，現場就會準備多的座位與講義，
 * 名額也會被虛佔而讓真的要來的人排不進來。
 * apps/worker/src/jobs/workshop-reminders.ts 寄開課提醒用的是同一個條件，
 * 兩邊一致才不會發生「有人收到提醒卻不在簽到表上」。
 *
 * 聯絡資訊一律取 orders.contact_*，不 join auth.users：
 * 全站是訪客結帳，orders.user_id 幾乎永遠是 null。
 */
export async function loadRoster(
  db: Db,
  sessionId: string,
): Promise<{ rows: RosterEntry[]; error: string }> {
  try {
    const { data, error } = await db
      .from("order_items")
      .select(
        "id, qty, order_id, orders!inner(id, order_no, status, contact_name, contact_phone, contact_email, note, paid_at, created_at)",
      )
      .eq("session_id", sessionId)
      .eq("orders.status", "paid");
    if (error) throw new Error(error.message);

    type Raw = {
      id: string;
      qty: number;
      order_id: string;
      orders:
        | {
            id: string;
            order_no: string;
            contact_name: string | null;
            contact_phone: string | null;
            contact_email: string | null;
            note: string | null;
            paid_at: string | null;
            created_at: string;
          }
        | null
        | Array<{
            id: string;
            order_no: string;
            contact_name: string | null;
            contact_phone: string | null;
            contact_email: string | null;
            note: string | null;
            paid_at: string | null;
            created_at: string;
          }>;
    };

    /**
     * 依 order_id 合併。
     *
     * order_items 沒有 (order_id, session_id) 的唯一約束，所以同一張訂單
     * 可能有兩行都指向同一場（購物車分兩行買同一場次）。不合併的話
     * 同一個人會在簽到表與 CSV 上出現兩次，現場的人會以為他重複報名。
     * 人數把兩行的 qty 加起來才是他實際佔的位子數。
     */
    const byOrder = new Map<string, RosterEntry>();
    for (const raw of (data ?? []) as unknown as Raw[]) {
      const order = pickOne(raw.orders);
      // !inner 保證有值；防禦性跳過只是為了不讓一筆髒資料炸掉整張簽到表。
      if (!order) continue;

      const existing = byOrder.get(order.id);
      if (existing) {
        existing.qty += raw.qty ?? 1;
        continue;
      }
      byOrder.set(order.id, {
        orderId: order.id,
        orderNo: order.order_no,
        name: order.contact_name,
        phone: order.contact_phone,
        email: order.contact_email,
        note: order.note,
        qty: raw.qty ?? 1,
        paidAt: order.paid_at,
        createdAt: order.created_at,
      });
    }
    const rows = [...byOrder.values()];

    // 依付款時間排序：簽到表照繳費先後排，客服對帳時比較好找。
    rows.sort((a, b) => (a.paidAt ?? a.createdAt).localeCompare(b.paidAt ?? b.createdAt));
    return { rows, error: "" };
  } catch (err) {
    console.error("[admin/sessions] 報名名單查詢失敗", err);
    return { rows: [], error: "報名名單讀取失敗。" };
  }
}

export function rosterHeadcount(rows: readonly RosterEntry[]): number {
  return rows.reduce((sum, row) => sum + (row.qty ?? 0), 0);
}

/* --------------------------------------------------------------- 場次總覽 */

/**
 * 場次清單 + 每場的已付款人數 + 待處理候補數。
 *
 * 刻意不對每個場次各發一輪查詢（N+1）：先把場次撈出來，
 * 再用 in(sessionIds) 一次撈完明細與候補，在記憶體 group。
 * 這是 apps/worker/src/jobs/workshop-reminders.ts 的 collectAttendees() 同款作法。
 */
export async function loadSessionList(
  db: Db | null,
  options: { includePast: boolean },
): Promise<{ rows: SessionListRow[]; error: string }> {
  if (!db) {
    return { rows: [], error: "資料庫連線未設定，請檢查伺服器環境變數。" };
  }

  try {
    let query = db
      .from("workshop_sessions")
      .select("id, starts_at, ends_at, location, capacity, seats_taken, status, products(title, slug)");

    // 「未來場次」以結束時間為準，不是開始時間：
    // 一場 09:30–17:00 的工作坊，下午 2 點還在進行中，那時候最需要調得出簽到表。
    if (!options.includePast) {
      query = query.gte("ends_at", new Date().toISOString());
    }

    const { data, error } = await query.order("starts_at", { ascending: true });
    if (error) throw new Error(error.message);

    type RawSession = {
      id: string;
      starts_at: string;
      ends_at: string;
      location: string | null;
      capacity: number;
      seats_taken: number;
      status: string;
      products: { title: string | null; slug: string | null } | { title: string | null; slug: string | null }[] | null;
    };

    const sessions = (data ?? []) as unknown as RawSession[];
    const ids = sessions.map((s) => s.id);

    const [paidBySession, waitingBySession] = await Promise.all([
      loadPaidCounts(db, ids),
      loadWaitingCounts(db, ids),
    ]);

    const rows: SessionListRow[] = sessions.map((s) => {
      const product = pickOne(s.products);
      const paid = paidBySession.get(s.id) ?? { headcount: 0, orders: 0 };
      return {
        id: s.id,
        productTitle: product?.title ?? "（找不到課程）",
        productSlug: product?.slug ?? null,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        location: s.location,
        capacity: s.capacity,
        seatsTaken: s.seats_taken,
        status: toSessionStatus(s.status),
        paidHeadcount: paid.headcount,
        paidOrderCount: paid.orders,
        waitingCount: waitingBySession.get(s.id) ?? 0,
      };
    });

    return { rows, error: "" };
  } catch (err) {
    console.error("[admin/sessions] 場次清單查詢失敗", err);
    return { rows: [], error: "場次清單讀取失敗。" };
  }
}

/**
 * 每個場次的已付款人數與訂單數。
 *
 * ⚠️ 這兩支計數查詢**不 throw**：候補計數掛掉不該讓客服連場次清單都看不到。
 *    查失敗時回空 Map（該欄顯示 0）並在 server log 留下錯誤，
 *    主清單照樣渲染。這是刻意讓錯誤只影響一欄而不是整頁。
 */
async function loadPaidCounts(
  db: Db,
  sessionIds: string[],
): Promise<Map<string, { headcount: number; orders: number }>> {
  const out = new Map<string, { headcount: number; orders: number }>();
  if (sessionIds.length === 0) return out;

  const { data, error } = await db
    .from("order_items")
    .select("session_id, qty, order_id, orders!inner(status)")
    .in("session_id", sessionIds)
    .eq("orders.status", "paid");
  if (error) {
    console.error("[admin/sessions] 已付款人數計數失敗", error.code, error.message);
    return out;
  }

  // 訂單數要去重：同一張訂單可能有兩行都指向同一場（見 loadRoster）。
  const seenOrders = new Map<string, Set<string>>();
  for (const raw of (data ?? []) as unknown as {
    session_id: string;
    qty: number;
    order_id: string;
  }[]) {
    const current = out.get(raw.session_id) ?? { headcount: 0, orders: 0 };
    current.headcount += raw.qty ?? 0;

    const orders = seenOrders.get(raw.session_id) ?? new Set<string>();
    if (!orders.has(raw.order_id)) {
      orders.add(raw.order_id);
      current.orders += 1;
      seenOrders.set(raw.session_id, orders);
    }
    out.set(raw.session_id, current);
  }
  return out;
}

async function loadWaitingCounts(db: Db, sessionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sessionIds.length === 0) return out;

  const { data, error } = await db
    .from("workshop_waitlist")
    .select("session_id")
    .in("session_id", sessionIds)
    .eq("status", "waiting");
  if (error) {
    console.error("[admin/sessions] 候補計數失敗", error.code, error.message);
    return out;
  }

  for (const raw of (data ?? []) as unknown as { session_id: string }[]) {
    out.set(raw.session_id, (out.get(raw.session_id) ?? 0) + 1);
  }
  return out;
}

/* --------------------------------------------------------------- 單場明細 */

export async function loadSessionDetail(db: Db, sessionId: string): Promise<SessionDetail | null> {
  const { data, error } = await db
    .from("workshop_sessions")
    .select("id, product_id, starts_at, ends_at, location, address, capacity, seats_taken, status, products(title, slug)")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    // 網址列亂打一個不是 uuid 的字串會讓 Postgres 丟 22P02，
    // 那應該是 404 而不是 500。
    console.error("[admin/sessions] 場次明細查詢失敗", error.message);
    return null;
  }
  if (!data) return null;

  const raw = data as unknown as {
    id: string;
    product_id: string;
    starts_at: string;
    ends_at: string;
    location: string | null;
    address: string | null;
    capacity: number;
    seats_taken: number;
    status: string;
    products: { title: string | null; slug: string | null } | { title: string | null; slug: string | null }[] | null;
  };
  const product = pickOne(raw.products);

  return {
    id: raw.id,
    productId: raw.product_id,
    productTitle: product?.title ?? "（找不到課程）",
    productSlug: product?.slug ?? null,
    startsAt: raw.starts_at,
    endsAt: raw.ends_at,
    location: raw.location,
    address: raw.address,
    capacity: raw.capacity,
    seatsTaken: raw.seats_taken,
    status: toSessionStatus(raw.status),
  };
}

/* ----------------------------------------------------------------- 候補 */

export async function loadWaitlist(
  db: Db,
  sessionId: string,
): Promise<{ rows: WaitlistEntry[]; error: string }> {
  try {
    const { data, error } = await db
      .from("workshop_waitlist")
      .select("id, name, phone, email, note, status, created_at")
      .eq("session_id", sessionId)
      // 先登記的排前面：候補的順序就是承諾給客人的順序，不能用別的欄位排。
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as unknown as {
      id: string;
      name: string;
      phone: string;
      email: string | null;
      note: string | null;
      status: string;
      created_at: string;
    }[]).map((raw) => ({
      id: raw.id,
      name: raw.name,
      phone: raw.phone,
      email: raw.email,
      note: raw.note,
      status: toWaitlistStatus(raw.status),
      createdAt: raw.created_at,
    }));

    return { rows, error: "" };
  } catch (err) {
    console.error("[admin/sessions] 候補名單查詢失敗", err);
    return { rows: [], error: "候補名單讀取失敗。" };
  }
}

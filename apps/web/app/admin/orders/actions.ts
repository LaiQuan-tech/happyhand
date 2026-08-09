"use server";

import { revalidatePath } from "next/cache";
import { requireCapability, adminErrorMessage, type Staff } from "@/lib/admin/guard";
import { writeAudit, diffOf } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";
import {
  ORDER_STATUS_LABELS,
  checkTransition,
  money,
  seatSignFor,
  type OrderStatus,
} from "./shared";

/**
 * 訂單狀態的 server action。
 *
 * ⚠️ 每一支都自己呼叫 requireCapability("orders:write")。
 *    admin/layout.tsx 的守衛只在 render 時跑，server action 的 POST 不經過它——
 *    少了這行，任何登入中的一般會員都能直接 POST 到這個 endpoint 把訂單標成已收款。
 *
 * 🔴 冪等性是這支檔案的核心。
 *    情境：兩個客服同時看到同一筆待收款訂單、同時按下「標記已收款」，
 *    或同一個人網路慢連按兩下。若寫成「先讀狀態、判斷、再無條件 update」，
 *    兩邊都會讀到 pending、都會通過判斷、都會 update 成功，
 *    然後各自呼叫一次 admin_adjust_seats(+qty) —— 工作坊名額被扣兩次。
 *
 *    解法是把判斷與寫入合併成一個原子操作：
 *      update ... where id = ? AND status = <讀到的舊狀態>
 *    Postgres 對同一列的 UPDATE 會排隊，第二個交易重新評估 where 時
 *    status 已經不是舊值，於是影響 0 列。用 returning（PostgREST 的 .select()）
 *    把「真的改到了嗎」變成可判斷的回傳值，而不是靠再讀一次。
 *    只有拿到那一列的那一次才會去動名額。
 */

export type OrderActionResult = { error?: string | null };

/** audit 的動詞。四個狀態都列出來，之後加轉移不會漏。 */
const AUDIT_ACTION: Record<OrderStatus, string> = {
  pending: "order.reopen",
  paid: "order.mark_paid",
  cancelled: "order.cancel",
  refunded: "order.refund",
};

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  total: number;
  paid_at: string | null;
};

const ORDER_COLUMNS = "id, order_no, status, total, paid_at";

/* ------------------------------------------------------------------ 對外 */

export async function markOrderPaid(orderId: string): Promise<OrderActionResult> {
  return transitionOrder(orderId, "paid");
}

export async function cancelOrder(orderId: string): Promise<OrderActionResult> {
  return transitionOrder(orderId, "cancelled");
}

export async function refundOrder(orderId: string): Promise<OrderActionResult> {
  return transitionOrder(orderId, "refunded");
}

/* ------------------------------------------------------------------ 實作 */

async function transitionOrder(
  orderId: string,
  to: OrderStatus,
): Promise<OrderActionResult> {
  // 1) 授權。放在最前面，讓沒權限的請求連訂單編號都問不到。
  let staff: Staff;
  try {
    staff = await requireCapability("orders:write");
  } catch (err) {
    return { error: adminErrorMessage(err) };
  }

  if (typeof orderId !== "string" || orderId.length === 0) {
    return { error: "缺少訂單編號，請重新整理後再試一次。" };
  }

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[admin/orders] service client 建立失敗", err);
    return { error: "資料庫連線未設定，請聯絡工程師檢查伺服器環境變數。" };
  }

  // 2) 讀現況。這一步只是為了拿到「舊狀態」當作下面的樂觀鎖條件，
  //    以及產生給人看的 audit 訊息；真正的判斷不靠這次讀取的結果。
  const { data: beforeRaw, error: readError } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();

  if (readError) {
    console.error("[admin/orders] 讀取訂單失敗", orderId, readError.message);
    return { error: "讀取訂單失敗，請重新整理後再試一次。" };
  }
  const before = beforeRaw as OrderRow | null;
  if (!before) {
    return { error: "找不到這筆訂單，可能已經被刪除。請回訂單列表重新整理。" };
  }

  // 3) 白名單。非法轉移在這裡就擋下，不會送出任何寫入。
  const check = checkTransition(before.status, to);
  if (!check.ok) return { error: check.message };

  const from = before.status as OrderStatus;
  const now = new Date().toISOString();

  // paid_at 只在轉成 paid 時寫入——DB 有 orders_paid_at_required_when_paid
  // （status <> 'paid' or paid_at is not null），不寫會被 constraint 擋下。
  // 轉成 cancelled / refunded 時刻意保留原本的 paid_at：
  // 那是「曾經在什麼時候收過錢」的歷史，退款不該把它抹掉。
  const patch: Record<string, unknown> = { status: to, updated_at: now };
  if (to === "paid") patch.paid_at = now;

  // 4) 🔴 條件式 update + returning。冪等就在這一行的 .eq("status", from)。
  const { data: updatedRaw, error: updateError } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .eq("status", from)
    .select(ORDER_COLUMNS)
    .maybeSingle();

  if (updateError) {
    console.error("[admin/orders] 更新訂單失敗", orderId, updateError.message);
    return { error: "更新訂單狀態失敗，資料沒有被改動。請重試一次。" };
  }

  const updated = updatedRaw as OrderRow | null;
  if (!updated) {
    // 影響 0 列 = 這筆訂單在我們讀取之後被別人改過了。
    // 這正是連按兩下的第二次會走到的分支：不會重複加名額、不會重複寫 audit。
    return { error: "這筆訂單已經處理過了，請重新整理看最新狀態" };
  }

  // 5) 名額連動。只有「真的改到了」才會執行到這裡。
  const seatOutcome = await syncSeats(supabase, orderId, seatSignFor(from, to));

  // 6) 稽核。writeAudit 永不 throw，所以不用包 try。
  await writeAudit(staff, {
    action: AUDIT_ACTION[to],
    entity: "order",
    entityId: orderId,
    summary:
      `訂單 ${updated.order_no}（${money(updated.total)}）` +
      `由「${ORDER_STATUS_LABELS[from]}」改為「${ORDER_STATUS_LABELS[to]}」` +
      seatOutcome.auditNote,
    diff: {
      ...(diffOf(before, updated, ["status", "paid_at"]) ?? {}),
      ...(seatOutcome.applied.length > 0 ? { seats: seatOutcome.applied } : {}),
    },
  });

  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);

  // 狀態已經改成功了，但名額沒同步完 —— 必須講出來。
  // 這裡回 error 而不是靜默成功：客服看到訊息會去場次頁確認，
  // 靜默的話工作坊當天才會發現人數對不上。
  if (seatOutcome.warning) return { error: seatOutcome.warning };
  return {};
}

/* -------------------------------------------------------------- 名額同步 */

type SeatOutcome = {
  /** 給 audit diff 用的實際結果 */
  applied: { session_id: string; delta: number; seats_taken: number }[];
  /** 附在 audit summary 後面的一句話 */
  auditNote: string;
  /** 有問題時給操作者看的一句話；沒問題是 null */
  warning: string | null;
};

const NO_SEAT_CHANGE: SeatOutcome = { applied: [], auditNote: "", warning: null };

/**
 * 把這筆訂單的工作坊席次加上／還回去。
 *
 * 一律走 admin_adjust_seats RPC：它內部 `for update` 鎖住場次列再 clamp 到
 * [0, capacity]，所以並行的兩筆訂單不會互相蓋掉，也不會撞上
 * workshop_sessions_not_oversold 這個 check constraint（23514）。
 * 自己 update seats_taken 兩件事都做不到。
 *
 * ⚠️ clamp 是雙面刃：場次已經滿了的話，RPC 會「成功」但實際只加了一部分（甚至 0），
 *    而且不回報。所以這裡先把場次的 seats_taken 讀下來，
 *    事後比對 RPC 回傳的新值是不是等於預期，不等就當成需要人工確認。
 */
async function syncSeats(
  supabase: ReturnType<typeof createServiceClient>,
  orderId: string,
  sign: -1 | 0 | 1,
): Promise<SeatOutcome> {
  if (sign === 0) return NO_SEAT_CHANGE;

  const { data: itemsRaw, error: itemsError } = await supabase
    .from("order_items")
    .select("session_id, qty")
    .eq("order_id", orderId)
    .not("session_id", "is", null);

  if (itemsError) {
    console.error("[admin/orders] 讀取品項失敗", orderId, itemsError.message);
    return {
      applied: [],
      auditNote: "，但品項讀取失敗、名額未同步",
      warning:
        "訂單狀態已更新，但讀取品項失敗，工作坊名額沒有同步。請到場次頁人工確認報名人數。",
    };
  }

  const items = (itemsRaw ?? []) as { session_id: string | null; qty: number }[];

  // 同一個場次可能出現在多個品項（購物車分兩行買同一場），先合併再呼叫，
  // 一個場次只打一次 RPC，比對預期值時才有唯一的基準。
  const bySession = new Map<string, number>();
  for (const item of items) {
    if (!item.session_id) continue;
    bySession.set(item.session_id, (bySession.get(item.session_id) ?? 0) + (item.qty ?? 0));
  }
  if (bySession.size === 0) return NO_SEAT_CHANGE;

  const sessionIds = [...bySession.keys()];
  const { data: sessionsRaw } = await supabase
    .from("workshop_sessions")
    .select("id, capacity, seats_taken")
    .in("id", sessionIds);
  const seatsBefore = new Map<string, number>();
  for (const row of (sessionsRaw ?? []) as { id: string; seats_taken: number }[]) {
    seatsBefore.set(row.id, row.seats_taken);
  }

  const applied: SeatOutcome["applied"] = [];
  const failed: string[] = [];
  const clamped: string[] = [];
  let totalDelta = 0;

  for (const [sessionId, qty] of bySession) {
    const delta = sign * qty;
    const { data, error } = await supabase.rpc("admin_adjust_seats", {
      p_session_id: sessionId,
      p_delta: delta,
    });

    if (error) {
      console.error("[admin/orders] 調整名額失敗", sessionId, delta, error.message);
      failed.push(sessionId);
      continue;
    }

    const after = (data as { seats_taken?: number } | null)?.seats_taken;
    if (typeof after === "number") {
      applied.push({ session_id: sessionId, delta, seats_taken: after });
      totalDelta += delta;
      const expected = (seatsBefore.get(sessionId) ?? NaN) + delta;
      if (!Number.isNaN(expected) && after !== expected) clamped.push(sessionId);
    }
  }

  const auditNote =
    applied.length > 0
      ? `，工作坊名額 ${totalDelta >= 0 ? "+" : ""}${totalDelta}`
      : "";

  let warning: string | null = null;
  if (failed.length > 0) {
    warning =
      `訂單狀態已更新，但有 ${failed.length} 個工作坊場次的名額沒有同步成功。` +
      `請到場次頁人工確認報名人數。`;
  } else if (clamped.length > 0) {
    warning =
      `訂單狀態已更新，但有 ${clamped.length} 個場次的名額已達上下限，` +
      `實際加減的人數與這筆訂單不符。請到場次頁人工確認報名人數。`;
  }

  return { applied, auditNote, warning };
}

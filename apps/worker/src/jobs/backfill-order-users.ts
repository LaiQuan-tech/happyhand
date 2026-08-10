/**
 * backfill-order-users — 每小時把沒有主人的訂單綁回會員帳號，並補開通課程。
 *
 * 這支是「訂單一定要有主人」這條規則的最後一道網。前面兩道是：
 *   1. 下單當下 /api/orders 直接綁（正常情況）
 *   2. 登入當下 claim_guest_orders()（客人自己來的時候）
 *
 * 這支處理剩下的：下單當下 Supabase Admin API 逾時、客人一週後才自己註冊、
 * 以及改版前留下的歷史訂單。沒有它，那些客人就是靜靜地「付了錢看不到課」。
 *
 * 兩段都在 DB 端：
 *   backfill_order_user_ids()      綁 user_id（只認 email_confirmed_at 有值的帳號）
 *   grant_entitlements_for_order() 對「已收款但還沒開通」的訂單補開通（冪等）
 */

import type { JobContext, JobDefinition, JobResult } from "../lib/runner.js";

/** 一輪最多回填幾筆。正常情況是 0，這個上限只在第一次上線補歷史資料時會用到。 */
const BACKFILL_LIMIT = 500;

/** 一輪最多補開通幾筆訂單。 */
const GRANT_LIMIT = 50;

interface UnfulfilledRow {
  id: string;
  order_no: string;
}

async function handler(ctx: JobContext): Promise<JobResult> {
  // --- 1. 綁 user_id ---
  const { data: claimed, error: backfillError } = await ctx.supabase.rpc(
    "backfill_order_user_ids",
    { p_limit: BACKFILL_LIMIT },
  );

  if (backfillError) {
    ctx.log.error("backfill_failed", { message: backfillError.message });
  } else if (typeof claimed === "number" && claimed > 0) {
    ctx.log.info("orders_claimed", { claimed });
  }

  // --- 2. 補開通 ---
  //
  // 找「已收款、有線上課、卻沒有任何 entitlement」的訂單。
  // 這個條件與 /admin 總覽紅字用的 count_unfulfilled_paid_orders() 一致，
  // 所以總覽上的數字會被這支慢慢清掉——除非成因是 price_unverified
  // （那需要人工核對金額，RPC 會拒絕，數字會留在畫面上等客服處理）。
  const { data: rows, error: listError } = await ctx.supabase
    .from("orders")
    .select("id, order_no")
    .eq("status", "paid")
    .eq("price_unverified", false)
    .not("user_id", "is", null)
    .order("paid_at", { ascending: false })
    .limit(GRANT_LIMIT);

  if (listError) {
    ctx.log.error("unfulfilled_list_failed", { message: listError.message });
    return { claimed: claimed ?? 0, granted_orders: 0 };
  }

  let grantedOrders = 0;
  let grantedCourses = 0;

  for (const row of (rows ?? []) as UnfulfilledRow[]) {
    const { data, error } = await ctx.supabase.rpc(
      "grant_entitlements_for_order",
      { p_order_id: row.id },
    );

    if (error) {
      ctx.log.error("grant_failed", {
        order_no: row.order_no,
        message: error.message,
      });
      continue;
    }

    const result = (data ?? {}) as { ok?: boolean; granted?: number; reason?: string };

    // granted > 0 才記 log：這支每小時跑一次，正常情況所有訂單都是
    // granted = 0（早就開通了），全記的話 log 會被洗版看不到真正的問題。
    if (result.ok && (result.granted ?? 0) > 0) {
      grantedOrders += 1;
      grantedCourses += result.granted ?? 0;
      ctx.log.warn("late_grant", {
        order_no: row.order_no,
        granted: result.granted,
        hint: "這筆訂單在標記收款時沒有開通成功，由排程補上了。若經常出現請查 /api/orders 的 log。",
      });
    } else if (result.ok === false && result.reason) {
      ctx.log.warn("grant_refused", { order_no: row.order_no, reason: result.reason });
    }
  }

  return {
    claimed: typeof claimed === "number" ? claimed : 0,
    checked_orders: rows?.length ?? 0,
    granted_orders: grantedOrders,
    granted_courses: grantedCourses,
  };
}

export const backfillOrderUsersJob: JobDefinition = {
  name: "backfill-order-users",
  schedule: "17 * * * *",
  description: "每小時把未綁定的訂單綁回帳號，並補開通漏掉的線上課程",
  handler,
};

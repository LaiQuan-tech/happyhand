/**
 * atm-reconciliation — 每小時產生「待人工對帳」清單。
 *
 * ⚠️⚠️ 這是**明確的 stub，不是自動對帳**。⚠️⚠️
 *
 * STACK.md §4 第 3 點的完整目標是「定時比對銀行匯入明細，自動把 orders.status
 * 改為 paid 並發放 entitlements」。目前**沒有**任何銀行 API 或匯入明細來源，
 * 所以這個 job：
 *
 *   會做：查出逾期未付款的 ATM 訂單，輸出一份清單到 log，讓同事去銀行後台核對。
 *   不做：不修改任何資料。不會把訂單改成 paid，也不會發放 entitlements。
 *
 * 接上銀行／金流 API 之後要改的位置，見本檔最下方 TODO 區塊與 README。
 */

import { findOrderItemsByOrderIds, findProductsByIds, findStaleAtmOrders } from "../lib/db.js";
import { isoDaysAgo, wholeDaysBetween } from "../lib/time.js";
import type { JobContext, JobDefinition, JobResult } from "../lib/runner.js";

/** 超過幾天仍是 pending 就列入人工對帳清單。 */
const STALE_AFTER_DAYS = 3;
/** 單次最多列出幾筆，避免一次噴出上千行 log。 */
const MAX_ROWS = 200;

async function handler(ctx: JobContext): Promise<JobResult> {
  const cutoffIso = isoDaysAgo(STALE_AFTER_DAYS, ctx.now);
  const orders = await findStaleAtmOrders(ctx.supabase, cutoffIso, MAX_ROWS);

  if (orders.length === 0) {
    return { pending_atm_orders: 0, cutoff: cutoffIso };
  }

  // 帶上商品名稱，同事看 log 就知道這筆在等什麼，不用再開後台查
  const items = await findOrderItemsByOrderIds(
    ctx.supabase,
    orders.map((order) => order.id),
  );
  const productIds = [
    ...new Set(
      items
        .map((item) => item.product_id)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];
  const products = await findProductsByIds(ctx.supabase, productIds);

  const titlesByOrder = new Map<string, string[]>();
  for (const item of items) {
    const title =
      item.product_id === null ? "(未知商品)" : (products.get(item.product_id)?.title ?? "(未知商品)");
    const list = titlesByOrder.get(item.order_id);
    if (list === undefined) {
      titlesByOrder.set(item.order_id, [title]);
    } else {
      list.push(title);
    }
  }

  let totalAmount = 0;

  for (const order of orders) {
    totalAmount += order.total;
    // 一筆訂單一行。刻意不寫姓名／email／電話：
    // Railway log 保留期長又多人可見，要查人用 order_no 或 user_id 到後台查。
    ctx.log.info("atm_awaiting_manual_reconciliation", {
      order_no: order.order_no,
      order_id: order.id,
      user_id: order.user_id,
      total: order.total,
      created_at: order.created_at,
      waiting_days: wholeDaysBetween(order.created_at, ctx.now),
      items: titlesByOrder.get(order.id) ?? [],
    });
  }

  ctx.log.warn("atm_manual_reconciliation_required", {
    pending_atm_orders: orders.length,
    total_amount: totalAmount,
    stale_after_days: STALE_AFTER_DAYS,
    truncated: orders.length >= MAX_ROWS,
    hint:
      `以上 ${orders.length} 筆 ATM 訂單超過 ${STALE_AFTER_DAYS} 天仍是 pending。` +
      "請人工到銀行帳戶核對匯入明細，確認後到後台把訂單改為 paid 並發放 entitlements。" +
      "（本 job 不會自動改任何資料）",
  });

  return {
    pending_atm_orders: orders.length,
    total_amount: totalAmount,
    cutoff: cutoffIso,
    truncated: orders.length >= MAX_ROWS,
  };
}

/*
 * TODO（接銀行／金流 API 時）：
 *
 * 1. 在 src/lib/ 新增 bank.ts，實作 `fetchIncomingTransfers(sinceIso): Promise<Transfer[]>`，
 *    Transfer 至少要有 { amount, virtualAccountNo, transferredAt, bankTxnId }。
 *    綠界／藍新的 ATM 虛擬帳號 API 或銀行的對帳檔（多為每日 CSV／MT940）都放這裡。
 *
 * 2. 本檔改成：撈 pending ATM 訂單 → 依「虛擬帳號 + 金額」比對 Transfer →
 *    命中的呼叫一個新的 Postgres function（例如 `mark_order_paid(p_order_id, p_bank_txn_id)`），
 *    在同一個交易裡改 orders.status/paid_at、寫 entitlements、扣 workshop_sessions 名額。
 *    **務必放在 DB function 裡**，不要在 worker 端分三次寫，否則中途失敗會產生
 *    「收了錢但沒開通」或「開通了但訂單還是 pending」的狀態。
 *
 * 3. 冪等性：用 bank_txn_id 當去重鍵（建表 + unique constraint），
 *    同一筆匯入重跑不可以重複開通。
 *
 * 4. 金額不符、找不到對應訂單、重複匯款 → 一律不自動處理，留在本 job 的人工清單。
 *
 * 5. 這段自動化牽涉金流，上線前必須有人審過並在測試環境用真實對帳檔驗證過。
 */

export const atmReconciliationJob: JobDefinition = {
  name: "atm-reconciliation",
  schedule: "0 * * * *",
  description:
    "每小時列出超過 3 天未付款的 ATM 訂單（唯讀 stub，不會改資料，需人工對帳）",
  handler,
};

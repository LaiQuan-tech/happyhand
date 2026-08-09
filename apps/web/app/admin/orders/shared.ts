/**
 * 訂單狀態機與顯示用字串。
 *
 * 這支刻意是「純資料、零 IO、零 directive」——
 * 沒有 "use server"（那樣就只能匯出 async function，狀態機常數會被擋下），
 * 也沒有 "use client"（server component 的清單頁與明細頁都要直接 import）。
 *
 * 狀態機做成白名單 map 而不是 if/else 串，理由是可窮舉：
 * 4 個狀態 × 4 個目標 = 16 種組合，看得到全部才知道哪些是刻意不允許的。
 * checkTransition() 與 seatSignFor() 都是純函式，可以在沒有 request context
 * 的情況下單獨驗證（見交付說明的狀態機驗收）。
 */

export const ORDER_STATUSES = ["pending", "paid", "cancelled", "refunded"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * 允許的狀態轉移。key 是目前狀態，value 是可以轉去的狀態。
 *
 * 幾個刻意的「不允許」：
 * - paid 不能直接 cancelled：錢已經收了，要走退款流程留下紀錄，不是當作沒發生過。
 * - cancelled / refunded 是終點：要重新處理就開一筆新訂單，
 *   不要讓同一個 order_no 在時間軸上來回跳（客服對帳時會分不清哪次是哪次）。
 * - 沒有任何狀態可以轉回自己：連按兩次「標記已收款」的第二次會被這裡擋下，
 *   而不是靠下游的條件式 update 兜底（兩層都有，這是第一層）。
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["refunded"],
  cancelled: [],
  refunded: [],
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待收款",
  paid: "已收款",
  cancelled: "已取消",
  refunded: "已退款",
};

/**
 * 狀態 chip 的色調。
 * ok=綠（3f6b4a，5.57:1 on chip）、danger=磚紅（4.92:1）、accent=焦糖深（5.73:1）。
 * 三個都過 WCAG 1.4.3 的 4.5:1，所以狀態不是「只靠顏色」也不是靠不合格的顏色。
 */
export const ORDER_STATUS_TONE: Record<OrderStatus, "ok" | "danger" | "accent"> = {
  pending: "accent",
  paid: "ok",
  cancelled: "danger",
  refunded: "danger",
};

/**
 * payment_method 的合法值。
 *
 * ⚠️ 資料庫的 check 是 `payment_method is null or payment_method in (...)`，
 *    也就是 NULL 是合法的（欄位本身 nullable）。實際上 /api/orders 會把認不得的值
 *    硬改成 "manual"，所以 NULL 只會出現在「退回 base 欄位集」那條失敗路徑上，
 *    但顯示層還是必須撐得住 null，不能假設一定有值。
 */
export const PAYMENT_METHODS = ["credit", "atm", "manual"] as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  credit: "信用卡",
  atm: "ATM 轉帳",
  manual: "人工／臨櫃",
};

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** 認不得的狀態原樣顯示，不要靜默變成「待收款」——那會讓壞資料看起來很正常。 */
export function orderStatusLabel(value: string | null | undefined): string {
  if (!value) return "（無狀態）";
  return isOrderStatus(value) ? ORDER_STATUS_LABELS[value] : value;
}

export function paymentMethodLabel(value: string | null | undefined): string {
  if (!value) return "（未指定）";
  return PAYMENT_METHOD_LABELS[value] ?? value;
}

export type TransitionCheck = { ok: true } | { ok: false; message: string };

/**
 * 這個轉移合法嗎？不合法時回一句給客服看的中文。
 *
 * 訊息刻意包含「目前可以做什麼」，因為使用者按到不合法的按鈕時
 * 通常是資料已經被別人改過了，他需要知道的是下一步而不是「失敗」兩個字。
 */
export function checkTransition(
  from: string | null | undefined,
  to: OrderStatus,
): TransitionCheck {
  if (!isOrderStatus(from)) {
    return {
      ok: false,
      message: `這筆訂單目前的狀態是「${from ?? "空值"}」，不在系統認得的四種狀態內，請聯絡工程師處理。`,
    };
  }

  const allowed = ORDER_TRANSITIONS[from];
  if (allowed.includes(to)) return { ok: true };

  // 沒有任何狀態可以轉回自己，所以這一段不會改變「什麼是合法的」，
  // 只是把訊息講得更準。這是實務上最常撞到的分支——
  // 連按兩下、或兩個人各自開著同一頁，第二個請求讀到的就是已經改完的狀態。
  // 落到下面的通用訊息會變成「不能從『已收款』改成『已收款』」，讀起來像 bug。
  if (from === to) {
    return {
      ok: false,
      message: `這筆訂單已經是「${ORDER_STATUS_LABELS[to]}」了，不需要重複操作。若你的畫面顯示的不是這個狀態，請重新整理。`,
    };
  }

  if (allowed.length === 0) {
    return {
      ok: false,
      message: `「${ORDER_STATUS_LABELS[from]}」是最終狀態，不能再改成「${ORDER_STATUS_LABELS[to]}」。需要重新處理請建立一筆新訂單。`,
    };
  }

  return {
    ok: false,
    message: `訂單不能從「${ORDER_STATUS_LABELS[from]}」直接改成「${ORDER_STATUS_LABELS[to]}」。目前可執行的操作只有：${allowed
      .map((s) => ORDER_STATUS_LABELS[s])
      .join("、")}。`,
  };
}

/**
 * 這個轉移對工作坊名額的影響：+1 佔用、-1 釋出、0 不動。
 *
 * 同樣用查表而不是條件式。關鍵是 pending -> cancelled 必須是 0：
 * /api/orders 建立訂單時完全沒有動 seats_taken（已核對 route.ts），
 * 名額是在「標記已收款」那一刻才佔用的，
 * 所以取消一筆從沒收款的訂單不該把別人的名額還回去。
 */
const SEAT_EFFECT: Record<string, -1 | 0 | 1> = {
  "pending->paid": 1,
  "pending->cancelled": 0,
  "paid->refunded": -1,
};

export function seatSignFor(from: OrderStatus, to: OrderStatus): -1 | 0 | 1 {
  return SEAT_EFFECT[`${from}->${to}`] ?? 0;
}

/** 後台一律用這個格式顯示金額，與 /admin 總覽一致。 */
export function money(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return `NT$ ${value.toLocaleString("zh-TW")}`;
}

/**
 * 刪除前的參照檢查。
 *
 * 這兩支之所以從 actions.ts 抽出來，理由和 lesson-plan.ts 一樣：
 * 「有人買過就不能刪」是這個後台最重要的資料保護，
 * 驗收必須跑到真的會上線的那一段，而不是另外寫一份長得像的。
 *
 * 所以這裡零 `@/` import（node 的 type stripping 載得動），
 * 也不 import supabase 型別 —— 只用結構型別描述會呼叫哪些方法。
 *
 * 🔴 兩張表的外鍵行為完全不同，處理方式也必須不同：
 *
 *   order_items.product_id  on delete RESTRICT
 *     -> 資料庫會擋，但擋出來是一句 23503 的英文。
 *        先查再回中文，員工才知道要改用「下架」。
 *
 *   order_items.session_id  on delete SET NULL
 *     -> 資料庫**不會**擋。刪下去訂單還在，但「報名的是哪一場」
 *        會靜靜地變成 null，而且沒有任何欄位記得原本是哪一場，救不回來。
 *        所以這一支是唯一的防線。
 */

export type DeleteBlock = { blocked: true; reason: string } | { blocked: false };

type CountResult = { count: number | null; error: { message: string } | null };

/**
 * 可以繼續串 .eq()／.in()，也可以直接 await 的查詢建構器。
 *
 * 刻意寫成這種「回自己」的遞迴型別而不是照抄 supabase 的
 * PostgrestFilterBuilder：後者的泛型會把 select() 字串拿去做型別層解析，
 * 拿整個 client 去比對結構型別會讓 tsc 直接吐
 * TS2589 type instantiation is excessively deep。
 * 呼叫端用一次 cast 銜接（見 actions.ts），換這支能被 node 直接載入測試。
 */
type CountFilter = PromiseLike<CountResult> & {
  eq(column: string, value: string): CountFilter;
  in(column: string, values: string[]): CountFilter;
};

/** 打資料庫用的最小介面（service client 天生滿足這個形狀） */
export type CountClient = {
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): CountFilter;
  };
};

/**
 * 這門課可以刪嗎？
 *
 * 查兩種參照：
 *   1. 直接被訂單買走（order_items.product_id）—— restrict 會擋，先翻成中文
 *   2. 它的場次被訂單報名（order_items.session_id）—— 這條 restrict 擋不住，
 *      因為刪 product 是先 cascade 掉 workshop_sessions，
 *      而 session_id 是 set null，整條路徑上沒有任何一個 restrict。
 */
export async function checkProductDeletable(
  db: CountClient,
  productId: string,
  listSessionIds: (productId: string) => Promise<string[]>,
): Promise<DeleteBlock> {
  const direct = await db
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (direct.error) {
    return {
      blocked: true,
      reason: "無法確認這門課有沒有人買過，為了安全起見沒有刪除。請重試一次。",
    };
  }
  if ((direct.count ?? 0) > 0) {
    return {
      blocked: true,
      reason: `這門課已經有人買過（${direct.count} 筆訂單明細），不能刪除。請改成下架。`,
    };
  }

  const sessionIds = await listSessionIds(productId);
  if (sessionIds.length > 0) {
    const viaSession = await db
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .in("session_id", sessionIds);
    if (viaSession.error) {
      return {
        blocked: true,
        reason: "無法確認場次的報名狀況，為了安全起見沒有刪除。請重試一次。",
      };
    }
    if ((viaSession.count ?? 0) > 0) {
      return {
        blocked: true,
        reason: `這門課的場次已經有人報名（${viaSession.count} 筆訂單明細），不能刪除。請改成下架。`,
      };
    }
  }

  return { blocked: false };
}

/**
 * 這個場次可以刪嗎？
 *
 * 先分「已付款」與「全部」兩種訊息：已付款的那句要講得更重，
 * 因為那是真的有人繳了錢等著上課。
 *
 * 「已付款」的定義與 /admin/sessions 完全一致
 * （order_items.session_id + orders.status = 'paid'），
 * 兩邊算出不同的人數會讓員工不知道要相信哪一個畫面。
 */
export async function checkSessionDeletable(
  db: CountClient,
  sessionId: string,
): Promise<DeleteBlock> {
  const paid = await db
    .from("order_items")
    .select("id, orders!inner(status)", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("orders.status", "paid");
  if (paid.error) {
    return {
      blocked: true,
      reason: "無法確認這場的報名狀況，為了安全起見沒有刪除。請重試一次。",
    };
  }
  if ((paid.count ?? 0) > 0) {
    return {
      blocked: true,
      reason: `這個場次已經有 ${paid.count} 筆已付款的報名，不能刪除。請改成「已取消」，報名紀錄才不會斷掉。`,
    };
  }

  const any = await db
    .from("order_items")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (any.error) {
    return {
      blocked: true,
      reason: "無法確認這場的報名狀況，為了安全起見沒有刪除。請重試一次。",
    };
  }
  if ((any.count ?? 0) > 0) {
    return {
      blocked: true,
      reason: `這個場次已經有 ${any.count} 筆訂單明細（尚未付款），不能刪除。請改成「已取消」。`,
    };
  }

  return { blocked: false };
}

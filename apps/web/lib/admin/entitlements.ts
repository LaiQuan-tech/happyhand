import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * 課程開通。
 *
 * 這是「按下標記已收款」與「學員看得到課」之間唯一的一段。在這支存在之前，
 * markOrderPaid 只做兩件事：改訂單狀態、調工作坊名額 —— 線上課程什麼都沒發生。
 *
 * 真正的邏輯在 DB 的 grant_entitlements_for_order() RPC 裡（見
 * supabase/migrations/20260810000006_member_portal.sql）：
 * 它會鎖住訂單、檢查三個前提、然後 upsert entitlements。冪等，重跑安全。
 *
 * 這裡只負責呼叫它，並把結構化的 reason 翻成客服看得懂的中文。
 */

export type GrantReason =
  | "not_found"
  | "not_paid"
  | "no_user"
  | "price_unverified";

export type GrantResult = {
  ok: boolean;
  reason: GrantReason | null;
  /** 這次新開通幾門 */
  granted: number;
  /** 本來就有幾門（重跑或重複購買） */
  kept: number;
  products: string[];
  /** 要顯示給客服看的警告。null = 一切正常。 */
  warning: string | null;
};

/**
 * 每一種失敗都有對應的補救動作，所以文案要直接寫「你現在該做什麼」，
 * 不能只說「失敗了」。這些字會直接出現在客服的畫面上。
 */
const REASON_MESSAGE: Record<GrantReason, string> = {
  not_found: "找不到這筆訂單，線上課沒有開通。請重新整理後再確認一次。",
  not_paid:
    "這筆訂單不是已收款狀態，線上課沒有開通。請先把訂單標記為已收款。",
  no_user:
    "這筆訂單沒有綁到任何會員帳號，線上課還沒有開通。" +
    "請在下面的「會員帳號與課程開通」確認客人的 Email 後按「綁定並開通」。",
  price_unverified:
    "這筆訂單的金額沒有經過系統核對，為了安全起見沒有自動開通線上課。" +
    "請先核對金額，再按「我已核對金額無誤，開通課程」。",
};

function isReason(value: unknown): value is GrantReason {
  return (
    value === "not_found" ||
    value === "not_paid" ||
    value === "no_user" ||
    value === "price_unverified"
  );
}

/**
 * 開通一筆訂單的線上課程。
 *
 * ⚠️ 永不 throw。呼叫端（transitionOrder）在這一步之前已經把訂單改成 paid 了，
 *    這裡丟例外會讓客服看到一個失敗畫面、但錢其實已經收了 —— 最糟的組合。
 *    一律回結構化結果，由呼叫端決定怎麼呈現。
 */
export async function grantEntitlementsForOrder(
  orderId: string,
): Promise<GrantResult> {
  const empty: GrantResult = {
    ok: false,
    reason: null,
    granted: 0,
    kept: 0,
    products: [],
    warning: null,
  };

  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc("grant_entitlements_for_order", {
      p_order_id: orderId,
    });

    if (error) {
      console.error("[entitlements] RPC 失敗", orderId, error.message);
      return {
        ...empty,
        warning:
          "訂單狀態已更新，但開通線上課程時發生錯誤，課程還沒有開通。" +
          "請在訂單頁按「重新開通」再試一次。",
      };
    }

    const raw = (data ?? {}) as Record<string, unknown>;
    const ok = raw.ok === true;
    const reason = isReason(raw.reason) ? raw.reason : null;
    const granted = typeof raw.granted === "number" ? raw.granted : 0;
    const kept = typeof raw.kept === "number" ? raw.kept : 0;
    const products = Array.isArray(raw.products)
      ? raw.products.filter((p): p is string => typeof p === "string")
      : [];

    return {
      ok,
      reason,
      granted,
      kept,
      products,
      warning: ok ? null : reason ? REASON_MESSAGE[reason] : null,
    };
  } catch (err) {
    console.error("[entitlements] 例外", orderId, err);
    return {
      ...empty,
      warning:
        "訂單狀態已更新，但開通線上課程時發生錯誤，課程還沒有開通。" +
        "請在訂單頁按「重新開通」再試一次。",
    };
  }
}

/** 撤銷單一門課。只由客服人工觸發 —— 退款不會自動呼叫，理由見 migration 註解。 */
export async function revokeEntitlement(
  userId: string,
  productId: string,
): Promise<boolean> {
  try {
    const db = createServiceClient();
    const { data, error } = await db.rpc("revoke_entitlement", {
      p_user_id: userId,
      p_product_id: productId,
    });
    if (error) {
      console.error("[entitlements] 撤銷失敗", userId, productId, error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error("[entitlements] 撤銷例外", err);
    return false;
  }
}

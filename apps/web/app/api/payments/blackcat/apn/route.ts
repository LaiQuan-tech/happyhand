import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { grantEntitlementsForOrder } from "@/lib/admin/entitlements";
import {
  APN_STATUS,
  queryOrder,
  verifyApnChecksum,
} from "@/lib/payment/blackcat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 黑貓 PAY APN 主動通知接收端點。
 *
 * 這個網址要填進黑貓 PAY 後台（會員專區 › 連線設定修改 › 線上刷卡 ›
 * 「APN - 主動通知接收網址」），或由建單時的 apn_url 指定。
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 為什麼光驗 checksum 不夠：checksum 裡沒有任何祕密
 * ─────────────────────────────────────────────────────────────
 * 規格 P89 的算法是
 *     MD5(api_id : trans_id : amount : status : nonce)
 * 五個欄位**全部都在通知本體裡**，沒有 hash_base、沒有任何預先共享的密鑰。
 * 也就是說任何人都能自己組一份「付款成功」的 JSON、自己算出合法的 checksum，
 * POST 到這個公開網址。客人知道自己的訂單編號，所以這不是理論攻擊。
 *
 * 因此這裡**一定要回查黑貓 PAY 的訂單查詢 API**（CocsOrderQuery）拿 process_code，
 * 以他們伺服器上的狀態為準。checksum 只用來擋掉隨機亂打的雜訊。
 *
 * ─────────────────────────────────────────────────────────────
 * 🔴 金額要用 pay_amount 比，不能用 amount
 * ─────────────────────────────────────────────────────────────
 * 規格 P35 注意事項 2（紅字）：「APN 回檔時，有回拋實際繳款金額 pay_amount 給商戶，
 * 請技術要以實際繳款金額去判別這筆繳款應實收是否相符後才撥付商品給消費者。」
 * 而 checksum 算的是 amount（訂單金額）不是 pay_amount，所以 checksum 通過
 * 完全不保證客人付對了錢。
 *
 * ─────────────────────────────────────────────────────────────
 * 回覆規定（規格 P87）
 * ─────────────────────────────────────────────────────────────
 * 必須回**純文字 `OK`**。沒回的話每 15 分鐘重送一次、同一個狀態碼最多送 3 次。
 * 所以：業務面的失敗（金額不符、找不到訂單）也要回 OK —— 重送不會讓結果變好，
 * 那些要靠 /admin 的告警讓人去處理。只有「我們自己壞了」（DB 失敗）才回非 200
 * 讓它重送。
 */

/** 規格附件 1：這些 process_code 代表銀行確實授權過。 */
const AUTHORIZED_PROCESS_CODES = new Set([
  15, // 授權完成
  20, // 請求請款
  21, // 請款作業中
  22, // 請款完成
]);

/** 純文字 OK —— 規格要的就是這個，不能包成 JSON。 */
function ok() {
  return new NextResponse("OK", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/** APN 的數字欄位可能是 number 也可能是字串（規格 sample 兩種都有）。 */
function toInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/["']/g, ""));
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse("BAD_REQUEST", { status: 400 });
  }

  const apiId = body.api_id;
  const transId = String(body.trans_id ?? "");
  const orderNo = String(body.order_no ?? "");
  const status = String(body.status ?? "");
  const amount = toInt(body.amount);

  if (!transId || !status) {
    return new NextResponse("BAD_REQUEST", { status: 400 });
  }

  // 1) 驗 checksum。擋隨機雜訊用，不是真正的授權依據（見檔頭）。
  const checksumOk = verifyApnChecksum({
    apiId,
    transId,
    amount: body.amount,
    status,
    nonce: body.nonce,
    checksum: body.checksum,
  });
  if (!checksumOk) {
    console.warn("[blackcat/apn] checksum 驗證失敗", { orderNo, transId, status });
    return new NextResponse("BAD_CHECKSUM", { status: 400 });
  }

  const detail = (body.payment_detail ?? {}) as Record<string, unknown>;
  const payAmount = toInt(detail.pay_amount);

  const db = createServiceClient();

  // 2) 找訂單。用我們自己的 order_no（建單時就是拿它當 cust_order_no）。
  const { data: order, error: findError } = await db
    .from("orders")
    .select("id, order_no, status, total, payment_status_code")
    .eq("order_no", orderNo)
    .maybeSingle();

  if (findError) {
    // 我們自己的 DB 壞了 —— 回非 200 讓它重送。
    console.error("[blackcat/apn] 查訂單失敗", orderNo, findError.message);
    return new NextResponse("DB_ERROR", { status: 500 });
  }

  const logEvent = async (outcome: string, note?: string) => {
    const { error } = await db.from("payment_events").insert({
      order_id: order?.id ?? null,
      provider: "blackcat",
      trans_id: transId,
      order_no: orderNo,
      status_code: status,
      amount,
      pay_amount: payAmount,
      nonce: body.nonce ? String(body.nonce) : null,
      raw: body,
      outcome,
      note: note ?? null,
    });
    // 23505 = unique 衝突 = 這個狀態碼已經處理過了（重送）。這是預期內的。
    if (error && error.code !== "23505") {
      console.error("[blackcat/apn] 寫入 payment_events 失敗", error.message);
      return false;
    }
    return !error; // false 代表是重複通知
  };

  if (!order) {
    await logEvent("order_not_found");
    console.warn("[blackcat/apn] 找不到訂單", orderNo, transId);
    return ok(); // 重送也找不到，回 OK 停止重送，靠告警處理
  }

  // 3) 冪等。同一筆交易的同一個狀態只處理一次。
  const isNew = await logEvent("pending");
  if (!isNew) {
    return ok();
  }

  // 只有「授權完成」要開通課程。其餘狀態記錄下來就好。
  if (status !== APN_STATUS.AUTHORIZED) {
    await db
      .from("orders")
      .update({
        payment_status_code: status,
        payment_notified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", order.id);
    await db
      .from("payment_events")
      .update({ outcome: "ignored", note: `狀態 ${status} 不觸發開通` })
      .eq("provider", "blackcat")
      .eq("trans_id", transId)
      .eq("status_code", status);
    return ok();
  }

  // 4) 🔴 回查黑貓 PAY，以他們伺服器上的狀態為準（防偽造通知）。
  const remote = await queryOrder(orderNo);
  if (!remote.ok) {
    // 查不到就不能開通。回 500 讓它重送，說不定下次查得到。
    console.error("[blackcat/apn] 回查訂單失敗", orderNo, remote.reason);
    await db
      .from("payment_events")
      .update({ outcome: "verify_failed", note: remote.reason })
      .eq("provider", "blackcat")
      .eq("trans_id", transId)
      .eq("status_code", status);
    return new NextResponse("VERIFY_FAILED", { status: 500 });
  }

  const processCode = toInt(remote.data.process_code);
  if (processCode === null || !AUTHORIZED_PROCESS_CODES.has(processCode)) {
    console.warn("[blackcat/apn] 回查狀態不是已授權", orderNo, processCode);
    await db
      .from("payment_events")
      .update({
        outcome: "not_authorized",
        note: `回查 process_code=${processCode}`,
      })
      .eq("provider", "blackcat")
      .eq("trans_id", transId)
      .eq("status_code", status);
    return ok();
  }

  // 5) 🔴 金額比對。用實際授權金額，不是通知裡的 amount。
  //    回查結果的 order_amount 也一併看，兩邊都要對得上我們的應收金額。
  const remoteAmount = toInt(remote.data.order_amount);
  const actual = payAmount ?? remoteAmount;
  if (actual === null || actual !== order.total) {
    console.error("[blackcat/apn] 金額不符，不開通", {
      orderNo,
      應收: order.total,
      實收: actual,
      apn_amount: amount,
    });
    await db
      .from("payment_events")
      .update({
        outcome: "amount_mismatch",
        note: `應收 ${order.total}，實收 ${actual ?? "未知"}`,
      })
      .eq("provider", "blackcat")
      .eq("trans_id", transId)
      .eq("status_code", status);
    return ok(); // 重送沒用，要人工處理
  }

  // 6) 標記付款。條件式 update：只有 pending 會被改到，這是第二層冪等。
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await db
    .from("orders")
    .update({
      status: "paid",
      paid_at: now,
      payment_provider: "blackcat",
      payment_trade_no: transId,
      payment_status_code: status,
      payment_paid_amount: actual,
      payment_card_no: detail.auth_card_no ? String(detail.auth_card_no) : null,
      payment_auth_code: detail.auth_code ? String(detail.auth_code) : null,
      payment_notified_at: now,
      payment_method: "credit",
      updated_at: now,
    })
    .eq("id", order.id)
    .eq("status", "pending")
    .select("id, order_no")
    .maybeSingle();

  if (updateError) {
    console.error("[blackcat/apn] 更新訂單失敗", orderNo, updateError.message);
    return new NextResponse("DB_ERROR", { status: 500 });
  }

  // updated 是 null 代表訂單已經不是 pending（例如客服先手動標記過），
  // 這不是錯誤 —— 照樣往下開通，grant 本身是冪等的。
  const grant = await grantEntitlementsForOrder(order.id);

  // 🔴 工作坊名額同步。只有這次真的把訂單從 pending 改成 paid 才做，
  //    否則客服先手動標記過、APN 再進來就會重複加一次。
  //
  //    沒有這段的話會超賣：workshop_holds() 只算 pending 的訂單，付款後那筆
  //    不再計入 held，但 seats_taken 也沒增加 —— 位子就憑空多出來了。
  //
  //    ⚠️ 這裡刻意用跟 admin/orders/actions.ts 的 syncSeats() 同一支 RPC
  //    （admin_adjust_seats）。那支是 server action 的私有函式沒有 export，
  //    改動它的名額邏輯時記得這裡也要跟著改。
  if (updated) {
    const { data: seatItems, error: seatError } = await db
      .from("order_items")
      .select("session_id, qty")
      .eq("order_id", order.id)
      .not("session_id", "is", null);

    if (seatError) {
      console.error("[blackcat/apn] 讀取品項失敗，名額未同步", orderNo, seatError.message);
    } else {
      // 同一場次可能拆成多個品項，先合併再呼叫，一個場次只打一次 RPC
      const bySession = new Map<string, number>();
      for (const it of (seatItems ?? []) as {
        session_id: string | null;
        qty: number;
      }[]) {
        if (!it.session_id) continue;
        bySession.set(
          it.session_id,
          (bySession.get(it.session_id) ?? 0) + (it.qty ?? 0),
        );
      }
      for (const [sessionId, qty] of bySession) {
        const { error } = await db.rpc("admin_adjust_seats", {
          p_session_id: sessionId,
          p_delta: qty,
        });
        if (error) {
          // 錢已經收了，不能因為名額沒同步就退回。留 log 讓客服對帳。
          console.error(
            "[blackcat/apn] 名額同步失敗，請人工確認場次報名人數",
            orderNo,
            sessionId,
            error.message,
          );
        }
      }
      if (bySession.size > 0) revalidatePath("/workshops");
    }
  }

  await db
    .from("payment_events")
    .update({
      outcome: "applied",
      note:
        `${updated ? "已標記付款" : "訂單原本就不是待付款"}；` +
        `開通 ${grant.granted} 門、既有 ${grant.kept} 門` +
        (grant.ok ? "" : `；開通失敗：${grant.reason ?? "unknown"}`),
    })
    .eq("provider", "blackcat")
    .eq("trans_id", transId)
    .eq("status_code", status);

  if (!grant.ok) {
    // 錢收了但課沒開通 —— 這是最嚴重的情況，一定要在 log 裡看得到。
    console.error("[blackcat/apn] 已收款但開通失敗", orderNo, grant.reason);
  }

  return ok();
}

/** GET 用來讓人確認網址填對了（黑貓 PAY 後台只吃 POST）。 */
export async function GET() {
  return new NextResponse("blackcat APN endpoint", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

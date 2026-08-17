import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";
import {
  hasHashBase,
  verifyReturnChkFail,
  verifyReturnChkSuccess,
} from "@/lib/payment/blackcat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 黑貓 PAY 授權完成／失敗後，把**客人的瀏覽器**導回這裡（GET + query string）。
 * 這個網址要填進黑貓 PAY 後台的「API - 重新導向回契客網址(完成)」。
 *
 * ⚠️ 這條路徑只負責帶客人回到我們站上看一個結果畫面，**不是開通課程的依據**。
 *    開通一律走 APN（server-to-server + 回查對方 API）。理由很簡單：
 *    導回是跑在客人瀏覽器上的，網址列的東西誰都能改；而且客人很可能
 *    在銀行頁面刷完卡就直接關掉分頁，這個 request 永遠不會發生。
 *
 * ⚠️ 失敗導回實務上收不到：規格 P48 明寫「僅玉山銀、中信銀可用，統一金流
 *    授權失敗後不會轉址，會停留在失敗結果頁」，而我們的收單行就是統一金流。
 *    程式還是把它處理掉，日後換收單行才不用回來補。
 */
function redirect(path: string) {
  return NextResponse.redirect(new URL(path, SITE.url), { status: 303 });
}

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (k: string) => q.get(k) ?? "";

  const orderNo = get("cust_order_no");
  const ret = get("ret");

  if (!orderNo) return redirect("/");

  const base = `/checkout/success?order=${encodeURIComponent(orderNo)}&pay=credit`;

  // 沒設定 hash_base 就驗不了簽。還是把客人帶回結果頁（他的錢已經刷了，
  // 不能因為我們少設一個環境變數就給他看錯誤畫面），但不宣稱付款成功。
  if (!hasHashBase()) {
    console.warn("[blackcat/return] 缺 BLACKCAT_HASH_BASE，無法驗簽");
    return redirect(base);
  }

  const verified =
    ret === "OK"
      ? verifyReturnChkSuccess({
          order_amount: get("order_amount"),
          send_time: get("send_time"),
          ret,
          acquire_time: get("acquire_time"),
          auth_code: get("auth_code"),
          card_no: get("card_no"),
          notify_time: get("notify_time"),
          cust_order_no: orderNo,
          chk: get("chk"),
        })
      : verifyReturnChkFail({
          order_amount: get("order_amount"),
          send_time: get("send_time"),
          ret,
          notify_time: get("notify_time"),
          cust_order_no: orderNo,
          chk: get("chk"),
        });

  if (!verified) {
    console.warn("[blackcat/return] chk 驗證失敗", { orderNo, ret });
    return redirect(base);
  }

  // 驗過了才敢在網址上帶付款結果 —— success 頁用它決定文案。
  // 即使帶了 authorized=1，那頁仍然要自己去 DB 確認狀態，不能只信網址。
  return redirect(ret === "OK" ? `${base}&authorized=1` : `${base}&failed=1`);
}

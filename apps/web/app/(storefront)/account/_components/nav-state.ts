/**
 * 會員中心側欄收合狀態的共用常數。
 *
 * 🔴 這支刻意**不加 `"use client"`**：
 *    server 的 layout.tsx 要用它讀 cookie，client 的 account-shell.tsx 要用它寫。
 *    字串寫死在兩個地方是另一種錯法 —— 改一邊忘另一邊不會有任何錯誤訊息，
 *    只會變成「設定存不起來」。
 *
 * 🔴 為什麼用 cookie 而不是 localStorage：
 *    localStorage 只有瀏覽器讀得到，伺服器渲染時不知道使用者的偏好，於是會
 *    先送出展開版、JS 跑起來才跳成收合版 —— 那是 **288px 的橫向位移**，
 *    持續時間等於「JS 下載 + hydration」，慢速連線上是 1–3 秒，不是一幀。
 *
 *    試過用 inline script 在第一次繪製前改 <html> 的屬性，畫面確實不閃了，
 *    但那會讓 server HTML 與 client 的 <html> 屬性對不起來，
 *    React 19 直接報 hydration mismatch。要壓下來就得在根 layout 加
 *    suppressHydrationWarning，等於把整個 <html> 的屬性檢查關掉。
 *
 *    改用 cookie 就沒有這些問題：/account 本來就是動態路由（要 getMember()），
 *    多讀一個 cookie 成本是零，而且伺服器送出來的 HTML 第一個位元組就是對的。
 */

export const ACCOUNT_NAV_COOKIE = "happyhands.account.nav";

/** path 限縮在 /account：其他頁面的請求不會白白帶著這個 cookie。 */
export const ACCOUNT_NAV_COOKIE_PATH = "/account";

export const ACCOUNT_NAV_COLLAPSED = "collapsed";
export const ACCOUNT_NAV_EXPANDED = "expanded";

export type AccountNavState =
  | typeof ACCOUNT_NAV_COLLAPSED
  | typeof ACCOUNT_NAV_EXPANDED;

export function toNavState(raw: string | undefined | null): AccountNavState {
  return raw === ACCOUNT_NAV_COLLAPSED
    ? ACCOUNT_NAV_COLLAPSED
    : ACCOUNT_NAV_EXPANDED;
}

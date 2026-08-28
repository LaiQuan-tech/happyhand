/**
 * 計數式的 body 捲動鎖。
 *
 * 🔴 為什麼要有這支：站上有兩個東西會鎖背景捲動 —— SiteHeader 的手機抽屜、
 *    AI 小幫手的手機對話面板。原本兩邊各寫各的：
 *
 *      site-header:   document.body.style.overflow = open ? "hidden" : ""
 *      helper-widget: const prev = ...; body.style.overflow = "hidden";
 *                     return () => { body.style.overflow = prev }
 *
 *    「無條件寫空字串」碰上「自己存 prev 再還原」，最終結果**完全取決於兩個
 *    元件在 layout 裡的先後順序**（React 先跑完所有 cleanup，再依樹序跑 setup）。
 *    目前 SiteHeader 排在 HelperWidget 前面，剛好是對的。但只要有人調換順序，
 *    helper 就會把 "hidden" 當成 prev 存起來，關閉面板時再還原回去 ——
 *    **整頁永遠捲不動，而且沒有任何錯誤訊息，重新整理才會好**。
 *
 *    抽屜現在會直接開啟對話面板（兩者真的在同一次 commit 交接），
 *    這個順序依賴不能再留著。
 *
 * 用法：
 *   useEffect(() => {
 *     if (!open) return;
 *     return lockBodyScroll();
 *   }, [open]);
 */

/** 目前有幾個東西要求鎖住。歸零才真的還原。 */
let locks = 0;
/** 第一個鎖上來之前的原始值。 */
let saved = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  // StrictMode 在開發模式會把 effect 的 cleanup 叫兩次。沒有這個旗標的話
  // locks 會被扣成負數，之後就再也回不到 0，鎖永遠解不開。
  let released = false;

  if (locks === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  locks += 1;

  return () => {
    if (released) return;
    released = true;
    locks -= 1;
    if (locks === 0) document.body.style.overflow = saved;
  };
}

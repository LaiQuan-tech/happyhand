import { ORDER_STATUS_TONE, isOrderStatus, orderStatusLabel } from "./shared";

/**
 * 訂單狀態 chip。列表與明細共用一份，避免兩邊的顏色慢慢漂移。
 *
 * 單獨開一個檔案而不是放在 page.tsx 裡匯出：
 * Next 會對 page.tsx 的匯出做白名單檢查（只允許 default / dynamic / metadata …），
 * 多匯出一個元件會讓 tsc 在 .next/types 那層報錯。
 *
 * 認不得的狀態不吞掉：orderStatusLabel() 會原樣顯示那個字串，
 * 色調走 danger，讓壞資料在畫面上看起來就是壞的。
 */
export function OrderStatusChip({ status }: { status: string }) {
  const tone = isOrderStatus(status) ? ORDER_STATUS_TONE[status] : "danger";
  const toneClass =
    tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-accent-ink";

  return (
    <span
      className={`inline-flex items-center rounded-pill bg-chip px-2.5 py-1 text-[12px] font-medium whitespace-nowrap ${toneClass}`}
    >
      {orderStatusLabel(status)}
    </span>
  );
}

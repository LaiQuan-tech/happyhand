import { formatTaipei } from "@/components/admin/datetime-field";
import type { CsvColumn } from "@/lib/admin/csv";
import type { RosterEntry } from "./queries";

/**
 * 報名名單 CSV 的欄位定義與檔名規則。
 *
 * 刻意抽出 route.ts：Next 的 route handler 只允許 export GET/POST… 那幾個名字，
 * 把欄位定義留在裡面就沒有任何辦法單獨測它。放在這裡，
 * 驗證腳本才驗得到「production 真正用的那一份」，而不是一份長得很像的複本。
 */

export const ROSTER_CSV_COLUMNS: CsvColumn<RosterEntry>[] = [
  // 姓名是使用者輸入，可能以 = + - @ 開頭 —— csvCell() 會前置單引號擋掉公式執行。
  { header: "姓名", value: (row) => row.name ?? "" },
  // forceText：0912345678 不包成 ="…" 的話 Excel 會當數字吃掉開頭的 0，
  // 客服照著打會打不通。
  { header: "電話", value: (row) => row.phone ?? "", forceText: true },
  { header: "Email", value: (row) => row.email ?? "" },
  // 訂單編號 HH-20260912-0001 會被 Excel 猜成日期或運算式，同樣強制文字。
  { header: "訂單編號", value: (row) => row.orderNo, forceText: true },
  { header: "人數", value: (row) => row.qty },
  { header: "付款時間", value: (row) => formatTaipei(row.paidAt) },
  { header: "備註", value: (row) => row.note ?? "" },
];

/**
 * CSV 檔名：快樂手報名名單_改寫根源記憶：療癒關係工作坊_20260912.csv
 *
 * 中文直接留著，交給 csvContentDisposition() 走 RFC 5987 的 filename* 編碼。
 * 這裡只拿掉在 Windows / macOS 檔名裡真的不合法的那幾個半形字元
 * （全形的「：」是合法的，保留才看得出原本的課程名）。
 */
export function rosterFilename(productTitle: string, startsAt: string): string {
  const date = formatTaipei(startsAt, false).replace(/\//g, "");
  const title = productTitle
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 40);
  return `快樂手報名名單_${title || "場次"}_${date || "無日期"}.csv`;
}

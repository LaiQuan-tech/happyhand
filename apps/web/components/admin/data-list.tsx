import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 後台清單：手機卡片 / 桌機表格，同一份資料只寫一次。
 *
 * goodday 那邊每個清單頁都手寫兩份 markup（`lg:hidden` 一份卡片、
 * `hidden lg:block` 一份 table），五頁就是十份，改一個欄位要記得改兩個地方
 * ——實際上就漂移過。這支把那個模式收斂成一個元件。
 *
 * 斷點用 admin:（1024px）不是 lg:（快樂手的 lg 是 1280）。
 * 用 lg: 的話 1024–1279 的筆電會拿到手機卡片版，那個寬度明明放得下表格。
 *
 * 用法：
 *   <DataList
 *     items={orders}
 *     keyOf={(o) => o.id}
 *     columns={[
 *       { header: "訂單編號", cell: (o) => o.order_no, primary: true },
 *       { header: "狀態", cell: (o) => <StatusChip .../>, trailing: true },
 *       { header: "金額", cell: (o) => formatMoney(o.total), align: "right" },
 *     ]}
 *     href={(o) => `/admin/orders/${o.id}`}
 *     empty="目前沒有訂單"
 *   />
 */

export type DataListColumn<T> = {
  /** 桌機的表頭；手機卡片拿來當該列的標籤 */
  header: string;
  cell: (item: T) => ReactNode;
  /** 手機卡片的標題行，同時是點擊進入詳情的連結。一份 columns 只該有一個。 */
  primary?: boolean;
  /** 手機卡片貼在標題行右側（狀態 chip 用） */
  trailing?: boolean;
  /** 桌機表格靠右對齊（金額、數量） */
  align?: "left" | "right";
  /** 桌機表格該欄的額外 class（欄寬、換行控制） */
  className?: string;
  /** 只在桌機表格顯示，手機卡片省略（次要到不值得佔手機一行的欄位） */
  desktopOnly?: boolean;
};

export type DataListProps<T> = {
  items: readonly T[];
  keyOf: (item: T) => string;
  columns: DataListColumn<T>[];
  /** 有值時 primary 欄會變成連結，手機卡片整張可點 */
  href?: (item: T) => string;
  /** 空狀態要是一句人話，不是空白表格 */
  empty: ReactNode;
  /** 每列的操作按鈕。手機在卡片底部、桌機在最後一欄。 */
  actions?: (item: T) => ReactNode;
  /** 給螢幕閱讀器的表格說明，預設沿用不出現在畫面上 */
  caption?: string;
};

export function DataList<T>({
  items,
  keyOf,
  columns,
  href,
  empty,
  actions,
  caption,
}: DataListProps<T>) {
  if (items.length === 0) {
    return (
      <div className="rounded-card border border-line bg-panel px-5 py-10 text-center text-[15px] text-ink-soft">
        {empty}
      </div>
    );
  }

  const primaryColumn = columns.find((column) => column.primary) ?? columns[0];
  const trailingColumns = columns.filter((column) => column.trailing && !column.desktopOnly);
  const metaColumns = columns.filter(
    (column) => column !== primaryColumn && !column.trailing && !column.desktopOnly,
  );

  return (
    <>
      {/* ---------- 手機：一列一張卡片，垂直堆疊不會水平溢出 ---------- */}
      <ul className="flex flex-col gap-2.5 admin:hidden">
        {items.map((item) => {
          const to = href?.(item);
          return (
            <li
              key={keyOf(item)}
              className="relative rounded-card border border-line bg-paper p-3.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 text-[15px] font-medium break-words text-ink">
                  {to ? (
                    // after:inset-0 讓整張卡片都是點擊區（拇指好按）；
                    // 下面 actions 用 z-[1] 疊上來，才不會被這層蓋掉。
                    <Link
                      href={to}
                      className="after:absolute after:inset-0 after:content-[''] hover:text-accent-ink"
                    >
                      {primaryColumn.cell(item)}
                    </Link>
                  ) : (
                    primaryColumn.cell(item)
                  )}
                </div>
                {trailingColumns.length > 0 && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    {trailingColumns.map((column) => (
                      <div key={column.header}>{column.cell(item)}</div>
                    ))}
                  </div>
                )}
              </div>

              {metaColumns.length > 0 && (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
                  {metaColumns.map((column) => (
                    <div key={column.header} className="contents">
                      <dt className="text-ink-soft">{column.header}</dt>
                      <dd className="min-w-0 break-words text-ink">{column.cell(item)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {actions && (
                <div className="relative z-[1] mt-3 flex flex-wrap items-center gap-2">
                  {actions(item)}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* ---------- 桌機：表格，一眼掃多筆最有效率 ---------- */}
      <div className="hidden overflow-x-auto rounded-card border border-line bg-paper admin:block">
        <table className="w-full border-collapse text-[14px]">
          <caption className="sr-only">{caption ?? "後台資料清單"}</caption>
          <thead>
            <tr className="border-b border-line bg-panel text-left text-ink-soft">
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={`px-4 py-2.5 font-medium whitespace-nowrap ${
                    column.align === "right" ? "text-right" : "text-left"
                  } ${column.className ?? ""}`}
                >
                  {column.header}
                </th>
              ))}
              {actions && (
                <th scope="col" className="px-4 py-2.5 text-right font-medium">
                  <span className="sr-only">操作</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const to = href?.(item);
              return (
                <tr
                  key={keyOf(item)}
                  className="border-b border-line/70 last:border-b-0 hover:bg-panel/70"
                >
                  {columns.map((column) => {
                    const content = column.cell(item);
                    const isPrimary = column === primaryColumn;
                    return (
                      <td
                        key={column.header}
                        className={`px-4 py-3 align-middle ${
                          column.align === "right" ? "text-right" : "text-left"
                        } ${isPrimary ? "font-medium text-ink" : "text-ink-soft"} ${
                          column.className ?? ""
                        }`}
                      >
                        {/* 只有主要欄位是連結，不把整個 <tr> 做成可點——
                            那會讓鍵盤使用者拿到一個沒有語意的可點區塊。 */}
                        {isPrimary && to ? (
                          <Link href={to} className="hover:text-accent-ink hover:underline">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                  {actions && (
                    <td className="px-4 py-3 text-right align-middle">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        {actions(item)}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

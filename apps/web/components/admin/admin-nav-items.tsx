import type { Capability } from "@/lib/admin/roles";

/**
 * 後台導覽的單一真相來源。
 *
 * 側欄（桌機）與底部分頁（手機）共用這一份定義，避免兩邊各自維護一份而漂移
 * —— 這是 goodday 那邊踩過的坑（見 goodday/docs/superpowers/specs/2026-07-20-admin-layout-design.md）。
 *
 * 圖示刻意用 inline SVG path 字串，不引入任何 icon 套件：
 * 六個圖示換不到一個 npm 依賴 + 一份 tree-shaking 設定。
 *
 * ⚠️ capability 只決定「要不要顯示這個入口」，那是體貼不是保護。
 *    每一支頁面與 server action 都必須自己再呼叫一次 requireCapability()。
 */

export type AdminNavItem = {
  href: string;
  label: string;
  /** 進入這個頁面所需的能力（lib/admin/roles.ts） */
  capability: Capability;
  /** SVG path 的 d 屬性，24x24 viewBox、stroke 樣式 */
  icon: string;
  /** true = 出現在手機底部分頁列 */
  primary?: boolean;
};

export const ADMIN_NAV: AdminNavItem[] = [
  {
    href: "/admin",
    label: "總覽",
    capability: "admin:access",
    icon: "M3 12h7V3H3v9Zm11 9h7v-9h-7v9ZM3 21h7v-6H3v6Zm11-12h7V3h-7v6Z",
    primary: true,
  },
  {
    href: "/admin/orders",
    label: "訂單",
    capability: "orders:read",
    icon: "M6 2h9l5 5v15H6V2Zm9 0v5h5M9 13h8M9 17h5",
    primary: true,
  },
  {
    href: "/admin/sessions",
    label: "場次報名",
    capability: "orders:read",
    icon: "M4 5h16v16H4V5Zm0 5h16M9 3v4M15 3v4M8 14h3v3H8v-3Z",
    primary: true,
  },
  {
    href: "/admin/products",
    label: "課程與工作坊",
    capability: "catalog:read",
    icon: "M4 4h5a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V4Zm16 0h-5a3 3 0 0 0-3 3v13a3 3 0 0 1 3-3h5V4Z",
    primary: true,
  },
  {
    href: "/admin/staff",
    label: "員工",
    capability: "staff:manage",
    icon: "M16 20v-1a4 4 0 0 0-8 0v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 9v-1a4 4 0 0 0-3-3.9",
  },
  {
    href: "/admin/audit",
    label: "稽核紀錄",
    capability: "audit:read",
    icon: "M5 3h9l5 5v13H5V3Zm9 0v5h5M8 12h8M8 16h5",
  },
];

/**
 * 目前路徑是否命中該項目。
 *
 * /admin 必須完全相符：用 startsWith 的話每一個子頁都會讓「總覽」跟著亮，
 * 使用者永遠看到兩個 active。其餘項目才用前綴比對（含子路徑 /admin/orders/xxx）。
 */
export function isAdminNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavIcon({
  d,
  className = "",
}: {
  d: string;
  className?: string;
}) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={d} />
    </svg>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/admin/roles";
import { ADMIN_NAV, AdminNavIcon, canSeeNavItem,
  isAdminNavActive } from "./admin-nav-items";

/**
 * 桌機（>= admin 斷點 1024px）固定左側欄。
 *
 * client component 只因為要 usePathname 判斷 active。
 * 角色由 server（app/admin/layout.tsx）傳進來，不在 client 查。
 *
 * sticky top-0：目前 /admin 仍被前台 layout 的 sticky SiteHeader 包住，
 * 側欄捲動時上緣會被那條 header 蓋一小截。根治是把前台外殼移進 route group
 * （見交付說明「發現但沒處理」），不是在這裡加 magic number 偏移。
 */
export function AdminSidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const items = ADMIN_NAV.filter((item) => canSeeNavItem(role, item));

  return (
    <aside className="hidden w-[220px] shrink-0 self-start border-r border-line bg-panel admin:sticky admin:top-0 admin:flex admin:max-h-svh admin:flex-col">
      <div className="border-b border-line px-5 py-4">
        <div className="font-serif text-[18px] leading-tight font-medium tracking-[0.06em] text-ink">
          快樂手
        </div>
        <div className="mt-1 text-[12px] tracking-[0.12em] text-ink-soft">
          後台管理
        </div>
      </div>

      <nav aria-label="後台主要導覽" className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-0.5">
          {items.map((item) => {
            const active = isAdminNavActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-10 items-center gap-3 rounded-input px-3 py-2 text-[14px] transition-colors ${
                    active
                      ? "bg-accent-soft font-medium text-ink"
                      : "text-ink-soft hover:bg-accent-soft/55 hover:text-ink"
                  }`}
                >
                  {/* active 不只靠顏色：左側色條 + 粗體 + aria-current（WCAG 1.4.1） */}
                  {active && (
                    <span
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-pill bg-accent-ink"
                      aria-hidden="true"
                    />
                  )}
                  <AdminNavIcon
                    d={item.icon}
                    className={active ? "text-accent-ink" : "text-ink-muted"}
                  />
                  <span className="min-w-0 truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-line px-5 py-4">
        <Link
          href="/"
          className="inline-flex min-h-10 items-center text-[13px] text-accent-ink hover:underline"
        >
          回前台
        </Link>
      </div>
    </aside>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { Role } from "@/lib/admin/roles";
import { ADMIN_NAV, AdminNavIcon, canSeeNavItem,
  isAdminNavActive } from "./admin-nav-items";

const MORE_ICON = "M5 12h.01M12 12h.01M19 12h.01";

/**
 * 手機（< admin 斷點 1024px）底部固定分頁列。
 *
 * 前台的 components/mobile-action-bar.tsx 也是 fixed bottom，但那支是逐頁手動放的
 * （app/page.tsx、app/courses/page.tsx…），/admin 底下沒有任何頁面會渲染它，不會打架。
 *
 * 「更多」是刻意的加碼：交辦說明只要求顯示 primary 項目，但 owner 的
 * 員工／稽核紀錄都不是 primary，照字面實作的話 owner 在手機上根本走不到那兩頁。
 * 只有「該角色存在有權限的非 primary 項目」時才會出現這顆按鈕，
 * 所以 support / editor 看到的仍然就是純 primary 分頁列。
 */
export function AdminBottomNav({ role }: { role: Role }) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);

  const permitted = ADMIN_NAV.filter((item) => canSeeNavItem(role, item));
  const primary = permitted.filter((item) => item.primary);
  const secondary = permitted.filter((item) => !item.primary);
  const moreActive = secondary.some((item) => isAdminNavActive(pathname, item.href));

  // 換頁後自動收起，否則點完選單它還開著擋住內容
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // 開啟時 Esc 可關閉。不鎖背景捲動——面板很矮，鎖了反而讓人以為當掉。
  useEffect(() => {
    if (!moreOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  if (primary.length === 0 && secondary.length === 0) return null;

  return (
    <>
      {moreOpen && (
        <button
          type="button"
          aria-label="關閉更多選單"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-40 cursor-default bg-brown-900/35 admin:hidden"
        />
      )}

      <div className="fixed inset-x-0 bottom-0 z-50 admin:hidden">
        {moreOpen && (
          <div className="absolute inset-x-0 bottom-full border-t border-line bg-paper p-2 shadow-float">
            <ul className="flex flex-col gap-0.5">
              {secondary.map((item) => {
                const active = isAdminNavActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-11 items-center gap-3 rounded-input px-3 text-[15px] ${
                        active
                          ? "bg-accent-soft font-medium text-ink"
                          : "text-ink-soft"
                      }`}
                    >
                      <AdminNavIcon
                        d={item.icon}
                        className={active ? "text-accent-ink" : "text-ink-muted"}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <nav
          aria-label="後台底部導覽"
          className="flex border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]"
        >
          {primary.map((item) => {
            const active = isAdminNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] leading-tight ${
                  active ? "font-medium text-accent-ink" : "text-ink-soft"
                }`}
              >
                {/* active 不只靠顏色：上緣色條 + 粗體 + aria-current */}
                <span
                  className={`absolute top-0 h-[3px] w-10 rounded-pill ${
                    active ? "bg-accent-ink" : "bg-transparent"
                  }`}
                  aria-hidden="true"
                />
                <AdminNavIcon d={item.icon} />
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            );
          })}

          {secondary.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              aria-expanded={moreOpen}
              className={`flex min-h-[54px] flex-1 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] leading-tight ${
                moreOpen || moreActive
                  ? "font-medium text-accent-ink"
                  : "text-ink-soft"
              }`}
            >
              <AdminNavIcon d={MORE_ICON} />
              更多
            </button>
          )}
        </nav>
      </div>
    </>
  );
}

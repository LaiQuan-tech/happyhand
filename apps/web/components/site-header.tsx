"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { NAV_LINKS, SITE } from "@/lib/site";
import { useCart } from "@/components/cart-provider";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { count } = useCart();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 border-b border-sand-300 bg-white/96 backdrop-blur-sm">
      {/* 桌機：置中對稱 */}
      <nav
        aria-label="主選單"
        className="mx-auto hidden max-w-maxw items-center justify-center gap-[40px] px-[40px] py-[26px] text-[18px] whitespace-nowrap text-brown-700 md:flex"
      >
        {NAV_LINKS.slice(0, 2).map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-caramel-dk">
            {l.label}
          </Link>
        ))}
        <Link
          href="/"
          aria-label="快樂手 首頁"
          className="flex min-h-[44px] items-center font-serif text-[26px] font-bold tracking-[0.14em] text-caramel-ink"
        >
          {SITE.brandZh}
        </Link>
        {NAV_LINKS.slice(2).map((l) => (
          <Link key={l.href} href={l.href} className="hover:text-caramel-dk">
            {l.label}
          </Link>
        ))}
      </nav>

      {/* 手機：三欄 */}
      <div className="flex items-center justify-between px-[20px] py-[18px] md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="開啟選單"
          aria-expanded={open}
          className="flex h-[44px] w-[44px] items-center justify-center text-[22px] text-[#8A6E4E]"
        >
          ☰
        </button>
        <Link
          href="/"
          aria-label="快樂手 首頁"
          className="flex min-h-[44px] items-center px-2 font-serif text-[21px] font-bold tracking-[0.14em] text-caramel-ink"
        >
          {SITE.brandZh}
        </Link>
        <Link
          href="/cart"
          aria-label={`購物車，${count} 件`}
          className="relative flex h-[44px] w-[44px] items-center justify-center text-[20px] text-[#8A6E4E]"
        >
          ♡
          {count > 0 && (
            <span className="absolute right-0 top-1 min-w-[20px] rounded-pill bg-caramel-ink px-1 text-[12px] leading-[20px] text-white">
              {count}
            </span>
          )}
        </Link>
      </div>

      {/* 手機抽屜 */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-brown-900/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 flex w-[86%] max-w-[340px] flex-col bg-white px-[24px] py-[20px] shadow-float">
            <div className="flex items-center justify-between">
              <span className="font-serif text-[21px] font-bold tracking-[0.14em] text-caramel-ink">
                {SITE.brandZh}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="關閉選單"
                className="flex h-[44px] w-[44px] items-center justify-center text-[24px] text-brown-700"
              >
                ✕
              </button>
            </div>
            <ul className="mt-[18px] flex flex-col">
              {NAV_LINKS.map((l) => (
                <li key={l.href} className="border-b border-sand-300">
                  <Link
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-[56px] items-center text-[19px] text-brown-900"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
              <li className="border-b border-sand-300">
                <Link
                  href="/account"
                  onClick={() => setOpen(false)}
                  className="flex min-h-[56px] items-center text-[19px] text-brown-900"
                >
                  我的課程
                </Link>
              </li>
            </ul>
            <a
              href={SITE.phoneHref}
              className="mt-[24px] flex min-h-[56px] items-center justify-center rounded-pill border-2 border-sand-400 text-[18px] text-brown-900"
            >
              打電話問 {SITE.phone}
            </a>
          </div>
        </div>
      )}
    </header>
  );
}

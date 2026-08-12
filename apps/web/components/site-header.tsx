"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { NAV_LINKS, SITE } from "@/lib/site";
import { useCart } from "@/components/cart-provider";

/** 購物車圖示。維持專案「不裝 icon 套件」的作法，直接內嵌 SVG。 */
function CartIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 4h2l2.2 10.4a1.6 1.6 0 0 0 1.6 1.3h7.9a1.6 1.6 0 0 0 1.6-1.2L20 7H6" />
      <circle cx="9.5" cy="19.5" r="1.4" />
      <circle cx="17" cy="19.5" r="1.4" />
    </svg>
  );
}

/** 會員圖示。窄桌機（768–1279）放不下「我的學習」四個字時用它代替。 */
function MemberIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4H10a3 3 0 0 1 2 .8A3 3 0 0 1 14 4h5.5A1.5 1.5 0 0 1 21 5.5v12a1.5 1.5 0 0 1-1.5 1.5H14a2 2 0 0 0-2 1 2 2 0 0 0-2-1H4.5A1.5 1.5 0 0 1 3 17.5v-12ZM12 6.8V19" />
    </svg>
  );
}

function Wordmark({ heightClass }: { heightClass: string }) {
  return (
    <Image
      src="/logo-wordmark.png"
      alt={SITE.brandZh}
      width={695}
      height={280}
      priority
      /* 沒有 sizes 的話 next/image 會挑 srcset 裡的大尺寸——實測會去抓
         w=1920 的版本，只為了顯示 28px 高的字標。字標最寬約 85px，
         給 90px 讓它挑得到小的變體。 */
      sizes="90px"
      className={`${heightClass} w-auto`}
    />
  );
}

/**
 * 桌機導覽連結。
 *
 * min-h-[44px] 不是為了滑鼠，是為了平板：md 斷點是 768px，
 * 所以 iPad 直向（768）與橫向（1024）拿到的都是這一組「桌機」導覽，
 * 而它們是觸控裝置。原本這幾個連結只有 27px 高，手指很難點準。
 */
const navLinkClass =
  "flex min-h-[44px] items-center hover:text-caramel-dk";

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const { count } = useCart();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Esc 關閉抽屜：手機也可能外接鍵盤，而且這是 dialog 的基本預期
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    /**
     * ⚠️ 抽屜刻意放在 <header> 外面。
     *
     * header 有 backdrop-blur-sm，而帶 backdrop-filter 的元素會成為
     * position:fixed 子孫的「包含塊」—— 抽屜的 fixed inset-0 會變成相對於
     * 只有 80px 高的 header，而不是視窗。結果是白色面板只有 header 那麼高，
     * 底下的選單項目直接疊在頁面內容上，看起來像背景透明。
     * 這不是背景色的問題，把 bg-white 改多深都沒有用。
     */
    <>
      <header className="sticky top-0 z-50 border-b border-sand-300 bg-white/96 backdrop-blur-sm">
        {/* 桌機：置中對稱的導覽 + 靠右的功能區 */}
        <div className="relative mx-auto hidden max-w-maxw md:block">
          {/* gap 在 md（768–1279）收窄：那個區間要同時放下五個導覽項目與右邊的
              功能區，用 40px 的話「聯絡我們」會被壓在「我的學習」底下。 */}
          <nav
            aria-label="主選單"
            className="flex items-center justify-center gap-[22px] px-[40px] py-[22px] text-[18px] whitespace-nowrap text-brown-700 lg:gap-[40px]"
          >
            {NAV_LINKS.slice(0, 2).map((l) => (
              <Link key={l.href} href={l.href} className={navLinkClass}>
                {l.label}
              </Link>
            ))}
            <Link
              href="/"
              aria-label="快樂手 首頁"
              className="flex min-h-[44px] items-center"
            >
              <Wordmark heightClass="h-[34px]" />
            </Link>
            {NAV_LINKS.slice(2).map((l) => (
              <Link key={l.href} href={l.href} className={navLinkClass}>
                {l.label}
              </Link>
            ))}
          </nav>

          {/*
            ⚠️ 這一組原本只存在於手機版，桌機完全沒有——
            結果是桌機使用者把課加進購物車、離開商品頁之後就再也找不到結帳入口，
            買完課也沒有任何地方進得了「我的學習」（只能自己打網址）。

            用絕對定位而不是把它塞進 nav 裡：設計稿的桌機版是
            「兩個連結｜字標｜兩個連結」的置中對稱，加進去會把字標推歪。
            這樣視覺維持對稱，功能補回來。
          */}
          <div className="absolute inset-y-0 right-[40px] flex items-center gap-[6px]">
            {/* md（768–1279）只放圖示，lg 以上才顯示文字：
                那個區間的水平空間不夠同時容納五個導覽項目與兩組文字。
                圖示模式一律靠 aria-label 交代語意，不是只留一個沒名字的圖形。 */}
            <Link
              href="/account"
              aria-label="我的學習"
              className="flex h-[44px] items-center justify-center rounded-input text-[17px] whitespace-nowrap text-brown-700 hover:text-caramel-dk max-lg:w-[44px] lg:px-[12px]"
            >
              <MemberIcon className="h-[23px] w-[23px] lg:hidden" />
              <span className="max-lg:hidden">我的學習</span>
            </Link>
            <Link
              href="/cart"
              aria-label={count > 0 ? `購物車，${count} 件` : "購物車，目前是空的"}
              className="relative flex h-[44px] w-[44px] items-center justify-center rounded-input text-brown-700 hover:text-caramel-dk"
            >
              <CartIcon className="h-[23px] w-[23px]" />
              {count > 0 && (
                <span
                  aria-hidden
                  className="absolute top-[2px] right-[2px] min-w-[19px] rounded-pill bg-caramel-dk px-[5px] text-center text-[12px] leading-[19px] text-white"
                >
                  {count}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* 手機：三欄 */}
        <div className="flex items-center justify-between px-[16px] py-[12px] md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="開啟選單"
            aria-expanded={open}
            aria-controls="mobile-menu"
            className="flex h-[44px] w-[44px] items-center justify-center rounded-input text-brown-700"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              className="h-[22px] w-[22px]"
              aria-hidden
            >
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>

          <Link
            href="/"
            aria-label="快樂手 首頁"
            className="flex min-h-[44px] items-center px-2"
          >
            <Wordmark heightClass="h-[28px]" />
          </Link>

          <Link
            href="/cart"
            aria-label={
              count > 0 ? `購物車，${count} 件` : "購物車，目前是空的"
            }
            className="relative flex h-[44px] w-[44px] items-center justify-center rounded-input text-brown-700"
          >
            <CartIcon className="h-[23px] w-[23px]" />
            {count > 0 && (
              <span className="absolute top-0 right-0 min-w-[20px] rounded-pill bg-caramel-dk px-[5px] text-center text-[12px] leading-[20px] font-medium text-white">
                {count}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* 手機抽屜 —— 必須留在 header 外面，理由見上方註解 */}
      {open && (
        <div
          id="mobile-menu"
          role="dialog"
          aria-modal="true"
          aria-label="主選單"
          className="fixed inset-0 z-[60] md:hidden"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="關閉選單"
            tabIndex={-1}
            className="absolute inset-0 h-full w-full cursor-default bg-brown-900/45"
          />

          <div className="absolute inset-y-0 left-0 flex w-[88%] max-w-[340px] flex-col bg-white shadow-float">
            <div className="flex shrink-0 items-center justify-between border-b border-sand-300 px-[20px] py-[12px]">
              <Wordmark heightClass="h-[28px]" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="關閉選單"
                autoFocus
                className="flex h-[44px] w-[44px] items-center justify-center rounded-input text-brown-700"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  className="h-[22px] w-[22px]"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* 選單項目多的時候要能捲，不然最下面的電話按鈕會被推出畫面 */}
            <nav aria-label="主選單" className="min-h-0 flex-1 overflow-y-auto">
              <ul className="flex flex-col px-[20px]">
                {NAV_LINKS.map((l) => (
                  <li key={l.href} className="border-b border-sand-300">
                    <Link
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="flex min-h-[58px] items-center text-[19px] text-brown-900"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
                <li className="border-b border-sand-300">
                  <Link
                    href="/account"
                    onClick={() => setOpen(false)}
                    className="flex min-h-[58px] items-center text-[19px] text-brown-900"
                  >
                    {/* 用詞跟會員中心的標題對齊。全站有三個地方寫「我的課程」、
                        會員中心卻叫「我的學習」，長輩會以為是兩個不同的東西。 */}
                    我的學習
                  </Link>
                </li>
                <li className="border-b border-sand-300">
                  <Link
                    href="/cart"
                    onClick={() => setOpen(false)}
                    className="flex min-h-[58px] items-center gap-[10px] text-[19px] text-brown-900"
                  >
                    <CartIcon className="h-[21px] w-[21px] text-brown-500" />
                    購物車
                    {count > 0 && (
                      <span className="min-w-[22px] rounded-pill bg-caramel-dk px-[6px] text-center text-[13px] leading-[22px] text-white">
                        {count}
                      </span>
                    )}
                  </Link>
                </li>
              </ul>
            </nav>

            <div className="shrink-0 border-t border-sand-300 px-[20px] pt-[16px] pb-[calc(16px+env(safe-area-inset-bottom))]">
              <p className="mb-[8px] text-[15px] text-brown-500">
                找不到要的東西？直接用 LINE 問我們
              </p>
              <a
                href={SITE.lineHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-[56px] items-center justify-center rounded-pill bg-caramel-ink text-[18px] text-white"
              >
                用 LINE 問我們
                <span className="sr-only">（會開啟 LINE）</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

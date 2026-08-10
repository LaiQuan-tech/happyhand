import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SITE } from "@/lib/site";
import { PageHero } from "@/app/_components/page-hero";

export const metadata: Metadata = {
  title: "連結不能用了",
  robots: { index: false, follow: false },
};

/**
 * 信件連結失效的說明頁。
 *
 * 為什麼值得一整頁而不是 /login?error=：
 * 這是 60–75 歲客群**命中率最高**的技術陷阱，而且他們遇到的時候
 * 最需要的是「這不是你的錯」加上「按這裡就好」。
 * 在登入頁上配一句紅字錯誤，他們的第一個反應會是「我是不是打錯密碼」，
 * 然後開始試各種密碼，最後打電話來說「我登不進去」。
 *
 * 文案刻意把 Supabase 的實際行為講白：連結一次性、一小時失效、
 * 再要一次會讓前一封失效。最後一點很重要 —— 沒講的話，
 * 按了兩次「忘記密碼」的人會拿著第一封信一直試。
 */
export default function LinkExpiredPage() {
  return (
    <div className="pb-[80px]">
      <PageHero
        eyebrow="LINK"
        title="這個連結不能用了"
        lead="這不是你做錯什麼，再寄一次就好。"
      />

      <div className="mx-auto max-w-[720px] px-[20px] md:px-[40px]">
        <div className="rounded-card border border-sand-300 bg-cream-100 px-[22px] py-[26px] md:px-[36px] md:py-[34px]">
          <h2 className="t-h3 text-brown-900">為什麼會這樣</h2>
          <ul className="t-body mt-[14px] flex flex-col gap-[10px] text-pretty text-brown-700">
            <li>・信裡的連結<strong className="font-semibold">只能用一次</strong>，而且過一個小時就會失效。</li>
            <li>
              ・如果你按了兩次「忘記密碼」，
              <strong className="font-semibold">舊的那一封會自動失效</strong>，
              請用最新收到的那一封。
            </li>
            <li>・已經用這個連結設定過密碼的話，直接去登入就可以了。</li>
          </ul>

          <div className="mt-[26px] flex flex-col gap-[12px] sm:flex-row">
            <Link
              href="/forgot-password"
              className={buttonClass({
                variant: "primary",
                size: "lg",
                fullWidth: true,
                className: "sm:w-auto",
              })}
            >
              再寄一次
            </Link>
            <Link
              href="/login"
              className={buttonClass({
                variant: "outline",
                size: "lg",
                fullWidth: true,
                className: "sm:w-auto",
              })}
            >
              我要登入
            </Link>
          </div>

          <p className="t-body-sm mt-[22px] text-pretty text-brown-500">
            試過還是不行嗎？
            <a
              href={SITE.lineHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-caramel-dk hover:underline"
            >
              用 LINE 問我們
              <span className="sr-only">（會開啟 LINE）</span>
            </a>
            ，報你的名字就好，我們直接幫你處理。
          </p>
        </div>
      </div>
    </div>
  );
}

import Link from "next/link";
import Image from "next/image";
import { SITE, NAV_LINKS } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-sand-300 bg-white">
      <div className="mx-auto grid max-w-maxw gap-[28px] px-[20px] py-[40px] md:grid-cols-[1.2fr_1fr_1fr] md:px-[40px] md:py-[56px]">
        <div>
          <Image
            src="/logo-wordmark.png"
            alt={SITE.brandZh}
            width={695}
            height={280}
            sizes="90px"
            className="h-[30px] w-auto"
          />
          <div className="t-micro mt-[10px] tracking-[0.14em] text-brown-300">
            {SITE.brandEn}
          </div>
          <p className="t-body-sm mt-[16px] text-brown-500">
            {SITE.company} {SITE.companyEn}
            <br />
            統一編號 {SITE.taxId}・代表人 {SITE.representative}
            <br />
            {SITE.address}
          </p>
        </div>

        <nav aria-label="頁尾選單">
          <h2 className="t-caption font-medium text-brown-900">網站導覽</h2>
          <ul className="mt-[12px] flex flex-col">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="flex min-h-[44px] items-center text-[17px] text-brown-500 hover:text-caramel-dk"
                >
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                href="/about"
                className="flex min-h-[44px] items-center text-[17px] text-brown-500 hover:text-caramel-dk"
              >
                品牌介紹
              </Link>
            </li>
            {/* 買過課的人回來時要找得到入口。原本全站只有手機版抽屜有，
                桌機使用者只能自己打網址。 */}
            <li>
              <Link
                href="/account"
                className="flex min-h-[44px] items-center text-[17px] text-brown-500 hover:text-caramel-dk"
              >
                我的學習
              </Link>
            </li>
            <li>
              <Link
                href="/terms"
                className="flex min-h-[44px] items-center text-[17px] text-brown-500 hover:text-caramel-dk"
              >
                服務條款與退費規定
              </Link>
            </li>
          </ul>
        </nav>

        <div>
          <h2 className="t-caption font-medium text-brown-900">有問題想問</h2>
          {/* 外部連結，要自己帶 target/rel — LinkButton 對外部連結不會轉發這些屬性 */}
          <a
            href={SITE.lineHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-[12px] flex min-h-[56px] w-full items-center justify-center rounded-pill border-2 border-sand-400 text-[18px] text-brown-900 transition-colors duration-200 hover:bg-[#F5E7CE] md:w-auto md:px-[28px]"
          >
            用 LINE 問我們
            <span className="sr-only">（會開啟 LINE）</span>
          </a>
          {/* CONTENT.md：說明文字最小 16px，所以這裡不用 t-micro(15px) */}
          <p className="t-caption mt-[14px] text-brown-500">
            服務時間 週一至週五 10:00–18:00
          </p>
        </div>
      </div>

      <div className="border-t border-sand-300">
        <div className="mx-auto max-w-maxw px-[20px] py-[20px] md:px-[40px]">
          {/* 免責聲明是法規要求的內容，不可以縮到 15px 灰字 */}
          <p className="t-caption text-brown-500">{SITE.disclaimer}</p>
          <p className="t-caption mt-2 text-brown-500">{SITE.copyright}</p>
        </div>
      </div>
    </footer>
  );
}

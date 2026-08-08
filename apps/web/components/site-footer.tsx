import Link from "next/link";
import { SITE, NAV_LINKS } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-sand-300 bg-white">
      <div className="mx-auto grid max-w-maxw gap-[28px] px-[20px] py-[40px] md:grid-cols-[1.2fr_1fr_1fr] md:px-[40px] md:py-[56px]">
        <div>
          <div className="font-serif text-[22px] font-bold tracking-[0.14em] text-caramel-ink">
            {SITE.brandZh}
          </div>
          <div className="t-micro mt-2 tracking-[0.14em] text-brown-300">
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
          </ul>
        </nav>

        <div>
          <h2 className="t-caption font-medium text-brown-900">有問題想問</h2>
          <a
            href={SITE.phoneHref}
            className="mt-[12px] flex min-h-[56px] w-full items-center justify-center rounded-pill border-2 border-sand-400 text-[18px] text-brown-900 transition-colors duration-200 hover:bg-[#F5E7CE] md:w-auto md:px-[28px]"
          >
            打電話問 {SITE.phone}
          </a>
          <p className="t-micro mt-[14px] text-brown-300">
            服務時間 週一至週五 10:00–18:00
          </p>
        </div>
      </div>

      <div className="border-t border-sand-300">
        <div className="mx-auto max-w-maxw px-[20px] py-[20px] md:px-[40px]">
          <p className="t-micro text-brown-300">{SITE.disclaimer}</p>
          <p className="t-micro mt-2 text-brown-300">{SITE.copyright}</p>
        </div>
      </div>
    </footer>
  );
}

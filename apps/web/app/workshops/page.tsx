import type { Metadata } from "next";
import { LinkButton } from "@/components/ui/button";
import { MobileActionBar } from "@/components/mobile-action-bar";
import { SITE } from "@/lib/site";
import { getProducts, getWorkshopSessions } from "@/lib/data";
import { SessionRow } from "./_components/session-row";
import { NoSessions } from "./_components/no-sessions";

export const metadata: Metadata = {
  title: "工作坊場次",
  description:
    "快樂手實體工作坊場次表。小班制，老師會一個一個看過去，工具跟講義都準備好了，空手來就行。想問哪一場適合你，打 02-2833-5820。",
};

/**
 * /workshops — 工作坊列表
 * 設計稿 happyhands-B-all-pages.dc.html：桌機 L465–549、手機 L551–615；規格 README §4.4。
 * 垂直卡片列（非網格），桌機每列 grid 96px/1fr/auto/auto，手機上下堆疊、CTA 滿版。
 */
export default async function WorkshopsPage() {
  const [sessions, products] = await Promise.all([
    getWorkshopSessions(),
    getProducts(),
  ]);

  // 只有 type=workshop 的商品才有單場詳情頁，其餘（例如讀脈入門課的實體班）標題不做連結，避免連到 404
  const workshopSlugs = new Set(
    products.filter((p) => p.type === "workshop").map((p) => p.slug),
  );

  return (
    <div className="pb-action-bar">
      {/* 標題帶（設計稿 L480–484 桌機／L558–562 手機） */}
      <section className="bg-cream-100 px-[20px] py-[32px] text-center md:px-[40px] md:py-[56px]">
        {/* 間距用 flex gap，不用 margin：t-h1/t-h2/t-h3 utility 自帶 margin:0 會蓋掉 mt-* */}
        <div className="mx-auto flex max-w-[720px] flex-col items-center gap-[12px]">
          <span className="t-eyebrow text-caramel-ink">WORKSHOPS</span>
          <h1 className="t-h2">跟老師面對面練一次</h1>
          <p className="t-body-lg text-brown-500">
            小班制，八到十個人，老師會一個一個看過去。工具跟講義都準備好了，你空手來就行。
          </p>
          {/* 桌機沒有底部行動列，這裡補一個打電話的出口 */}
          <div className="hidden w-full pt-[8px] md:block md:w-auto">
            <LinkButton href={SITE.phoneHref} variant="outline">
              打電話問場次 {SITE.phone}
            </LinkButton>
          </div>
        </div>
      </section>

      {/* 場次列表（設計稿 L491–539 桌機／L569–609 手機） */}
      <section className="px-[20px] py-[28px] md:px-[40px] md:py-[48px]">
        <div className="mx-auto max-w-maxw">
          <h2 className="sr-only">近期場次</h2>

          {sessions.length === 0 ? (
            <NoSessions />
          ) : (
            <ul className="flex list-none flex-col gap-[14px]">
              {sessions.map((s) => (
                <SessionRow
                  key={s.id ?? `${s.slug}-${s.starts_at}`}
                  session={s}
                  detailHref={
                    workshopSlugs.has(s.slug) ? `/workshops/${s.slug}` : null
                  }
                />
              ))}
            </ul>
          )}

          {/* 包班詢問（設計稿 L540–546） */}
          <div className="mt-[14px] flex flex-col gap-[16px] rounded-sm border border-dashed border-sand-400 p-[20px] md:flex-row md:items-center md:justify-between md:gap-[24px] md:p-[26px_30px]">
            <div>
              <h2 className="font-serif text-[19px] font-semibold text-brown-900 md:text-[21px]">
                想揪一群朋友一起上？
              </h2>
              <p className="mt-[8px] text-[17px] leading-[1.9] text-brown-500">
                滿 6 人可以另外安排包班，地點時間都能談。
              </p>
            </div>
            <LinkButton
              href={SITE.phoneHref}
              variant="outline"
              className="w-full whitespace-nowrap md:w-auto"
            >
              問包班
            </LinkButton>
          </div>

          <p className="mt-[24px] t-caption text-brown-300">
            {SITE.disclaimer}
          </p>
        </div>
      </section>

      {/* 主要動作就是撥號，關掉左邊的電話鈕改成單顆滿版，長輩更好按 */}
      <MobileActionBar
        href={SITE.phoneHref}
        label={`打電話報名 ${SITE.phone}`}
        showPhone={false}
      />
    </div>
  );
}

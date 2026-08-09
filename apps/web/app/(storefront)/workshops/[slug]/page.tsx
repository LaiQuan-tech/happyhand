import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Figure } from "@/components/ui/placeholder";
import { LinkButton, buttonClass } from "@/components/ui/button";
import { MobileActionBar } from "@/components/mobile-action-bar";
import { SITE } from "@/lib/site";
import { getProduct, getWorkshopSessions, getPublishedSlugs } from "@/lib/data";
import { SessionRow } from "../_components/session-row";
import { NoSessions } from "../_components/no-sessions";

type PageProps = { params: Promise<{ slug: string }> };

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  const slugs = await getPublishedSlugs("workshop");
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product || product.type !== "workshop") {
    return { title: "找不到這個工作坊" };
  }
  return {
    title: product.title,
    description:
      product.description ||
      `${product.title}｜${product.subtitle}。想問哪一場適合你，打 ${SITE.phone}。`,
    openGraph: {
      title: `${product.title}｜快樂手`,
      description: product.description,
      type: "article",
    },
  };
}

/**
 * /workshops/[slug] — 單場工作坊詳情
 * 設計稿沒有這一頁，沿用課程頁與工作坊列表的語彙（封面 16:9、標題帶、場次列、地點、注意事項）。
 */
export default async function WorkshopDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const [product, allSessions] = await Promise.all([
    getProduct(slug),
    getWorkshopSessions(),
  ]);

  if (!product || product.type !== "workshop") notFound();

  const sessions = allSessions.filter((s) => s.slug === slug);
  const openSession = sessions.find((s) => s.capacity - s.seats_taken > 0);
  const venue = sessions[0];
  const address = venue?.address ?? SITE.address;
  const venueName = venue?.location ?? "好日子・台北教室";
  const mapHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    address,
  )}`;

  const openSessionKey = openSession
    ? (openSession.id ?? `${openSession.slug}@${openSession.starts_at}`)
    : null;

  return (
    <div className="pb-action-bar">
      {/* 標題與封面 */}
      <section className="mx-auto max-w-maxw px-[20px] pt-[20px] pb-[28px] md:px-[40px] md:pt-[32px] md:pb-[48px]">
        <Link
          href="/workshops"
          className="inline-flex min-h-[56px] items-center text-[17px] text-brown-700 transition-colors duration-200 hover:text-caramel-ink"
        >
          <span aria-hidden="true">←&nbsp;</span>回工作坊場次
        </Link>

        <Figure
          src={product.cover_url}
          alt={`${product.title} 上課現場`}
          label="workshop cover 16:9"
          rounded="rounded-card"
          className="mt-[12px] aspect-[16/9] w-full max-w-[860px]"
          sizes="(min-width: 900px) 860px, 100vw"
          priority
        />

        {/* 間距用 flex gap，不用 margin：t-h1/t-h2/t-h3 utility 自帶 margin:0 會蓋掉 mt-* */}
        <div className="mt-[24px] flex max-w-[760px] flex-col gap-[10px]">
          <span className="t-eyebrow text-caramel-ink">WORKSHOP</span>
          <h1 className="t-h1">{product.title}</h1>
          {product.subtitle && (
            <p className="t-body-lg text-brown-500">{product.subtitle}</p>
          )}
          <p className="t-body text-brown-500">{product.description}</p>

          {product.benefits.length > 0 && (
            <ul className="mt-[10px] flex list-none flex-wrap gap-[10px]">
              {product.benefits.map((b) => (
                <li
                  key={b}
                  className="rounded-pill border border-sand-500 px-[20px] py-[10px] text-[16px] text-brown-700"
                >
                  {b}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 場次列表 */}
      <section
        id="sessions"
        className="bg-cream-100 px-[20px] py-[32px] md:px-[40px] md:py-[48px]"
      >
        <div className="mx-auto max-w-maxw">
          <h2 className="t-h2">場次與報名</h2>
          <p className="t-body-sm mt-[10px] text-brown-500">
            {`選一個你方便的日子，按「我要報名」就可以了。不方便線上付款的話，打 ${SITE.phone} 我們幫你代訂。`}
          </p>

          <div className="mt-[20px]">
            {sessions.length === 0 ? (
              <NoSessions
                message={`這門工作坊最近沒有安排場次，想知道下一場什麼時候開，打 ${SITE.phone} 問我們。`}
              />
            ) : (
              <ul className="flex list-none flex-col gap-[14px]">
                {sessions.map((s) => (
                  <SessionRow
                    key={s.id ?? `${s.slug}-${s.starts_at}`}
                    session={s}
                    showTitle={false}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* 地點與注意事項 */}
      <section className="mx-auto max-w-maxw px-[20px] py-[32px] md:px-[40px] md:py-[48px]">
        <div className="flex flex-col gap-[24px] md:flex-row md:gap-[40px]">
          <div className="md:flex-1">
            <h2 className="t-h3">上課地點</h2>
            <p className="t-body mt-[10px] text-brown-500">{venueName}</p>
            <p className="t-body mt-[4px] text-brown-500">{address}</p>
            <div className="mt-[16px] flex flex-col flex-wrap gap-[10px] md:flex-row">
              {/* 用原生 <a> 是為了帶 target/rel — LinkButton 對外部連結不會轉發這些屬性 */}
              <a
                href={mapHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({
                  variant: "outline",
                  className: "w-full shrink-0 whitespace-nowrap md:w-auto",
                })}
              >
                看 Google 地圖
                <span className="sr-only">（另開新視窗）</span>
              </a>
              <LinkButton
                href={SITE.phoneHref}
                variant="outline"
                className="w-full shrink-0 whitespace-nowrap md:w-auto"
              >
                打電話問路 {SITE.phone}
              </LinkButton>
            </div>
          </div>

          <div className="md:flex-1">
            <h2 className="t-h3">來之前先知道</h2>
            <ul className="mt-[10px] flex list-none flex-col gap-[10px]">
              {[
                "工具跟講義我們都準備好了，你空手來就行。",
                "開課前七天跟我們說一聲，可以改期一次。",
                "額滿了還是可以打電話登記候補，有人取消我們會通知你。",
                "膝蓋、腰不舒服都可以坐著做，現場有助教會陪你。",
                `其他不確定的事，打 ${SITE.phone} 問我們，我們慢慢跟你講。`,
              ].map((t) => (
                <li
                  key={t}
                  className="t-body-sm flex gap-[10px] text-brown-500"
                >
                  <span aria-hidden="true" className="text-caramel-ink">
                    ・
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-[28px] t-caption text-brown-300">{SITE.disclaimer}</p>
      </section>

      <MobileActionBar
        href={
          openSessionKey
            ? `/checkout?session=${encodeURIComponent(openSessionKey)}`
            : "/workshops"
        }
        label={openSessionKey ? "我要報名" : "看其他場次"}
      />
    </div>
  );
}

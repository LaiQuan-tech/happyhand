import Link from "next/link";
import { LinkButton } from "@/components/ui/button";
import { SITE, formatPrice } from "@/lib/site";
import { timeRange, twDate, type WorkshopRow } from "@/lib/data";

/**
 * 工作坊場次列。
 * 設計稿 happyhands-B-all-pages.dc.html：桌機 L492–539、手機 L570–608。
 *
 * 桌機（>=768px）：grid 96px / 1fr / auto / auto，gap 28px，cream-400 底、radius 18px、padding 24px 30px。
 * 手機（<768px）：上下堆疊 — 日期方塊與標題同一行 → 地點時間 → 價格名額 → CTA 滿版，padding 20px。
 *
 * 額滿（剩餘 <= 0）時 CTA 換成 sand-400 底、文案「已額滿・我要候補」，
 * 仍是可以點的連結（撥打電話候補），不是 disabled。
 */
export function SessionRow({
  session,
  detailHref,
  showTitle = true,
}: {
  session: WorkshopRow;
  /** 有值時標題可以點進單場詳情；沒有就是純文字 */
  detailHref?: string | null;
  /** 單場詳情頁已經有大標，不必再重複商品名 */
  showTitle?: boolean;
}) {
  const { month, day, weekday } = twDate(session.starts_at);
  const remaining = session.capacity - session.seats_taken;
  const soldOut = remaining <= 0;
  const almostFull = remaining <= 5;

  // lib/data.ts 的 twDate 目前會吐出「9月 月」與「12日」
  //（Intl zh-TW 的 numeric month/day 本身就帶單位，外面又加了一次）。
  // 這裡做冪等的正規化：共用層修好之後這兩行仍然安全。
  const monthLabel = month.replace(/\s+/g, "").replace(/月+$/, "月");
  const dayLabel = day.replace(/日+$/, "");

  // 語音朗讀用的完整日期，例如「9月12日（週六）」
  const dateText = `${monthLabel}${dayLabel}日（${weekday}）`;
  const sessionKey = session.id ?? `${session.slug}@${session.starts_at}`;
  const checkoutHref = `/checkout?session=${encodeURIComponent(sessionKey)}`;

  // 地點與時間。有標題時排在標題下方；沒有標題（單場詳情頁）時直接接在日期方塊旁邊
  const locationLine = (
    <p
      className={
        showTitle
          ? "mt-[12px] min-w-0 text-[17px] leading-[1.8] text-brown-500 md:col-start-2 md:row-start-2 md:mt-[8px]"
          : "min-w-0 text-[17px] leading-[1.8] text-brown-500 md:col-start-2 md:row-span-2 md:row-start-1"
      }
    >
      {session.location}・{timeRange(session.starts_at, session.ends_at)}
    </p>
  );

  return (
    <li className="rounded-sm bg-cream-400 p-[20px] md:grid md:grid-cols-[96px_1fr_auto_auto] md:grid-rows-[auto_auto] md:items-center md:gap-x-[20px] md:p-[24px_30px] lg:gap-x-[28px]">
      {/* 日期方塊與標題：手機同一行；桌機 display:contents 讓兩者各自成為 grid item */}
      <div className="flex items-center gap-[14px] md:contents">
        <div className="shrink-0 rounded-input bg-white px-[12px] py-[8px] text-center md:col-start-1 md:row-span-2 md:row-start-1 md:bg-transparent md:p-0">
          <div className="t-micro tracking-[0.1em] text-brown-300">
            {monthLabel}
          </div>
          <div className="font-serif text-[26px] font-semibold leading-[1.1] text-brown-900 md:text-[34px]">
            {dayLabel}
          </div>
          <div className="t-micro text-brown-300">{weekday}</div>
        </div>

        {!showTitle && locationLine}

        {showTitle && (
          <h3 className="t-h3 min-w-0 md:col-start-2 md:row-start-1">
            {detailHref ? (
              <Link
                href={detailHref}
                /* -my/py 對消：點擊區補到 56px（樂齡族需求），但不撐開列高。
                   t-h3 在 375px 是 20px×1.4 = 28px 行高，加上下 14px 剛好 56px。 */
                className="-my-[14px] inline-block py-[14px] transition-colors duration-200 hover:text-caramel-ink"
              >
                {session.title}
              </Link>
            ) : (
              session.title
            )}
          </h3>
        )}
      </div>

      {showTitle && locationLine}

      {/* 價格與名額 */}
      <div className="mt-[12px] flex items-baseline gap-[12px] md:col-start-3 md:row-span-2 md:row-start-1 md:mt-0 md:block md:text-right">
        <span className="font-serif text-[23px] font-semibold text-caramel-ink md:text-[24px]">
          {formatPrice(session.price)}
        </span>
        {soldOut ? (
          <span className="block text-[16px] text-brown-300 md:mt-[4px]">
            已額滿
          </span>
        ) : (
          <span
            className={`block text-[16px] md:mt-[4px] ${
              almostFull ? "text-caramel-ink" : "text-brown-500"
            }`}
          >
            剩 {remaining} 位
          </span>
        )}
      </div>

      {/* CTA */}
      {/* min-w 讓「已額滿・我要候補」與「我要報名」佔一樣寬的欄，各列價格才會對齊 */}
      <div className="mt-[14px] md:col-start-4 md:row-span-2 md:row-start-1 md:mt-0 md:flex md:min-w-[208px] md:justify-end">
        {soldOut ? (
          <LinkButton
            href={SITE.phoneHref}
            variant="dark"
            className="w-full whitespace-nowrap bg-sand-400! hover:bg-caramel-ink! md:w-auto"
          >
            {/* 視覺文案與朗讀文案分開：畫面看得出額滿，語音直接說可以打電話候補 */}
            <span aria-hidden="true">已額滿・我要候補</span>
            <span className="sr-only">已額滿，打電話候補</span>
          </LinkButton>
        ) : (
          <LinkButton
            href={checkoutHref}
            variant="dark"
            className="w-full whitespace-nowrap md:w-auto"
            aria-label={`我要報名：${session.title} ${dateText}`}
          >
            我要報名
          </LinkButton>
        )}
      </div>
    </li>
  );
}

import { LinkButton } from "@/components/ui/button";
import type { WorkshopRow } from "@/lib/data";
import { SessionRow } from "@/app/(storefront)/workshops/_components/session-row";
import { NoSessions } from "@/app/(storefront)/workshops/_components/no-sessions";

/**
 * 首頁的工作坊區塊。
 *
 * 為什麼放在課程卡之後、老師之前：
 * 線上課是低門檻的入口，工作坊是更高的承諾也是更高的客單價（6,800 vs 3,600），
 * 而且它有「特定日期 + 剩幾位」這種線上課沒有的具體性與稀缺感。
 * 先讓人知道有這個選項，再用老師的段落收信任，最後才是聯絡出口。
 *
 * 刻意重用 /workshops 的 SessionRow 而不是另刻一版卡片：
 * 同一種東西在站上長得不一樣會讓人以為是兩件事，而且那個元件的
 * RWD 已經驗過（390px 無溢出、觸控區達標），另刻等於重新承擔一次風險。
 *
 * 只顯示最近兩場。首頁的任務是「讓人知道有實體課、下一場什麼時候」，
 * 不是把場次表搬過來。
 */
export function HomeWorkshops({
  sessions,
  workshopSlugs,
}: {
  sessions: WorkshopRow[];
  /** 只有 type=workshop 的商品有單場詳情頁，其餘（例如讀脈入門課的實體班）標題不做連結 */
  workshopSlugs: Set<string>;
}) {
  const upcoming = sessions.slice(0, 2);
  const more = sessions.length - upcoming.length;

  return (
    <section
      aria-labelledby="home-workshops-title"
      className="border-t border-sand-300 bg-white px-[20px] py-[40px] md:px-[40px] md:py-[76px]"
    >
      <div className="mx-auto max-w-[1080px]">
        <div className="text-center">
          <p className="t-eyebrow text-caramel-ink">WORKSHOPS</p>
          <h2 id="home-workshops-title" className="t-h2 mt-[10px]">
            也可以跟老師面對面練一次
          </h2>
          <p className="t-body mx-auto mt-[14px] max-w-[620px] text-pretty text-brown-500">
            小班制，八到十個人，老師會一個一個看過去。工具跟講義都準備好了，你空手來就行。
          </p>
        </div>

        <div className="mt-[24px] md:mt-[36px]">
          {upcoming.length === 0 ? (
            <NoSessions message="最近沒有安排實體場次。想知道下一場什麼時候開，用 LINE 問我們，開課前會先告訴你。" />
          ) : (
            <ul className="flex list-none flex-col gap-[14px]">
              {upcoming.map((s) => (
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
        </div>

        {/* 還有其他場次時才給出口。只有兩場的話這顆按鈕會把人帶到一模一樣的內容。 */}
        {more > 0 && (
          <div className="mt-[20px] text-center md:mt-[28px]">
            <LinkButton href="/workshops" variant="outline">
              看全部 {sessions.length} 場場次
            </LinkButton>
          </div>
        )}
      </div>
    </section>
  );
}

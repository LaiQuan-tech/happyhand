import { SITE } from "@/lib/site";

/**
 * 焦糖色「打電話問」出口（設計稿 930–933 行桌機、973–977 行手機）
 * 每一頁都要有這一段（README 無障礙需求：每頁都要有打電話的出口）。
 * 手機稿的白色撥號鈕在桌機也保留，桌機改為置中的膠囊按鈕。
 */
export function CallBand({
  heading = (
    <>
      想問什麼都可以，
      <br className="md:hidden" />
      我們有真人接電話
    </>
  ),
  note,
}: {
  heading?: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <section className="bg-caramel text-white">
      <div className="mx-auto max-w-maxw px-[20px] py-[34px] text-center md:px-[40px] md:py-[56px]">
        <h2 className="font-serif text-[22px] leading-[1.55] font-medium md:text-[30px] md:leading-[1.4]">
          {heading}
        </h2>

        {note && (
          <p className="t-body-sm mx-auto mt-[12px] max-w-[620px] text-pretty text-white">
            {note}
          </p>
        )}

        <a
          href={SITE.phoneHref}
          className="mx-auto mt-[18px] flex min-h-[56px] w-full items-center justify-center rounded-pill bg-white px-[24px] text-[19px] text-brown-900 transition-colors duration-200 hover:bg-cream-200 md:mt-[24px] md:inline-flex md:w-auto md:px-[40px]"
        >
          打電話 {SITE.phone}
        </a>

        <p className="t-caption mt-[16px] text-white">
          <span className="md:hidden">
            {SITE.company}
            <br />
            {SITE.address}
          </span>
          <span className="hidden md:inline">{SITE.footerLine}</span>
        </p>
      </div>
    </section>
  );
}

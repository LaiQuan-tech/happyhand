import type { Metadata } from "next";
import Link from "next/link";
import { SITE } from "@/lib/site";
import { TEACHER } from "@/lib/content";
import { MobileActionBar } from "@/components/mobile-action-bar";
import { PageHero } from "@/app/_components/page-hero";
import { CallBand } from "@/app/_components/call-band";
import { TeacherFeature } from "@/app/_components/teacher-feature";

export const metadata: Metadata = {
  title: "品牌介紹",
  description:
    "快樂手是好日子股份有限公司的品牌，教的是仁神術（JSJ）。用自己的手照顧自己，坐著就能做，每天十分鐘。",
};

/** 「仁神術是什麼」沿用首頁三項理由的排版語彙（README §4.1 #3） */
const WHAT_IS_JSJ = [
  {
    no: "一",
    title: "用自己的手",
    desc: "一雙手就夠了。放在自己身上，也可以放在家人身上，位置記熟了隨時都能做。",
  },
  {
    no: "二",
    title: "坐著就能做",
    desc: "不用換衣服、不用墊子。坐在椅子上、躺在床上都行，膝蓋或腰不舒服也有替代姿勢。",
  },
  {
    no: "三",
    title: "慢慢來就好",
    desc: "一個位置放個幾分鐘，呼吸放慢。做完覺得鬆一點，就是今天的收穫。",
  },
];

const WHY = [
  "柳樺老師教仁神術教了二十幾年。以前都是實體班，一次坐滿一間教室。",
  "後來常有人跟我們說，住得遠、腳不方便，來一趟不容易；也有人說上完課回家就忘了，想再聽一次卻沒機會。",
  "所以我們把課一堂一堂錄下來，放到網路上。你在家裡坐著，跟著影片一起做，哪裡不懂就倒回去再看一次，看幾次都可以。",
  "實體班我們沒有收掉。手要放到什麼程度、力氣要多輕，還是當面學最快。想來的話，台北每個月都有班。",
  "這件事不難，難的是有沒有人陪你開始。",
];

const COMPANY_ROWS = [
  { label: "公司名稱", value: `${SITE.company} ${SITE.companyEn}` },
  { label: "統一編號", value: SITE.taxId },
  { label: "代表人", value: SITE.representative },
  { label: "地址", value: SITE.address },
];

export default function AboutPage() {
  return (
    <div className="pb-action-bar">
      <PageHero
        eyebrow="ABOUT"
        title={
          <>
            把手放好，把呼吸放慢，
            <br className="hidden md:inline" />
            剩下的身體自己會做
          </>
        }
        lead="快樂手是好日子股份有限公司的品牌，教的是仁神術（Jin Shin Jyutsu）。這不是什麼神奇的東西，就是一套用自己的手照顧自己的方法。"
      >
        <div className="mt-[24px] flex flex-col items-center gap-[6px] md:mt-[30px]">
          <span className="font-serif text-[26px] font-bold tracking-[0.14em] text-caramel-ink md:text-[32px]">
            {SITE.brandZh}
          </span>
          <span className="t-caption tracking-[0.18em] text-brown-500">
            {SITE.brandEn}
          </span>
        </div>
      </PageHero>

      {/* 仁神術是什麼 —— 沿用三項理由的格線排版 */}
      <section className="bg-white">
        <div className="mx-auto max-w-maxw px-[20px] pt-[40px] pb-[34px] text-center md:px-[40px] md:pt-[72px] md:pb-[40px]">
          <h2 className="t-h2">仁神術是什麼</h2>
          <p className="t-body mx-auto mt-[16px] max-w-[680px] text-pretty text-brown-500 md:mt-[20px]">
            仁神術來自日本，英文寫作 Jin Shin Jyutsu，大家簡稱它 JSJ。做法很單純：把兩隻手放在身上幾個固定的位置，輕輕放著，等一等。不用出力，也不用按摩，更不用記一堆名詞。
          </p>
        </div>

        <div className="mx-auto max-w-maxw px-[20px] md:px-[40px]">
          <div className="border-t border-sand-300 md:grid md:grid-cols-3">
            {WHAT_IS_JSJ.map((item, i) => (
              <div
                key={item.no}
                className={[
                  "border-b border-sand-300 px-[24px] py-[30px] text-center md:border-b-0 md:px-[40px] md:py-[52px]",
                  i > 0 ? "md:border-l md:border-sand-300" : "",
                ].join(" ")}
              >
                <div className="font-serif text-[28px] text-caramel-ink md:text-[36px]">
                  {item.no}
                </div>
                <h3 className="t-h3 mt-[8px]">{item.title}</h3>
                <p className="t-body-sm mt-[10px] text-pretty text-brown-500">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 為什麼做這件事 */}
      <section className="bg-cream-100">
        <div className="mx-auto max-w-[860px] px-[20px] py-[40px] md:px-[40px] md:py-[72px]">
          <h2 className="t-h2">為什麼做這件事</h2>
          <div className="mt-[18px] flex flex-col gap-[14px] md:mt-[26px] md:gap-[16px]">
            {WHY.map((p) => (
              <p key={p} className="t-body text-pretty text-brown-700">
                {p}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* 老師區（設計稿 895–910 行） */}
      <TeacherFeature
        eyebrow={TEACHER.eyebrow}
        heading={TEACHER.name}
        paragraphs={TEACHER.paragraphs}
        stats={[
          { value: "20 年", label: "教學經驗" },
          { value: "4,800+", label: "上過課的同學" },
          { value: "台北・台中", label: "每月開課" },
        ]}
      >
        <Link
          href="/teachers"
          className="mt-[20px] inline-flex min-h-[56px] items-center text-[18px] text-caramel-ink underline underline-offset-[6px] hover:text-caramel-dk md:mt-[24px]"
        >
          看柳樺老師的完整介紹
        </Link>
      </TeacherFeature>

      {/* 公司資訊 */}
      <section className="bg-cream-100">
        <div className="mx-auto max-w-[900px] px-[20px] py-[40px] md:px-[40px] md:py-[72px]">
          <h2 className="t-h2 text-center">關於好日子</h2>
          <p className="t-body mx-auto mt-[14px] max-w-[620px] text-center text-pretty text-brown-500 md:mt-[18px]">
            快樂手是好日子股份有限公司的品牌。找得到人，也找得到地址，有事情用 LINE 說就好。
          </p>

          <dl className="mt-[24px] overflow-hidden rounded-card border border-sand-300 bg-white md:mt-[34px]">
            {COMPANY_ROWS.map((row) => (
              <div
                key={row.label}
                className="grid gap-[2px] border-b border-sand-300 px-[22px] py-[16px] md:grid-cols-[160px_1fr] md:items-baseline md:gap-[20px] md:px-[30px] md:py-[20px]"
              >
                <dt className="t-caption text-brown-500">{row.label}</dt>
                <dd className="t-body text-brown-900">{row.value}</dd>
              </div>
            ))}
            <div className="grid gap-[2px] px-[22px] py-[10px] md:grid-cols-[160px_1fr] md:items-center md:gap-[20px] md:px-[30px] md:py-[12px]">
              <dt className="t-caption text-brown-500">LINE</dt>
              <dd>
                <a
                  href={SITE.lineHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[56px] items-center text-[19px] text-caramel-ink underline underline-offset-[6px] hover:text-caramel-dk"
                >
                  {SITE.lineId}
                  <span className="sr-only">（會開啟 LINE）</span>
                </a>
              </dd>
            </div>
          </dl>

          <p className="t-body-sm mt-[20px] rounded-card border border-sand-300 bg-white px-[22px] py-[18px] text-brown-500 md:mt-[28px] md:px-[30px] md:py-[22px]">
            {SITE.disclaimer}
          </p>
        </div>
      </section>

      <CallBand />

      <MobileActionBar href="/courses" label="開始線上練習" />
    </div>
  );
}

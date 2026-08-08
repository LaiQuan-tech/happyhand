import type { Metadata } from "next";
import { SITE } from "@/lib/site";
import { LinkButton } from "@/components/ui/button";
import { MobileActionBar } from "@/components/mobile-action-bar";
import { PageHero } from "@/app/_components/page-hero";
import { CallBand } from "@/app/_components/call-band";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "會員中心",
  description:
    "登入之後可以看到你買過的線上課程、訂單和報名的工作坊。查詢訂單也可以直接打 02-2833-5820，我們幫你查。",
  robots: { index: false, follow: false },
};

/**
 * Supabase Auth 尚未串接完成。
 * 這頁誠實顯示狀態：沒設定環境變數、沒登入、或讀取失敗，一律當作未登入。
 */
async function getSignedInEmail(): Promise<string | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}

const PANELS = [
  {
    title: "我的課程",
    desc: "你買過的線上課程和看到哪一堂，之後都會列在這裡。",
  },
  {
    title: "我的訂單",
    desc: "訂單編號、金額、付款狀態，還有課本寄到哪裡了。",
  },
  {
    title: "我報名的工作坊",
    desc: "報名的場次、時間、地點，以及可不可以改期。",
  },
  {
    title: "資料設定",
    desc: "收件地址、電話、Email，之後可以自己改。",
  },
];

export default async function AccountPage() {
  const email = await getSignedInEmail();

  return (
    <div className="pb-action-bar">
      <PageHero
        eyebrow="ACCOUNT"
        title="會員中心"
        lead={
          email
            ? "你買過的課程、訂單和工作坊都會放在這裡。"
            : "買過課的話，用當初填的 Email 登入，就看得到你的課程和訂單。"
        }
      />

      <section className="bg-white">
        <div className="mx-auto max-w-[900px] px-[20px] pt-[26px] pb-[40px] md:px-[40px] md:pt-[40px] md:pb-[72px]">
          {email ? (
            <>
              <div className="rounded-card border border-sand-300 bg-cream-100 px-[22px] py-[20px] md:px-[30px] md:py-[24px]">
                <p className="t-body-sm text-brown-500">目前登入的帳號</p>
                <p className="t-body mt-[4px] break-all text-brown-900">
                  {email}
                </p>
              </div>

              <div className="mt-[20px] grid gap-[14px] md:mt-[28px] md:grid-cols-2 md:gap-[24px]">
                {PANELS.map((panel) => (
                  <div
                    key={panel.title}
                    className="rounded-card border border-sand-300 bg-white px-[22px] py-[24px] md:px-[30px] md:py-[28px]"
                  >
                    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
                      <h2 className="t-h3">{panel.title}</h2>
                      <span className="t-caption rounded-pill border border-sand-400 px-[12px] py-[2px] text-brown-500">
                        整理中
                      </span>
                    </div>
                    <p className="t-body-sm mt-[10px] text-pretty text-brown-500">
                      {panel.desc}
                    </p>
                  </div>
                ))}
              </div>

              <p className="t-body-sm mt-[20px] rounded-card border border-sand-300 bg-cream-100 px-[22px] py-[18px] text-pretty text-brown-500 md:mt-[28px] md:px-[30px] md:py-[22px]">
                這幾個頁面還在做，內容陸續補上。現在想查訂單或確認課程有沒有開通，打
                {" "}
                {SITE.phone} 給我們，我們幫你查。
              </p>
            </>
          ) : (
            <div className="rounded-card border border-sand-300 bg-cream-100 px-[22px] py-[28px] md:px-[40px] md:py-[40px]">
              <h2 className="t-h2">還沒登入</h2>
              <p className="t-body mt-[14px] text-pretty text-brown-700 md:mt-[18px]">
                買過課的話，用當初填的 Email
                登入，就看得到你的課程、訂單，還有報名的工作坊。
              </p>

              <div className="mt-[22px] flex flex-col gap-[10px] md:mt-[28px] md:flex-row md:gap-[16px]">
                <LinkButton
                  href="/account"
                  variant="primary"
                  size="lg"
                  fullWidth
                  className="md:w-auto"
                >
                  用 Email 登入
                </LinkButton>
                <LinkButton
                  href={SITE.phoneHref}
                  variant="outline"
                  size="lg"
                  fullWidth
                  className="md:w-auto"
                >
                  打電話問 {SITE.phone}
                </LinkButton>
              </div>

              <p className="t-body-sm mt-[18px] text-pretty text-brown-500 md:mt-[22px]">
                登入功能正在開通中，按下去暫時還是回到這一頁。開通之後我們會寄信通知你。在那之前，想確認買了什麼、課程有沒有開通，打
                {" "}
                {SITE.phone} 給我們，我們幫你查。
              </p>
            </div>
          )}
        </div>
      </section>

      <CallBand
        heading={
          <>
            登入不順利，
            <br className="md:hidden" />
            打電話我們幫你查
          </>
        }
        note="報上當初填的姓名或電話就可以，不用記訂單編號。"
      />

      {/* 行動列左邊已經是「打電話問」，右邊再放一次會變成兩顆一樣的鈕 */}
      <MobileActionBar href="/courses" label="看線上課程" />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SITE } from "@/lib/site";
import { PageHero } from "@/app/_components/page-hero";
import { getMember } from "@/lib/account/guard";
import { ResetForm } from "./_components/reset-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "設定新密碼",
  robots: { index: false, follow: false },
};

/**
 * 設定新密碼。
 *
 * 這一頁不需要偵測「我是不是在 recovery session 裡」——
 * /auth/confirm 的 verifyOtp 成功時就把 session cookie 寫好了，
 * 所以它就只是一個「需要登入」的頁面。
 *
 * 已登入的一般使用者直接開也會通過，那就是「修改密碼」，
 * /account/settings 的按鈕就是連到這裡。**刻意不區分兩種來路**：
 * 操作與結果一模一樣，分開只是多一個狀態。
 *
 * ⚠️ 沒有 session 時**不要導去 /login**。長輩會迷路，以為自己哪裡做錯了。
 *    就地說明「連結只能用一次」並給「再寄一次」，這是最常見的失敗情境。
 */
export default async function ResetPasswordPage() {
  const member = await getMember();

  if (!member) {
    return (
      <div className="pb-[80px]">
        <PageHero
          eyebrow="PASSWORD"
          title="這個連結不能用了"
          lead="這不是你做錯什麼，再寄一次就好。"
        />
        <div className="mx-auto max-w-[560px] px-[20px] md:px-[40px]">
          <div className="rounded-card border border-sand-300 bg-cream-100 px-[22px] py-[26px] md:px-[36px] md:py-[34px]">
            <p className="t-body text-pretty text-brown-700">
              重設密碼的連結<strong className="font-semibold">只能用一次</strong>
              ，而且過一個小時就會失效。如果你按了兩次「忘記密碼」，請用最新收到的那一封。
            </p>

            <div className="mt-[24px] flex flex-col gap-[12px] sm:flex-row">
              <Link
                href="/forgot-password"
                className={buttonClass({
                  variant: "primary",
                  size: "lg",
                  fullWidth: true,
                  className: "sm:w-auto",
                })}
              >
                再寄一次重設密碼信
              </Link>
              <a
                href={SITE.lineHref}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({
                  variant: "outline",
                  size: "lg",
                  fullWidth: true,
                  className: "sm:w-auto",
                })}
              >
                用 LINE 問我們
                <span className="sr-only">（會開啟 LINE）</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-[80px]">
      <PageHero
        eyebrow="PASSWORD"
        title="設定新密碼"
        lead={`設定好之後，下次就用 ${member.email ?? "你的信箱"} 和這組新密碼登入。`}
      />
      <div className="mx-auto max-w-[560px] px-[20px] md:px-[40px]">
        <ResetForm />
      </div>
    </div>
  );
}

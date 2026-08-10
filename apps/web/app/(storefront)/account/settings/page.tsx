import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { getMember } from "@/lib/account/guard";
import { Card, LineButton, PageHeading } from "../_components/shell";
import { ProfileForm } from "./_components/profile-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "我的資料",
  description: "修改姓名、電話，或設定新密碼。",
  robots: { index: false, follow: false },
};

/**
 * 我的資料。
 *
 * 四塊：可以改的資料、不能改的帳號、密碼、登出。
 * Email 刻意設計成**不能在這裡改** —— 它是訂單歸戶的鍵，
 * 改掉會讓客人跟自己的訂單斷開。要改請走 LINE，由客服在後台處理
 * （/admin/orders/[id] 的「修正 Email／換綁帳號」會一併搬移已開通的課）。
 */
export default async function AccountSettingsPage() {
  const member = await getMember();

  return (
    <>
      <PageHeading
        title="我的資料"
        lead="這些資料只有我們看得到，用來聯絡你與寄送課本。"
      />

      <Card>
        <h2 className="t-h3 mb-[16px] text-brown-900">基本資料</h2>
        <ProfileForm
          defaults={{
            fullName: member?.fullName ?? "",
            phone: member?.phone ?? "",
            birthYear: member?.birthYear ? String(member.birthYear) : "",
          }}
        />
      </Card>

      <Card className="mt-[18px]">
        <h2 className="t-h3 text-brown-900">登入用的信箱</h2>
        <p className="t-body mt-[10px] break-all text-brown-900">
          {member?.email ?? "—"}
        </p>
        <p className="t-body-sm mt-[10px] text-pretty text-brown-500">
          這個信箱同時是你的帳號，也是我們找出你買過哪些課的依據，
          所以不能在這裡自己改。真的需要換信箱的話用 LINE 跟我們說，
          我們幫你換，你買過的課會一起帶過去。
        </p>
        <LineButton className="mt-[16px]" label="我要換信箱" />
      </Card>

      <Card className="mt-[18px]">
        <h2 className="t-h3 text-brown-900">密碼</h2>
        <p className="t-body mt-[10px] text-pretty text-brown-700">
          想換一組新密碼，或是根本沒設定過密碼（用 LINE、Google 登入的話就是這樣），
          都可以在這裡設定。
        </p>
        <Link
          href="/reset-password"
          className={buttonClass({
            variant: "outline",
            size: "lg",
            fullWidth: true,
            className: "mt-[16px] sm:w-auto",
          })}
        >
          設定新密碼
        </Link>
      </Card>

      <Card className="mt-[18px]">
        <h2 className="t-h3 text-brown-900">登出</h2>
        <p className="t-body mt-[10px] text-pretty text-brown-700">
          如果這是別人的電腦或手機，記得登出。你買的課不會不見，
          下次用同一個信箱登入就看得到了。
        </p>
        {/* 原生 form POST：/logout 只收 POST（收 GET 的話 <img src="/logout">
            就能把人登出）。不需要 client component。 */}
        <form action="/logout" method="post" className="mt-[16px]">
          <button
            type="submit"
            className={buttonClass({
              variant: "outline",
              size: "lg",
              fullWidth: true,
              className: "sm:w-auto",
            })}
          >
            登出
          </button>
        </form>
      </Card>
    </>
  );
}

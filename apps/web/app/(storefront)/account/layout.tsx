import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getMember, claimGuestOrders } from "@/lib/account/guard";
import { AccountSidebar, AccountBottomNav } from "./_components/account-nav";

/**
 * 會員中心外殼。
 *
 * 這是第二層守衛。middleware.ts 的 matcher 已含 /account/:path*，
 * 未登入根本進不來——但那一層只看有沒有 cookie，而且環境變數缺失時會直接放行。
 * 這裡再確認一次真的拿得到 user。
 *
 * ⚠️ 這一層擋不住 server action 的 POST（不經過 layout 的 render），
 *    所以每一支寫入都要自己 requireMember()。跟 /admin 的模型一樣。
 *
 * 每次進來跑一次 claimGuestOrders()：把「用同一個信箱下的訪客訂單」認回來。
 * 這是「用 Google／LINE 登入後看得到之前買的課」真的成立的那一段——
 * 少了它，客人登入後會看到空的「我的學習」然後打 LINE 來問。
 * 成本是一次 index scan，用 React.cache() 保證同一個請求只跑一次。
 */

export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}) {
  const member = await getMember();
  if (!member) redirect("/login?redirect=/account");

  await claimGuestOrders();

  return (
    // pb-[92px]：手機底部分頁的高度 + 呼吸空間。
    // 不用 .pb-action-bar 是因為那個是給 MobileActionBar 用的，
    // 兩者不會同時出現（見 account-nav.tsx 的註解），但數值不同。
    <div className="bg-white pb-[92px] lg:pb-0">
      <div className="mx-auto max-w-maxw px-[20px] py-[26px] md:px-[40px] md:py-[40px]">
        <div className="lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-[48px]">
          <aside className="lg:sticky lg:top-[100px] lg:self-start">
            <AccountSidebar />
          </aside>
          <div className="min-w-0">{children}</div>
        </div>
      </div>
      <AccountBottomNav />
    </div>
  );
}

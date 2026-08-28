"use client";

import { useState, type ReactNode } from "react";
import { AccountSidebar } from "./account-nav";
import {
  ACCOUNT_NAV_COLLAPSED,
  ACCOUNT_NAV_COOKIE,
  ACCOUNT_NAV_COOKIE_PATH,
  ACCOUNT_NAV_EXPANDED,
  type AccountNavState,
} from "./nav-state";

/**
 * 會員中心的版面外殼，外加「收合左邊功能選單」。
 *
 * 為什麼要做：/account/learn/[slug] 的影片被三欄夾住 ——
 * 1240 容器 − 80 內距 − 240 側欄 − 48 gap − 360 單元清單 − 32 gap = **影片只有 480px**，
 * 而且 max-w-maxw 封頂，螢幕再大也一樣。收掉側欄可拿回 288px，影片變 768×432（已實測）。
 *
 * 側欄只在 lg（1280px，不是 Tailwind 預設的 1024）以上存在，功能也只在 lg 以上。
 *
 * 狀態由 layout.tsx 從 cookie 讀好、當 prop 傳進來，所以 server 渲染出來的
 * HTML 第一個位元組就是對的 —— 沒有閃動，也沒有 hydration mismatch。
 * 理由詳見 ./nav-state.ts。
 */

/** 一年。這是純粹的介面偏好，沒有必要讓它過期。 */
const ONE_YEAR = 60 * 60 * 24 * 365;

export function AccountShell({
  initialState,
  children,
}: {
  initialState: AccountNavState;
  children: ReactNode;
}) {
  const [state, setState] = useState<AccountNavState>(initialState);
  const collapsed = state === ACCOUNT_NAV_COLLAPSED;

  function toggle() {
    const next = collapsed ? ACCOUNT_NAV_EXPANDED : ACCOUNT_NAV_COLLAPSED;
    setState(next);
    try {
      document.cookie =
        `${ACCOUNT_NAV_COOKIE}=${next}; path=${ACCOUNT_NAV_COOKIE_PATH}` +
        `; max-age=${ONE_YEAR}; SameSite=Lax`;
    } catch {
      // 寫不進去（例如瀏覽器擋 cookie）也不影響這一次的切換，只是下次不記得
    }
  }

  return (
    // data-account-nav 掛在這個 wrapper 上，不掛 <html>：
    // 掛 <html> 就得靠 inline script 在 hydrate 前改屬性，那會撞 hydration 檢查。
    <div
      data-account-nav={state}
      className="account-scope mx-auto max-w-maxw px-[20px] py-[26px] md:px-[40px] md:py-[40px]"
    >
      {/* 一顆按鈕、固定同一個位置、只換字。
          兩顆（收起在側欄底、叫回在內容上方）會讓收合時內容額外往下掉 60px；
          一顆放在 grid 上方，切換就只有寬度變化、沒有垂直位移。
          同型前例：courses/_components/lesson-list.tsx 的「展開／收合」。 */}
      <div className="mb-[16px]">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="account-sidebar"
          className="account-nav-toggle min-h-[44px] items-center rounded-input px-[12px] text-[17px] text-brown-700 transition-colors duration-200 hover:bg-cream-100 hover:text-caramel-dk"
        >
          {/* 純文字不放圖示 —— 客群 60–75 歲，全站規則是不用圖示代替文字。 */}
          {collapsed ? "顯示左邊的功能選單" : "收起左邊的功能選單"}
        </button>
      </div>

      <div className="account-grid lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-[48px]">
        {/* 收合時整個 aside 是 display:none，sticky / self-start 自然失效，
            再展開時瀏覽器重新計算，不需要任何 JS 介入。 */}
        <aside
          id="account-sidebar"
          className="account-aside lg:sticky lg:top-[100px] lg:self-start"
        >
          <AccountSidebar />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

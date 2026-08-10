"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { SITE } from "@/lib/site";

/**
 * 會員中心的錯誤邊界。
 *
 * 文案的三個原則（客群是 60–75 歲）：
 * 1. **先說「不是你的問題」**。長輩看到錯誤畫面第一個念頭是「我是不是按錯了」。
 * 2. 不顯示 error.message 或 digest 給使用者看。那是英文的技術訊息，
 *    只會加深「我把它弄壞了」的感覺。要查問題的人去看 server log。
 * 3. 一定要有兩個出口：再試一次（多數是暫時性的），以及一個真人（LINE）。
 */
export default function AccountError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // digest 是 Next 給這次錯誤的識別碼，對照 server log 用的。
    console.error("[account] 頁面錯誤", error.digest, error.message);
  }, [error]);

  return (
    <div className="rounded-card border border-sand-400 bg-cream-100 px-[22px] py-[30px] md:px-[40px] md:py-[40px]">
      <h1 className="t-h2 text-brown-900">這一頁暫時打不開</h1>
      <p className="t-body mt-[14px] text-pretty text-brown-700">
        不是你操作錯誤，是我們這邊出了一點狀況。
        你買的課程和訂單都還在，不會不見。
      </p>

      <div className="mt-[24px] flex flex-col gap-[12px] sm:flex-row">
        <button
          type="button"
          onClick={reset}
          className={buttonClass({
            variant: "primary",
            size: "lg",
            fullWidth: true,
            className: "sm:w-auto",
          })}
        >
          再試一次
        </button>
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

      <p className="t-body-sm mt-[20px] text-brown-500">
        <Link href="/account" className="text-caramel-dk hover:underline">
          回我的學習
        </Link>
      </p>
    </div>
  );
}

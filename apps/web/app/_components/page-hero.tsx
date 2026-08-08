import type { ReactNode } from "react";

/**
 * 內頁共用標題區（設計稿 877–894 行、944–948 行）
 * 置中：小標 eyebrow → H1 → 副文（max-width 660px）。
 * 手機與桌機同一份結構，字級交給 `t-*` 流體 utility 處理。
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-maxw px-[20px] pt-[34px] pb-[8px] text-center md:px-[40px] md:pt-[64px]">
        <p className="t-eyebrow text-caramel-ink">{eyebrow}</p>
        <h1 className="t-h1 mt-[10px] text-balance md:mt-[12px]">{title}</h1>
        {lead && (
          <p className="t-body mx-auto mt-[16px] max-w-[660px] text-pretty text-brown-500 md:mt-[20px]">
            {lead}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}

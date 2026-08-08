"use client";

import { LinkButton } from "@/components/ui/button";
import { SITE } from "@/lib/site";

export type PaymentMethod = "credit" | "atm" | "manual";

type Option = {
  value: PaymentMethod;
  label: string;
  desc: string;
};

/** 設計稿 665–677（桌機）／739–751（手機） */
const OPTIONS: Option[] = [
  {
    value: "credit",
    label: "信用卡",
    desc: "下一步會轉到綠界安全付款頁",
  },
  {
    value: "atm",
    label: "ATM 匯款",
    desc: "下單後會給你帳號，我們對到帳就開通（約 1 個工作天）",
  },
  {
    value: "manual",
    label: "LINE 或電話代訂",
    desc: `送出後我們會打給你，${SITE.phone}`,
  },
];

/**
 * 付款方式（fieldset + legend 的 radio group）。
 * 每個選項本身就是可點的卡片，高度 ≥56px。
 * 卡片一律 2px 外框、只換顏色，避免選取時整排跳動 1px。
 */
export function PaymentOptions({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (v: PaymentMethod) => void;
}) {
  return (
    <fieldset className="mt-[40px] m-0 border-0 p-0">
      <legend className="p-0 font-serif text-[22px] font-semibold text-brown-900 md:text-[28px]">
        怎麼付款
      </legend>

      <div className="mt-[20px] flex flex-col gap-[12px]">
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          return (
            <div key={opt.value}>
              <label className="block cursor-pointer">
                <input
                  type="radio"
                  name="payment"
                  value={opt.value}
                  checked={selected}
                  onChange={() => onChange(opt.value)}
                  className="peer sr-only"
                />
                <span
                  className={`flex min-h-[56px] items-start gap-[16px] rounded-sm border-2 px-[20px] py-[18px] transition-colors duration-200 peer-focus-visible:outline peer-focus-visible:outline-[3px] peer-focus-visible:outline-offset-2 peer-focus-visible:outline-caramel md:px-[24px] md:py-[22px] ${
                    selected
                      ? "border-caramel-ink bg-cream-100"
                      : "border-sand-400 bg-white hover:bg-cream-100"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`mt-[3px] block h-[24px] w-[24px] shrink-0 rounded-pill ${
                      selected
                        ? "border-[6px] border-caramel-ink"
                        : "border-2 border-sand-400"
                    }`}
                  />
                  <span className="min-w-0">
                    <span className="block text-[17.5px] text-brown-900 md:text-[18.5px]">
                      {opt.label}
                    </span>
                    <span className="mt-[4px] block text-[16px] leading-[1.8] text-brown-500">
                      {opt.desc}
                    </span>
                  </span>
                </span>
              </label>

              {/* 展開說明放在 label 外面：裡面有撥號按鈕，包進 label 會誤觸選取 */}
              {selected && opt.value === "credit" && (
                <PanelBox>
                  <p>{`線上刷卡還在開通中。你按下送出之後我們會先幫你保留名額，並打 ${SITE.phone} 跟你確認付款方式，這時候還不會扣款。`}</p>
                </PanelBox>
              )}

              {selected && opt.value === "atm" && (
                <PanelBox>
                  <p>
                    戶名：{SITE.company}
                    <br />
                    銀行帳號請洽 {SITE.phone}，我們會直接告訴你，也可以幫你記下來。
                  </p>
                  <p className="mt-[8px]">匯款後我們對帳完成就會開通。</p>
                </PanelBox>
              )}

              {selected && opt.value === "manual" && (
                <PanelBox>
                  <p>打 {SITE.phone} 給我們，我們幫你處理。</p>
                  <LinkButton
                    href={SITE.phoneHref}
                    variant="dark"
                    fullWidth
                    className="mt-[14px]"
                  >
                    打 {SITE.phone}
                  </LinkButton>
                </PanelBox>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

function PanelBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-[8px] rounded-sm bg-cream-100 px-[20px] py-[18px] text-[16.5px] leading-[1.9] text-brown-500 md:px-[24px]">
      {children}
    </div>
  );
}

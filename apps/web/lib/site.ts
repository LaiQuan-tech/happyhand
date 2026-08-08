/** 公司與品牌資訊 — 來源：design_handoff_happyhands/CONTENT.md，請照抄不要改寫 */
export const SITE = {
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://happyhands.tw",
  brandZh: "快樂手",
  brandEn: "HAPPY HEALING HANDS",
  company: "好日子股份有限公司",
  companyEn: "GOOD DAY LOVE INC.",
  taxId: "53912857",
  representative: "劉柳樺",
  phone: "02-2833-5820",
  phoneHref: "tel:0228335820",
  address: "臺北市中山區新生北路三段 1 號 9 樓之 15",
  footerLine: "好日子股份有限公司・02-2833-5820・臺北市中山區新生北路三段 1 號 9 樓之 15",
  copyright: "Copyright © 2026 快樂手",
  /** 法規要求：不得有醫療宣稱 */
  disclaimer:
    "本課程為自我保健練習，非醫療行為，不能取代專業醫療診斷與治療。",
} as const;

export const NAV_LINKS = [
  { href: "/courses", label: "線上課程" },
  { href: "/workshops", label: "工作坊" },
  { href: "/teachers", label: "關於老師" },
  { href: "/faq", label: "聯絡我們" },
] as const;

export function formatPrice(twd: number) {
  return `$${twd.toLocaleString("en-US")}`;
}

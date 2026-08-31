import type { Metadata } from "next";
import { CheckoutView } from "@/app/(storefront)/checkout/_components/checkout-view";
import { isBlackcatConfigured } from "@/lib/payment/blackcat";

export const metadata: Metadata = {
  title: "填寫資料與付款",
  description:
    "填好姓名、手機與 Email，選一個方便的付款方式，就完成報名了。不方便自己操作可以用 LINE 告訴我們。",
  robots: { index: false, follow: false },
};

/**
 * /checkout — 第二步（設計稿 641–702 桌機／706–763 手機）
 * 表單是 client component，這一層只負責 metadata 與「線上刷卡到底開了沒」。
 *
 * 🔴 creditEnabled 一定要從 server 算出來往下傳，不可以在文案裡寫死。
 *    這裡判斷的條件跟 api/orders/route.ts 決定「要不要去黑貓 PAY 開單」
 *    是**同一個** isBlackcatConfigured()。寫死的話兩邊會各說各話 ——
 *    先前就是這樣：畫面寫「還不會扣款」，程式卻直接把人導去刷卡頁。
 */
export default function CheckoutPage() {
  return <CheckoutView creditEnabled={isBlackcatConfigured()} />;
}

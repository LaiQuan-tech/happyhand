import type { Metadata } from "next";
import { CheckoutView } from "@/app/checkout/_components/checkout-view";

export const metadata: Metadata = {
  title: "填寫資料與付款",
  description:
    "填好姓名、手機與 Email，選一個方便的付款方式，就完成報名了。不方便自己操作可以打 02-2833-5820。",
  robots: { index: false, follow: false },
};

/**
 * /checkout — 第二步（設計稿 641–702 桌機／706–763 手機）
 * 表單是 client component，這一層只負責 metadata。
 */
export default function CheckoutPage() {
  return <CheckoutView />;
}

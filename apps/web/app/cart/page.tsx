import type { Metadata } from "next";
import { CartView } from "@/app/cart/_components/cart-view";

export const metadata: Metadata = {
  title: "購物車",
  description:
    "確認你要報名的線上課程與工作坊，數量與金額都對了，就可以往下填資料。",
  // 交易流程頁不需要被搜尋引擎收錄
  robots: { index: false, follow: false },
};

/**
 * /cart — 第一步（設計稿 621–640 的步驟指示）
 * 實際內容是 client component（要讀 localStorage 購物車），
 * 這一層只負責 metadata。
 */
export default function CartPage() {
  return <CartView />;
}

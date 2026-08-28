import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CartProvider } from "@/components/cart-provider";
import { HelperProvider } from "@/components/ai/helper-provider";
import { HelperWidget } from "@/components/ai/helper-widget";

/**
 * 前台外殼。
 *
 * 用 route group 把前台與後台的外殼分開，網址完全不變
 * （`(storefront)` 不會出現在路徑裡）。
 *
 * 沒有這一層的話，/admin 會被套上前台導覽列與頁尾，還會載入購物車的
 * client JS —— 後台員工不需要購物車，而且 sticky 的前台 header 會蓋住
 * 後台側欄的上緣。
 *
 * 「跳到主要內容」與 <main id="main"> 也放在這裡：後台有自己的
 * landmark 結構，兩邊各自一個 main 才不會變成巢狀 main。
 */
export default function StorefrontLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <CartProvider>
      {/* Context.Provider 不產生 DOM 節點，堆疊環境與版面完全不變 */}
      <HelperProvider>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-pill focus:bg-caramel-ink focus:px-6 focus:py-3 focus:text-white"
      >
        跳到主要內容
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      {/* AI 小幫手。放在 SiteFooter 之後，浮動定位不影響版面流。
          後台有自己的 layout，不會載到這支。

          🔴 必須留在 <SiteHeader /> 之後：對話面板與 header 同為 z-50，
             同一層時是 DOM 順序決定誰蓋誰。搬到前面 header 會蓋住面板頂端。 */}
      <HelperWidget />
      </HelperProvider>
    </CartProvider>
  );
}

import type { Metadata, Viewport } from "next";
import { Noto_Sans_TC, Noto_Serif_TC } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CartProvider } from "@/components/cart-provider";
import { SITE } from "@/lib/site";

/**
 * CJK 字型的 @font-face 宣告很貴：每個 family × 每個字重會展開上百條
 * unicode-range，兩個 family 目前佔約 70 KB（brotli 後）的 render-blocking CSS。
 * 所以只載真的用到的字重 —— 300 全站 0 次使用，已移除。
 * 要再降就得自架 subset（見 README「尚未完成」）。
 */
const notoSans = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap",
  preload: false,
});

const notoSerif = Noto_Serif_TC({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-noto-serif-tc",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: "快樂手 Happy Healing Hands｜仁神術 JSJ 線上課程與工作坊",
    template: "%s｜快樂手",
  },
  description:
    "快樂手是柳樺老師的仁神術（JSJ）練習。不需要體力、不需要器材，把手放在自己身上，慢慢把緊繃的地方鬆開。",
  openGraph: {
    title: "快樂手 Happy Healing Hands",
    description:
      "柳樺老師的仁神術（JSJ）練習。每天十分鐘，坐著也能做，有人陪著練。",
    type: "website",
    locale: "zh_TW",
    siteName: "快樂手",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 樂齡族需要放大到 200%，不可鎖定縮放
  maximumScale: 5,
  themeColor: "#FFFFFF",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" className={`${notoSans.variable} ${notoSerif.variable}`}>
      <body>
        <CartProvider>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-pill focus:bg-caramel-ink focus:px-6 focus:py-3 focus:text-white"
          >
            跳到主要內容
          </a>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </CartProvider>
      </body>
    </html>
  );
}

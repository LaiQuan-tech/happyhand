"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/cart-provider";

/**
 * 工作坊「我要報名」。
 *
 * 🔴 這支存在的原因：原本 CTA 是連到 `/checkout?session=<id>`，但**全站沒有
 *    任何地方讀 `?session=`** —— checkout-view 只讀 useCart()（localStorage）。
 *    結果客人按下去看到的是「購物車還是空的，先回課程列表挑一門」，
 *    工作坊從網頁 UI 完全報不了名。
 *
 *    下游其實早就準備好了：CartItem 有 sessionId / sessionLabel，
 *    /api/orders 也吃這兩個欄位。缺的只是「把場次加進購物車」這一步。
 *
 * 比照 courses/_components/add-to-cart-button.tsx，但這裡加完直接去 /checkout
 * ——選好日子的人就是要報名了，不需要再繞一次購物車。
 */
export function AddSessionButton({
  sessionId,
  slug,
  title,
  price,
  sessionLabel,
  asksIntake,
  ariaLabel,
  className = "",
}: {
  /** 場次 UUID。/api/orders 用 UUID_RE 驗證，不是 UUID 會被當成沒選場次 */
  sessionId: string | null | undefined;
  slug: string;
  title: string;
  price: number;
  /** 給人看的場次說明，會顯示在購物車與訂單摘要，例如「9月12日（週六）09:30–17:00」 */
  sessionLabel: string;
  /** 這門課結帳時要不要問報名問題（products.asks_intake） */
  asksIntake?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const { add } = useCart();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function handleAdd() {
    setBusy(true);
    add({
      // productId 給 slug 就好 —— /api/orders 會用 slug 查商品表拿真正的 id
      // 與價格（伺服器端一律重算，不信任這裡送的 priceSnapshot）
      productId: slug,
      slug,
      title,
      type: "workshop",
      qty: 1,
      priceSnapshot: price,
      sessionId: sessionId ?? null,
      sessionLabel,
      asksIntake,
    });
    router.push("/checkout");
  }

  return (
    <Button
      variant="dark"
      onClick={handleAdd}
      disabled={busy}
      className={`w-full whitespace-nowrap md:w-auto ${className}`}
      aria-label={ariaLabel}
    >
      {busy ? "處理中…" : "我要報名"}
    </Button>
  );
}

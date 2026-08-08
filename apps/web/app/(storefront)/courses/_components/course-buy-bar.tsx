"use client";

import { formatPrice } from "@/lib/site";
import type { Product } from "@/lib/content";
import { AddToCartButton } from "./add-to-cart-button";

/**
 * 手機底部固定購買列（設計稿 453–459 行）
 * 只在 < 768px 出現；桌機／平板改用右欄 sticky 購買卡。
 * 這是「購買」用的固定列，跟行銷用的共用 MobileActionBar 不同。
 * 頁面最外層需加 `.pb-action-bar` 預留空間。
 */
export function CourseBuyBar({ product }: { product: Product }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-sand-300 bg-white/97 px-[16px] pt-[12px] pb-[calc(12px+env(safe-area-inset-bottom))] backdrop-blur-sm md:hidden">
      <p className="flex items-baseline gap-[10px] px-[4px] pb-[8px]">
        <span className="font-serif text-[24px] font-semibold text-caramel-ink">
          {formatPrice(product.price)}
        </span>
        {product.compare_at_price ? (
          <span className="text-[16px] text-brown-300">
            <span className="sr-only">原價 </span>
            <span className="line-through">
              {formatPrice(product.compare_at_price)}
            </span>
          </span>
        ) : null}
      </p>

      <AddToCartButton product={product} />
    </div>
  );
}

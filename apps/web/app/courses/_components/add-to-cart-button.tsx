"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button, LinkButton, buttonClass } from "@/components/ui/button";
import { useCart } from "@/components/cart-provider";
import type { Product } from "@/lib/content";

/**
 * 加入購物車（設計稿 396 行）
 * 加入後按鈕換成「已加入・去結帳」並連到 /cart，
 * 同時把狀態焦點移到新按鈕、並用 aria-live 宣告，鍵盤與讀屏都不會迷路。
 *
 * 工作坊型商品不在這頁下單（要先選場次），改成導去 /workshops。
 */
export function AddToCartButton({
  product,
  className = "",
}: {
  product: Product;
  className?: string;
}) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  const doneRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (added) doneRef.current?.focus();
  }, [added]);

  if (product.type === "workshop") {
    return (
      <div className={className}>
        <LinkButton href="/workshops" variant="primary" size="md" fullWidth>
          看場次報名
        </LinkButton>
      </div>
    );
  }

  function handleAdd() {
    add({
      productId: product.slug,
      slug: product.slug,
      title: product.title,
      type: "course",
      qty: 1,
      priceSnapshot: product.price,
      sessionId: null,
    });
    setAdded(true);
  }

  return (
    <div className={className}>
      {added ? (
        <Link
          ref={doneRef}
          href="/cart"
          className={buttonClass({
            variant: "primary",
            size: "md",
            fullWidth: true,
          })}
        >
          已加入・去結帳
        </Link>
      ) : (
        <Button variant="primary" size="md" fullWidth onClick={handleAdd}>
          加入購物車
        </Button>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {added ? `已把「${product.title}」加入購物車` : ""}
      </p>
    </div>
  );
}

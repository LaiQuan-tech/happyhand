"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type CartItem = {
  productId: string;
  slug: string;
  title: string;
  type: "course" | "workshop";
  qty: number;
  priceSnapshot: number;
  sessionId?: string | null;
  sessionLabel?: string | null;
};

type CartContext = {
  items: CartItem[];
  count: number;
  total: number;
  ready: boolean;
  add: (item: CartItem) => void;
  remove: (productId: string, sessionId?: string | null) => void;
  clear: () => void;
};

const STORAGE_KEY = "happyhands.cart.v1";
const Ctx = createContext<CartContext | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
    } catch {
      // 壞掉的 localStorage 不該讓整頁掛掉
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore */
    }
  }, [items, ready]);

  const add = useCallback((item: CartItem) => {
    setItems((prev) => {
      const i = prev.findIndex(
        (x) => x.productId === item.productId && x.sessionId === item.sessionId,
      );
      if (i === -1) return [...prev, item];
      const next = [...prev];
      next[i] = { ...next[i], qty: next[i].qty + item.qty };
      return next;
    });
  }, []);

  const remove = useCallback((productId: string, sessionId?: string | null) => {
    setItems((prev) =>
      prev.filter(
        (x) => !(x.productId === productId && x.sessionId === (sessionId ?? null)),
      ),
    );
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContext>(
    () => ({
      items,
      ready,
      count: items.reduce((n, x) => n + x.qty, 0),
      total: items.reduce((n, x) => n + x.qty * x.priceSnapshot, 0),
      add,
      remove,
      clear,
    }),
    [items, ready, add, remove, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart 必須放在 CartProvider 內");
  return ctx;
}

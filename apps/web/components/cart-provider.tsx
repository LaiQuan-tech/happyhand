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
  setQty: (productId: string, qty: number, sessionId?: string | null) => void;
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

  /** sessionId 一律正規化成 null 再比對：線上課常常傳 undefined，
      undefined !== null 會讓 remove() 永遠比不到、按了移除沒反應。 */
  const sameLine = (a: CartItem, productId: string, sessionId?: string | null) =>
    a.productId === productId && (a.sessionId ?? null) === (sessionId ?? null);

  const add = useCallback((item: CartItem) => {
    const normalized: CartItem = { ...item, sessionId: item.sessionId ?? null };
    setItems((prev) => {
      const i = prev.findIndex((x) =>
        sameLine(x, normalized.productId, normalized.sessionId),
      );
      if (i === -1) return [...prev, normalized];
      const next = [...prev];
      next[i] = { ...next[i], qty: next[i].qty + normalized.qty };
      return next;
    });
  }, []);

  const remove = useCallback((productId: string, sessionId?: string | null) => {
    setItems((prev) => prev.filter((x) => !sameLine(x, productId, sessionId)));
  }, []);

  const setQty = useCallback(
    (productId: string, qty: number, sessionId?: string | null) => {
      setItems((prev) =>
        qty <= 0
          ? prev.filter((x) => !sameLine(x, productId, sessionId))
          : prev.map((x) =>
              sameLine(x, productId, sessionId) ? { ...x, qty } : x,
            ),
      );
    },
    [],
  );

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContext>(
    () => ({
      items,
      ready,
      count: items.reduce((n, x) => n + x.qty, 0),
      total: items.reduce((n, x) => n + x.qty * x.priceSnapshot, 0),
      add,
      remove,
      setQty,
      clear,
    }),
    [items, ready, add, remove, setQty, clear],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCart 必須放在 CartProvider 內");
  return ctx;
}

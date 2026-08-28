"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";

/**
 * 小幫手的開關狀態。
 *
 * 為什麼要拉到 context：手機版的入口從右下角浮動鈕改成 SiteHeader 抽屜裡的一項，
 * 而 SiteHeader 與 HelperWidget 是 layout 裡的兄弟節點，沒有父子關係。
 *
 * 專案裡跨元件通訊只有 React Context 這一種（cart-provider.tsx），
 * 沒有任何 CustomEvent 的用法，所以照同一個形狀寫。
 *
 * 🔴 只有 `open` 放上來。msgs / draft / busy 一律留在 HelperWidget 裡面 ——
 *    draft 要是放上來，使用者每敲一個字整個前台樹都要重算 context。
 */

/** 這幾頁本身就有非做不可的動作，小幫手會擋路。 */
const HIDE_ON = ["/checkout", "/login", "/forgot-password", "/reset-password"];

type HelperContextValue = {
  open: boolean;
  /**
   * 這一頁有沒有小幫手。
   * SiteHeader 抽屜那一項也要看它 —— 否則在 /checkout 按下去會什麼都不發生。
   */
  available: boolean;
  openHelper: () => void;
  closeHelper: () => void;
};

const Ctx = createContext<HelperContextValue | null>(null);

export function HelperProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () => !HIDE_ON.some((p) => pathname === p || pathname.startsWith(`${p}/`)),
    [pathname],
  );

  /**
   * 🔴 open 現在住在 provider，不會隨路由卸載。
   *    開著小幫手走到 /checkout 再走回來，面板會憑空彈出來。
   */
  useEffect(() => {
    if (!available) setOpen(false);
  }, [available]);

  const openHelper = useCallback(() => setOpen(true), []);
  const closeHelper = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, available, openHelper, closeHelper }),
    [open, available, openHelper, closeHelper],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHelper() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHelper 必須放在 HelperProvider 內");
  return ctx;
}

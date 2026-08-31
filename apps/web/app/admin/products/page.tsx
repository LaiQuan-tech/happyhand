import { redirect } from "next/navigation";

/**
 * 舊的「課程與工作坊」清單。
 *
 * 這一頁已經拆成兩個：
 *   /admin/courses   線上課程與訂閱制
 *   /admin/workshops 實體工作坊（含線上課另開的實體班）
 *
 * 保留這個路由做轉址而不是直接刪掉，因為：
 *   1. 同事的書籤與瀏覽紀錄還指著它
 *   2. actions.ts 的 server action 存檔後的 redirect 曾經一律回這裡，
 *      漏改到的話至少不會 404
 *
 * ⚠️ 商品的**編輯**頁仍然在 /admin/products/[id]，沒有跟著搬。
 *    那一支有 7 個 server action 的 redirect 目的地與 21 個 ?msg= 代碼綁著，
 *    為了側欄的一個高亮去複製整條路由不划算。
 */
export default async function AdminProductsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0]);
  }
  const q = qs.toString();
  redirect(q ? `/admin/courses?${q}` : "/admin/courses");
}

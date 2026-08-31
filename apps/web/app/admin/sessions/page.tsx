import { redirect } from "next/navigation";

/**
 * 舊的「場次報名」清單。
 *
 * 場次已經收進工作坊頁（/admin/workshops）—— 一場場次離開它的工作坊就沒有
 * 意義，分成兩個入口只是讓人多記一個地方。
 *
 * ⚠️ 場次的**明細與報名名單**仍然在 /admin/sessions/[id]，沒有搬。
 *    那一頁有客人的姓名電話 Email，守衛是 orders:read；工作坊頁放寬成
 *    「catalog:read 或 orders:read」，名單不能跟著放寬。
 */
export default async function AdminSessionsRedirect({
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
  redirect(q ? `/admin/workshops?${q}` : "/admin/workshops");
}

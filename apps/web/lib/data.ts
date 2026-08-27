import "server-only";
import { createPublicClient, hasSupabaseEnv } from "@/lib/supabase/server";
import type { Product, WorkshopSession } from "@/lib/content";

/**
 * 資料讀取層。資料庫是唯一真相。
 *
 * ⚠️ 這裡刻意「不」在查無資料時退回 lib/content.ts 的靜態資料。
 *    有後台之後，那種 fallback 會變成 bug 而不是保險：
 *    後台把課程全部下架 → data.length === 0 → 舊版會回靜態的 6 門課，
 *    等於下架不生效，而且沒有任何錯誤訊息。刪掉單元、清空 tags 同理。
 *
 *    區分兩種情況：
 *      查得到但零筆 → 就是空的，老實回空陣列，讓頁面顯示空狀態
 *      連不上 / 查詢出錯 → console.error 後回空，並靠 ISR 的舊快取撐著
 *                          （Next 在 revalidate 失敗時會沿用上一次成功的版本，
 *                            那是真實的上一版，不是永遠停在某個時間點的假資料）
 *
 * 用 createPublicClient()（不讀 cookie）讓這些頁面能維持靜態 + ISR。
 */

export type ProductWithSessions = Product & {
  id?: string;
  sessions?: (WorkshopSession & { id?: string; status?: string })[];
};

type LessonRow = {
  id?: string;
  title: string;
  duration_sec: number;
  free_preview: boolean;
  sort_order?: number;
};

const PRODUCT_SELECT =
  "id, slug, type, title, subtitle, description, price, compare_at_price, cover_url, is_featured, tags, benefits, sort_order";

export async function getProducts(): Promise<ProductWithSessions[]> {
  if (!hasSupabaseEnv()) return [];
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("products")
      // 一併撈單元：舊版的 mapProduct() 寫死 lessons 取自靜態檔，
      // 導致列表頁的「共 N 堂」永遠不受資料庫控制。
      .select(`${PRODUCT_SELECT}, course_lessons(id, title, duration_sec, free_preview, sort_order)`)
      .eq("is_published", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[data] getProducts 失敗", error.message);
      return [];
    }
    return (data ?? []).map(mapProduct);
  } catch (err) {
    console.error("[data] getProducts 例外", err);
    return [];
  }
}

export async function getProduct(
  slug: string,
): Promise<ProductWithSessions | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("products")
      .select(
        `${PRODUCT_SELECT}, course_lessons(id, title, duration_sec, free_preview, sort_order), workshop_sessions(*)`,
      )
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();

    if (error) {
      console.error("[data] getProduct 失敗", slug, error.message);
      return null;
    }
    if (!data) return null;

    return {
      ...mapProduct(data),
      sessions: (data.workshop_sessions ?? [])
        .slice()
        .sort((a: { starts_at: string }, b: { starts_at: string }) =>
          a.starts_at.localeCompare(b.starts_at),
        ),
    };
  } catch (err) {
    console.error("[data] getProduct 例外", slug, err);
    return null;
  }
}

/** 給 generateStaticParams 用：只要 slug，不需要整包資料 */
export async function getPublishedSlugs(
  type?: Product["type"],
): Promise<string[]> {
  if (!hasSupabaseEnv()) return [];
  try {
    const supabase = createPublicClient();
    let q = supabase.from("products").select("slug").eq("is_published", true);
    if (type) q = q.eq("type", type);
    const { data, error } = await q;
    if (error) {
      console.error("[data] getPublishedSlugs 失敗", error.message);
      return [];
    }
    return (data ?? []).map((r: { slug: string }) => r.slug);
  } catch (err) {
    // build 當下連不到資料庫時回空陣列：所有詳情頁改成 on-demand 渲染，
    // 站還是活的。回空陣列不是假資料，跟靜態 fallback 性質完全不同。
    console.error("[data] getPublishedSlugs 例外", err);
    return [];
  }
}

export type WorkshopRow = {
  id?: string;
  slug: string;
  title: string;
  subtitle: string;
  price: number;
  starts_at: string;
  ends_at: string;
  location: string;
  address: string;
  capacity: number;
  seats_taken: number;
  /**
   * 被「有效的未付款訂單」佔住的名額數（來自 workshop_holds() RPC）。
   * 顯示剩餘名額時一定要扣掉它，否則會跟 /api/orders 的容量檢查算出不同答案 ——
   * 頁面說剩 4 位、結帳卻說滿了，就是這樣來的。
   */
  held: number;
};

export async function getWorkshopSessions(): Promise<WorkshopRow[]> {
  if (!hasSupabaseEnv()) return [];
  try {
    const supabase = createPublicClient();
    const { data, error } = await supabase
      .from("workshop_sessions")
      .select("*, products!inner(slug,title,subtitle,price,is_published)")
      .eq("products.is_published", true)
      .in("status", ["open", "full"])
      .order("starts_at", { ascending: true });

    if (error) {
      console.error("[data] getWorkshopSessions 失敗", error.message);
      return [];
    }

    // 未付款訂單佔住的名額。走 security definer RPC，因為這裡是 anon client，
    // 直接讀 orders/order_items 會被 RLS 擋掉。
    // 拿不到就當作 0 —— 顯示樂觀一點也不能讓整頁掛掉。
    const holds = new Map<string, number>();
    const { data: holdRows, error: holdError } =
      await supabase.rpc("workshop_holds");
    if (holdError) {
      console.error("[data] workshop_holds 失敗", holdError.message);
    } else {
      for (const h of (holdRows ?? []) as {
        session_id: string;
        held: number;
      }[]) {
        holds.set(h.session_id, h.held);
      }
    }

    return (data ?? []).map((s) => ({
      id: s.id,
      slug: s.products.slug,
      title: s.products.title,
      subtitle: s.products.subtitle,
      price: s.products.price,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      location: s.location,
      address: s.address,
      capacity: s.capacity,
      seats_taken: s.seats_taken,
      held: holds.get(s.id) ?? 0,
    }));
  } catch (err) {
    console.error("[data] getWorkshopSessions 例外", err);
    return [];
  }
}

function mapProduct(row: Record<string, unknown>): ProductWithSessions {
  const lessons = ((row.course_lessons as LessonRow[] | null) ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((l) => ({
      id: l.id,
      title: l.title,
      duration_sec: l.duration_sec,
      free_preview: l.free_preview,
    }));

  return {
    id: row.id as string | undefined,
    slug: row.slug as string,
    type: row.type as Product["type"],
    title: row.title as string,
    subtitle: (row.subtitle as string) ?? "",
    description: (row.description as string) ?? "",
    price: row.price as number,
    compare_at_price: (row.compare_at_price as number | null) ?? null,
    // 這幾個欄位在 DB 是 not null default，舊版的 ?? 靜態值只會讓
    // 「後台清空 tags」這種操作靜默失效。
    featured: (row.is_featured as boolean) ?? false,
    tags: (row.tags as string[]) ?? [],
    benefits: (row.benefits as string[]) ?? [],
    cover_url: (row.cover_url as string | null) ?? null,
    lessons: lessons.length ? lessons : undefined,
  };
}

/** 台北時間格式化，工作坊日期方塊用 */
export function twDate(iso: string) {
  const d = new Date(iso);
  const tz = "Asia/Taipei";
  const month = new Intl.DateTimeFormat("zh-TW", {
    timeZone: tz,
    month: "numeric",
  }).format(d);
  const day = new Intl.DateTimeFormat("zh-TW", {
    timeZone: tz,
    day: "numeric",
  }).format(d);
  const weekday = new Intl.DateTimeFormat("zh-TW", {
    timeZone: tz,
    weekday: "short",
  }).format(d);
  const time = new Intl.DateTimeFormat("zh-TW", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { month: `${month} 月`, day, weekday, time };
}

export function timeRange(startIso: string, endIso: string) {
  return `${twDate(startIso).time}–${twDate(endIso).time}`;
}

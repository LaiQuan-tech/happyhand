import "server-only";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";
import {
  PRODUCTS,
  WORKSHOP_SESSIONS,
  type Product,
  type WorkshopSession,
} from "@/lib/content";

/**
 * 資料讀取層。
 * 優先讀 Supabase；DB 尚未就緒或查詢失敗時 fallback 回 lib/content.ts 的靜態資料，
 * 讓頁面永遠有東西可以顯示（避免部署當下 DB 還沒 seed 就整站空白）。
 */

export type ProductWithSessions = Product & {
  id?: string;
  sessions?: (WorkshopSession & { id?: string; status?: string })[];
};

export async function getProducts(): Promise<ProductWithSessions[]> {
  if (!hasSupabaseEnv()) return PRODUCTS;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("is_published", true)
      .order("sort_order", { ascending: true });
    if (error || !data?.length) return PRODUCTS;
    return data.map(mapProduct);
  } catch {
    return PRODUCTS;
  }
}

export async function getProduct(
  slug: string,
): Promise<ProductWithSessions | null> {
  const fallback = PRODUCTS.find((p) => p.slug === slug) ?? null;
  if (!hasSupabaseEnv()) return fallback;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("products")
      .select("*, course_lessons(*), workshop_sessions(*)")
      .eq("slug", slug)
      .eq("is_published", true)
      .maybeSingle();
    if (error || !data) return fallback;
    const mapped = mapProduct(data);
    const lessons = (data.course_lessons ?? [])
      .slice()
      .sort(
        (a: { sort_order?: number }, b: { sort_order?: number }) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0),
      )
      .map((l: { title: string; duration_sec: number; free_preview: boolean }) => ({
        title: l.title,
        duration_sec: l.duration_sec,
        free_preview: l.free_preview,
      }));
    return {
      ...mapped,
      lessons: lessons.length ? lessons : fallback?.lessons,
      sessions: (data.workshop_sessions ?? []).sort(
        (a: { starts_at: string }, b: { starts_at: string }) =>
          a.starts_at.localeCompare(b.starts_at),
      ),
    };
  } catch {
    return fallback;
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
};

export async function getWorkshopSessions(): Promise<WorkshopRow[]> {
  const fallback: WorkshopRow[] = WORKSHOP_SESSIONS.map((s) => {
    const p = PRODUCTS.find((x) => x.slug === s.slug)!;
    return {
      slug: s.slug,
      title: p.title,
      subtitle: p.subtitle,
      price: p.price,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      location: s.location,
      address: s.address,
      capacity: s.capacity,
      seats_taken: s.seats_taken,
    };
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  if (!hasSupabaseEnv()) return fallback;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workshop_sessions")
      .select("*, products!inner(slug,title,subtitle,price,is_published)")
      .eq("products.is_published", true)
      .in("status", ["open", "full"])
      .order("starts_at", { ascending: true });
    if (error || !data?.length) return fallback;
    return data.map((s) => ({
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
    }));
  } catch {
    return fallback;
  }
}

function mapProduct(row: Record<string, unknown>): ProductWithSessions {
  const fb = PRODUCTS.find((p) => p.slug === row.slug);
  return {
    id: row.id as string | undefined,
    slug: row.slug as string,
    type: row.type as Product["type"],
    title: row.title as string,
    subtitle: (row.subtitle as string) ?? "",
    description: (row.description as string) ?? "",
    price: row.price as number,
    compare_at_price: (row.compare_at_price as number | null) ?? null,
    featured: (row.is_featured as boolean) ?? fb?.featured ?? false,
    tags: (row.tags as string[]) ?? fb?.tags ?? [],
    benefits: (row.benefits as string[]) ?? fb?.benefits ?? [],
    cover_url: (row.cover_url as string | null) ?? null,
    lessons: fb?.lessons,
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

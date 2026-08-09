import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { SITE } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orders — 建立訂單
 *
 * 設計原則（很重要）：
 * 1. 金額一律由伺服器端重算，不信任前端送來的 priceSnapshot。
 *    查得到商品就用商品表的價格；查不到才退回前端價格並標記 price_unverified。
 * 2. DB 還沒接好（沒有 SUPABASE_SERVICE_ROLE_KEY）或寫入失敗時，不回 500。
 *    照樣發訂單編號、回 persisted: false，讓使用者走完流程（完成頁會請他打電話確認），
 *    server 端 console.error 留下完整內容當作補救依據。
 */

const PHONE_RE = /^09\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 去掉念電話時會聽錯的字元（0/O、1/I/L、5/S、8/B、2/Z） */
const ORDER_NO_ALPHABET = "ACDEFGHJKMNPQRTUVWXY346789";

const PAYMENT_METHODS = new Set(["credit", "atm", "manual"]);

type Line = {
  slug: string;
  title: string;
  type: string;
  qty: number;
  unit_price: number;
  product_id: string | null;
  session_id: string | null;
  session_label: string | null;
  price_unverified: boolean;
};

function str(v: unknown, max = 300) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function bad(message: string) {
  return NextResponse.json({ message }, { status: 400 });
}

/** HH-YYYYMMDD-XXXX（日期用台北時間） */
function makeOrderNo() {
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");

  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const rand = Array.from(
    bytes,
    (b) => ORDER_NO_ALPHABET[b % ORDER_NO_ALPHABET.length],
  ).join("");

  return `HH-${ymd}-${rand}`;
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return bad("訂單內容讀不到，請重新整理後再送一次。");
  }

  // ---------- 1. 驗證聯絡資料 ----------
  const name = str(body.name, 80);
  const phone = str(body.phone, 20).replace(/\D/g, "");
  const email = str(body.email, 160);
  const address = str(body.address, 300);
  const note = str(body.note, 1000);
  const payment = str(body.payment, 20);

  if (!name) return bad("請填姓名。");
  if (!PHONE_RE.test(phone)) return bad("手機號碼是 09 開頭、總共 10 個數字。");
  if (!EMAIL_RE.test(email)) return bad("Email 格式看起來不太對，請再檢查一次。");

  const payment_method = PAYMENT_METHODS.has(payment) ? payment : "manual";

  // ---------- 2. 驗證品項 ----------
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) return bad("購物車是空的，請先選一門課再送出。");
  if (rawItems.length > 50) return bad("一次最多只能訂 50 個品項。");

  const parsed = rawItems.map((raw) => {
    const it = (raw ?? {}) as Record<string, unknown>;
    const qtyNum = Number(it.qty);
    const snapshotNum = Number(it.priceSnapshot);
    return {
      productId: str(it.productId, 100),
      slug: str(it.slug, 100),
      title: str(it.title, 200),
      type: str(it.type, 20),
      qty: Number.isFinite(qtyNum) ? Math.trunc(qtyNum) : NaN,
      snapshot: Number.isFinite(snapshotNum) ? Math.trunc(snapshotNum) : NaN,
      sessionId: str(it.sessionId, 100),
      sessionLabel: str(it.sessionLabel, 200),
    };
  });

  for (const it of parsed) {
    if (!it.slug && !it.productId) return bad("訂單內容不完整，請回購物車重新確認。");
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 20)
      return bad("每個品項的數量請填 1 到 20 之間。");
  }

  // ---------- 3. 伺服器端重算金額 ----------
  const supabase = getServiceClient();
  const priceBook = await loadPriceBook(
    supabase,
    parsed.map((i) => i.slug).filter(Boolean),
  );

  // 資料庫連得上、卻查不到購物車裡的商品 → 那些商品已經下架或被刪掉了。
  // 這時候寧可拒單也不要用前端送來的價格成交（那是使用者可以改的）。
  // supabase 為 null 是「完全沒設定環境變數」的降級模式，走原本的
  // price_unverified 路徑，不在這裡擋。
  if (supabase) {
    const missing = parsed.filter((it) => !priceBook.has(it.slug));
    if (missing.length > 0) {
      return bad(
        `購物車裡有已經下架的課程（${missing.map((m) => m.title || m.slug).join("、")}），` +
          `請回購物車移除，或打 ${SITE.phone} 我們幫你處理。`,
      );
    }
  }

  const lines: Line[] = parsed.map((it) => {
    const known = priceBook.get(it.slug);
    const fallback =
      Number.isInteger(it.snapshot) && it.snapshot >= 0 ? it.snapshot : 0;
    return {
      slug: it.slug,
      title: it.title,
      type: it.type,
      qty: it.qty,
      unit_price: known ? known.price : fallback,
      product_id: known?.id ?? (UUID_RE.test(it.productId) ? it.productId : null),
      session_id: UUID_RE.test(it.sessionId) ? it.sessionId : null,
      session_label: it.sessionLabel || null,
      price_unverified: !known,
    };
  });

  // ---------- 3.5 工作坊名額檢查 ----------
  const capacityError = supabase
    ? await checkSessionCapacity(supabase, lines)
    : null;
  if (capacityError) return bad(capacityError);

  const total = lines.reduce((sum, l) => sum + l.unit_price * l.qty, 0);
  const price_unverified = lines.some((l) => l.price_unverified);
  const order_no = makeOrderNo();

  // ---------- 4. 寫入（失敗不擋使用者） ----------
  const persisted = supabase
    ? await persist(supabase, {
        order_no,
        payment_method,
        total,
        price_unverified,
        name,
        phone,
        email,
        address,
        note,
        lines,
      })
    : false;

  if (!persisted) {
    // 這段 log 就是唯一的補救依據：訂單沒進 DB 時，客服只能靠它把訂單補回來。
    console.error(
      "[orders] 訂單沒有寫進資料庫，請人工補建",
      JSON.stringify({
        order_no,
        payment_method,
        total,
        price_unverified,
        contact: { name, phone, email, address, note },
        lines,
      }),
    );
  }

  return NextResponse.json({ order_no, total, persisted, price_unverified });
}

function getServiceClient() {
  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL
  ) {
    console.error("[orders] 缺少 Supabase 設定，這筆訂單只會回傳訂單編號");
    return null;
  }
  try {
    return createServiceClient();
  } catch (err) {
    console.error("[orders] 建立 service client 失敗", err);
    return null;
  }
}

type ServiceClient = ReturnType<typeof createServiceClient>;

/**
 * 工作坊名額檢查。
 *
 * 在此之前這支 API 完全不看名額 —— 場次標成「已額滿」照樣收得到訂單，
 * 客服要到標記收款那一刻才會發現人數對不上（那時候人已經付錢了）。
 *
 * 可用名額 = capacity − seats_taken − 尚未付款但已下單的數量
 *
 * 「尚未付款但已下單」要算進去：這站是 ATM／人工匯款，從下單到客服標記收款
 * 中間可能隔好幾天，那段時間位子已經被佔住了。
 *
 * ⚠️ 已知限制：這是「檢查後再寫入」，兩筆同時打進來仍可能雙雙通過
 * （中間沒有鎖）。要完全杜絕得走 reserve_seat() 那套 15 分鐘暫扣，
 * 那會改到整個結帳流程。以目前的規模（小班制、每月幾場）這個殘餘風險
 * 遠小於「完全不檢查」，而且客服在標記收款時還有第二道提示。
 */
async function checkSessionCapacity(
  supabase: ServiceClient,
  lines: Line[],
): Promise<string | null> {
  // 同一場次在購物車裡出現多次要合併計算
  const wanted = new Map<string, number>();
  for (const l of lines) {
    if (!l.session_id) continue;
    wanted.set(l.session_id, (wanted.get(l.session_id) ?? 0) + l.qty);
  }
  if (wanted.size === 0) return null;

  const ids = [...wanted.keys()];

  try {
    const { data: sessions, error } = await supabase
      .from("workshop_sessions")
      .select("id, capacity, seats_taken, status, starts_at")
      .in("id", ids);
    if (error) {
      console.error("[orders] 讀場次失敗，略過名額檢查", error.message);
      return null; // 讀不到就不擋，寧可讓客服事後處理也不要擋掉真的想報名的人
    }

    // 已下單但還沒付款的數量
    const { data: pendingItems } = await supabase
      .from("order_items")
      .select("session_id, qty, orders!inner(status)")
      .in("session_id", ids)
      .eq("orders.status", "pending");

    const pending = new Map<string, number>();
    for (const it of (pendingItems ?? []) as {
      session_id: string;
      qty: number;
    }[]) {
      pending.set(it.session_id, (pending.get(it.session_id) ?? 0) + it.qty);
    }

    for (const s of (sessions ?? []) as {
      id: string;
      capacity: number;
      seats_taken: number;
      status: string;
      starts_at: string;
    }[]) {
      const want = wanted.get(s.id) ?? 0;

      if (s.status === "cancelled") {
        return `這一場工作坊已經取消了，請回工作坊頁面看看其他場次，或打 ${SITE.phone} 我們幫你安排。`;
      }
      if (s.status === "closed") {
        return `這一場工作坊已經停止報名了，請打 ${SITE.phone} 我們幫你看看還有沒有位子。`;
      }

      const available = s.capacity - s.seats_taken - (pending.get(s.id) ?? 0);
      if (want > available) {
        return available <= 0
          ? `這一場工作坊的位子已經滿了。打 ${SITE.phone} 可以登記候補，有人取消我們會通知你。`
          : `這一場工作坊只剩 ${available} 個位子，你選了 ${want} 個。請調整人數，或打 ${SITE.phone} 我們幫你想辦法。`;
      }
    }

    // 購物車裡有場次 id 但資料庫查不到 → 那個場次被刪了
    const found = new Set((sessions ?? []).map((s: { id: string }) => s.id));
    if (ids.some((id) => !found.has(id))) {
      return `購物車裡有已經不存在的工作坊場次，請回工作坊頁面重新選一次。`;
    }

    return null;
  } catch (err) {
    console.error("[orders] 名額檢查例外，略過", err);
    return null;
  }
}

/**
 * 商品價格表。**只認資料庫**。
 *
 * 舊版會先鋪 lib/content.ts 的靜態價格再讓 DB 覆蓋。那在還沒有後台的時候
 * 是合理的保險，但現在後台可以改價了，靜態價就變成一顆定時炸彈：
 * 商品下架或改價之後，靜態價仍然查得到，於是會用一個過期的金額真的收錢。
 *
 * 查不到就是查不到，讓呼叫端拒單 —— 少賣一筆的代價遠低於收錯錢。
 */
async function loadPriceBook(supabase: ServiceClient | null, slugs: string[]) {
  const wanted = new Set(slugs);
  const book = new Map<string, { id: string | null; price: number }>();

  if (!supabase || wanted.size === 0) return book;

  try {
    const { data, error } = await supabase
      .from("products")
      .select("id,slug,price")
      .in("slug", [...wanted]);
    if (error) {
      console.error("[orders] 讀 products 失敗", error.message);
      return book;
    }
    for (const row of (data ?? []) as {
      id: string;
      slug: string;
      price: number;
    }[]) {
      if (typeof row.price === "number") {
        book.set(row.slug, { id: row.id, price: row.price });
      }
    }
  } catch (err) {
    console.error("[orders] 讀 products 例外", err);
  }

  return book;
}

/**
 * 寫入 orders + order_items。
 * orders 先試「含聯絡資料」的完整欄位；若 schema 還沒有那些欄位（PGRST204 / 42703），
 * 退回 STACK.md §3 定義的基本欄位再試一次，兩次都不行才放棄。
 */
async function persist(
  supabase: ServiceClient,
  o: {
    order_no: string;
    payment_method: string;
    total: number;
    price_unverified: boolean;
    name: string;
    phone: string;
    email: string;
    address: string;
    note: string;
    lines: Line[];
  },
) {
  const base = {
    order_no: o.order_no,
    status: "pending",
    payment_method: o.payment_method,
    total: o.total,
  };

  // 欄位名對照過線上 orders 表（contact_* 而不是 customer_*）
  const rich = {
    ...base,
    contact_name: o.name,
    contact_phone: o.phone,
    contact_email: o.email,
    shipping_address: o.address || null,
    note: o.note || null,
    price_unverified: o.price_unverified,
  };

  let orderId: string | null = null;

  for (const row of [rich, base]) {
    const { data, error } = await supabase
      .from("orders")
      .insert(row)
      .select("id")
      .single();

    if (!error && data?.id) {
      orderId = data.id as string;
      if (row === base) {
        // 退回基本欄位＝聯絡資料沒進 DB，只能靠這行 log 找回來
        console.error(
          "[orders] orders 表沒有聯絡資料欄位，只寫入基本欄位；聯絡方式請人工補上",
          JSON.stringify({
            order_no: o.order_no,
            contact: {
              name: o.name,
              phone: o.phone,
              email: o.email,
              address: o.address,
              note: o.note,
            },
          }),
        );
      }
      break;
    }
    console.error("[orders] 寫入 orders 失敗", o.order_no, error?.message);
  }

  if (!orderId) return false;

  const { error: itemsError } = await supabase.from("order_items").insert(
    o.lines.map((l) => ({
      order_id: orderId,
      product_id: l.product_id,
      session_id: l.session_id,
      unit_price: l.unit_price,
      qty: l.qty,
    })),
  );

  if (itemsError) {
    console.error(
      "[orders] order_items 寫入失敗，訂單只有主檔沒有明細",
      o.order_no,
      orderId,
      itemsError.message,
    );
    return false;
  }

  return true;
}

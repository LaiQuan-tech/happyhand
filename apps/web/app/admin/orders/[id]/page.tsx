import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStaff, requireCapability, adminErrorMessage } from "@/lib/admin/guard";
import { can } from "@/lib/admin/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { formatTaipei } from "@/components/admin/datetime-field";
import { OrderStatusButtons } from "@/components/admin/order-status-buttons";
import { OrderStatusChip } from "../status-chip";
import { money, paymentMethodLabel } from "../shared";

/**
 * 訂單明細。
 *
 * 這頁是客服處理一筆訂單時唯一要看的畫面，所以四件事必須同時在上面：
 * 收多少錢、聯絡得到誰、買了哪一場（幾點在哪裡）、現在能做什麼。
 *
 * 讀取一律 service role（orders 的 RLS 只認 user_id，而訪客結帳沒有 user_id）。
 * 授權靠 requireCapability("orders:read")——editor 角色沒有這個能力，
 * 那是刻意的：內容編輯的工作不需要看到客人的電話與地址。
 */

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  payment_method: string | null;
  total: number;
  price_unverified: boolean;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  shipping_address: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
};

type Embedded<T> = T | T[] | null;

type ItemRow = {
  id: string;
  qty: number;
  unit_price: number;
  product_id: string | null;
  session_id: string | null;
  products: Embedded<{ title: string | null; type: string | null }>;
  workshop_sessions: Embedded<{
    starts_at: string | null;
    ends_at: string | null;
    location: string | null;
    address: string | null;
    status: string | null;
  }>;
};

/** PostgREST 的內嵌關聯有時回物件、有時回陣列，統一收斂成單一物件。 */
function one<T>(value: Embedded<T>): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  try {
    await requireCapability("orders:read");
  } catch (err) {
    return <AccessDenied message={adminErrorMessage(err)} />;
  }

  const { id } = await params;
  const staff = await getStaff();
  const canWrite = can(staff?.role, "orders:write");

  let supabase: ReturnType<typeof createServiceClient>;
  try {
    supabase = createServiceClient();
  } catch (err) {
    console.error("[admin/orders] service client 建立失敗", err);
    return <LoadError message="資料庫連線未設定，請聯絡工程師檢查伺服器環境變數。" />;
  }

  const { data: orderRaw, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, order_no, status, payment_method, total, price_unverified, contact_name, contact_phone, contact_email, shipping_address, note, created_at, updated_at, paid_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (orderError) {
    console.error("[admin/orders] 讀取訂單失敗", id, orderError.message);
    return <LoadError message="訂單讀取失敗。請重新整理，若持續失敗請截圖回報。" />;
  }

  const order = orderRaw as OrderRow | null;
  if (!order) notFound();

  // 品項查壞了不該讓整頁白畫面——狀態操作是這一頁最重要的功能，
  // 就算看不到買了什麼，客服至少還能標記收款。
  const { data: itemsRaw, error: itemsError } = await supabase
    .from("order_items")
    .select(
      "id, qty, unit_price, product_id, session_id, products(title, type), workshop_sessions(starts_at, ends_at, location, address, status)",
    )
    .eq("order_id", id);

  if (itemsError) {
    console.error("[admin/orders] 讀取品項失敗", id, itemsError.message);
  }
  const items = (itemsRaw ?? []) as ItemRow[];
  const itemsTotal = items.reduce((sum, item) => sum + item.unit_price * item.qty, 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link
          href="/admin/orders"
          className="inline-flex items-center gap-1 text-[13px] text-accent-ink hover:underline"
        >
          <span aria-hidden="true">←</span> 回訂單列表
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-serif text-[24px] leading-tight font-medium break-all text-ink">
            {order.order_no}
          </h1>
          <OrderStatusChip status={order.status} />
        </div>
      </div>

      {order.price_unverified && <PriceUnverifiedBanner total={order.total} />}

      <Panel title="訂單資訊">
        <DescList>
          <Row label="金額">
            <span className="font-medium text-ink">{money(order.total)}</span>
          </Row>
          <Row label="付款方式">{paymentMethodLabel(order.payment_method)}</Row>
          <Row label="成立時間">{formatTaipei(order.created_at) || "—"}</Row>
          <Row label="付款時間">
            {order.paid_at ? (
              formatTaipei(order.paid_at)
            ) : (
              <span className="text-ink-soft">尚未收款</span>
            )}
          </Row>
          <Row label="最後更新">{formatTaipei(order.updated_at) || "—"}</Row>
        </DescList>
      </Panel>

      <Panel title="聯絡資訊">
        <DescList>
          <Row label="姓名">{order.contact_name || <Missing />}</Row>
          <Row label="電話">
            {order.contact_phone ? (
              // tel: 讓客服在手機後台可以直接撥出去，這是他們最常做的下一步
              <a href={`tel:${order.contact_phone}`} className="text-accent-ink hover:underline">
                {order.contact_phone}
              </a>
            ) : (
              <Missing />
            )}
          </Row>
          <Row label="Email">
            {order.contact_email ? (
              <a
                href={`mailto:${order.contact_email}`}
                className="break-all text-accent-ink hover:underline"
              >
                {order.contact_email}
              </a>
            ) : (
              <Missing />
            )}
          </Row>
          <Row label="寄送地址">{order.shipping_address || <Missing />}</Row>
          <Row label="備註">
            {order.note ? (
              <span className="whitespace-pre-wrap">{order.note}</span>
            ) : (
              <Missing />
            )}
          </Row>
        </DescList>
      </Panel>

      <Panel title="品項">
        {itemsError ? (
          <p className="text-[14px] leading-relaxed text-ink-soft">
            品項讀取失敗，下方的狀態操作仍然可以使用。詳細錯誤已記在伺服器 log。
          </p>
        ) : items.length === 0 ? (
          <p className="text-[14px] leading-relaxed text-ink-soft">
            這筆訂單沒有任何品項。這通常代表結帳當下寫入品項失敗了，請人工確認客人買了什麼。
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <OrderItem key={item.id} item={item} />
              ))}
            </ul>
            {itemsTotal !== order.total && (
              <p className="mt-3 rounded-input border border-danger bg-panel px-3 py-2 text-[13px] leading-relaxed text-danger">
                品項小計 {money(itemsTotal)} 與訂單金額 {money(order.total)} 不一致，
                請人工確認以哪個為準再處理收款。
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="狀態操作">
        <OrderStatusButtons orderId={order.id} status={order.status} canWrite={canWrite} />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ 品項 */

function OrderItem({ item }: { item: ItemRow }) {
  const product = one(item.products);
  const session = one(item.workshop_sessions);

  return (
    <li className="rounded-input border border-line bg-panel p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-[15px] font-medium break-words text-ink">
          {product?.title ?? (
            // product_id 是 nullable，而且 FK 是 on delete restrict，
            // 所以查不到通常代表結帳當下就沒對上商品——正是要人工複核的那種訂單。
            <span className="text-danger">（找不到商品資料）</span>
          )}
        </span>
        <span className="shrink-0 text-[14px] whitespace-nowrap text-ink">
          {money(item.unit_price)} × {item.qty}
        </span>
      </div>

      {session ? (
        <div className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
          <div>
            場次：{formatTaipei(session.starts_at)}
            {session.ends_at ? ` – ${formatTaipei(session.ends_at).split(" ")[1] ?? ""}` : ""}
          </div>
          {(session.location || session.address) && (
            <div className="break-words">
              地點：{[session.location, session.address].filter(Boolean).join("・")}
            </div>
          )}
        </div>
      ) : item.session_id ? (
        <div className="mt-1.5 text-[13px] leading-relaxed text-danger">
          這個品項指定了場次，但場次資料查不到，請人工確認。
        </div>
      ) : null}

      <div className="mt-1.5 text-[13px] text-ink-soft">
        小計 {money(item.unit_price * item.qty)}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ 版面 */

function PriceUnverifiedBanner({ total }: { total: number }) {
  return (
    <div role="alert" className="rounded-card border-2 border-danger bg-panel p-4">
      <p className="text-[15px] font-medium text-danger">
        這筆訂單成立時有商品查不到價格，金額請人工確認
      </p>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink">
        系統記錄的金額是 <span className="font-medium">{money(total)}</span>，
        但其中至少有一個品項的單價是前台送上來的、沒有經過伺服器端的定價核對。
        <span className="mt-1 block">
          標記收款前請先對照下方品項與目前的商品定價，確認客人該付多少。
        </span>
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-paper p-4 admin:p-5">
      <h2 className="mb-3 text-[16px] font-medium text-ink">{title}</h2>
      {children}
    </section>
  );
}

function DescList({ children }: { children: ReactNode }) {
  // 手機單欄（標籤在上、值在下），1024px 以上才變成兩欄的 label/value。
  // 用 grid + contents 讓 dt/dd 對齊，同時保留 <dl> 的語意。
  return (
    <dl className="grid grid-cols-1 gap-y-2.5 text-[14px] admin:grid-cols-[8rem_minmax(0,1fr)] admin:gap-x-4 admin:gap-y-3">
      {children}
    </dl>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="admin:contents">
      <dt className="text-[13px] text-ink-soft admin:text-[14px]">{label}</dt>
      <dd className="mt-0.5 min-w-0 break-words text-ink admin:mt-0">{children}</dd>
    </div>
  );
}

function Missing() {
  return <span className="text-ink-soft">（未填）</span>;
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-line bg-panel px-5 py-8">
      <p className="text-[14px] leading-relaxed text-ink-soft">{message}</p>
      <Link
        href="/admin/orders"
        className="mt-4 inline-flex min-h-11 items-center rounded-input border border-line-input bg-paper px-4 text-[14px] text-ink hover:bg-panel admin:min-h-10"
      >
        回訂單列表
      </Link>
    </div>
  );
}

function AccessDenied({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-line bg-panel px-5 py-8 text-center">
      <h1 className="font-serif text-[20px] font-medium text-ink">看不到這一頁</h1>
      <p className="mx-auto mt-2 max-w-[28rem] text-[14px] leading-relaxed text-ink-soft">
        {message}
        <span className="mt-1 block">
          訂單含有客人的姓名、電話與地址，只有客服與負責人看得到。
        </span>
      </p>
      <Link
        href="/admin"
        className="mt-4 inline-flex min-h-11 items-center rounded-input border border-line-input bg-paper px-4 text-[14px] text-ink hover:bg-panel admin:min-h-10"
      >
        回總覽
      </Link>
    </div>
  );
}

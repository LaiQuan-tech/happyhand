import Link from "next/link";
import { requireCapability, adminErrorMessage, AdminAuthError } from "@/lib/admin/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { DataList } from "@/components/admin/data-list";
import { AdminSelect } from "@/components/admin/admin-field";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABEL,
  firstValue,
  formatMoney,
  pickOne,
  toProductType,
  type ProductType,
} from "./shared";
import {
  FormNotice,
  LoadError,
  PermissionDenied,
  PublishChip,
  TypeChip,
  adminPrimaryButton,
  adminSecondaryButton,
} from "./ui";

/**
 * 課程與工作坊總覽。
 *
 * 這頁是內容編輯每天的起點，所以預設把**草稿也列出來**（用 service client 讀，
 * 不是 anon）—— 只看得到已發布的清單會讓人以為自己昨天建的課不見了。
 */

export const dynamic = "force-dynamic";

const PUBLISH_FILTERS = ["published", "draft"] as const;

type Row = {
  id: string;
  type: ProductType;
  slug: string;
  title: string;
  price: number;
  is_published: boolean;
  sort_order: number;
  lessonCount: number;
  sessionCount: number;
};

export default async function AdminProductsPage({
  searchParams,
}: {
  // Next 15：searchParams 是 Promise
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // 頁面層的授權。layout 只擋「不是員工」，擋不了「是員工但沒有 catalog:read」
  // ——客服（support）就屬於後者。
  try {
    await requireCapability("catalog:read");
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return <PermissionDenied message={adminErrorMessage(err)} />;
    }
    throw err;
  }

  const params = await searchParams;
  const typeFilter = pickOne(params.type, PRODUCT_TYPES);
  const publishFilter = pickOne(params.published, PUBLISH_FILTERS);
  const notice = firstValue(params.msg);
  const hasFilter = Boolean(typeFilter || publishFilter);

  let rows: Row[] = [];
  let loadError = "";

  try {
    const db = createServiceClient();

    // course_lessons(count) / workshop_sessions(count) 是 PostgREST 的
    // 內嵌聚合，一次往返就拿到每門課的單元數與場次數，
    // 不用為了清單頁的兩個數字打 N+1 次查詢。
    let query = db
      .from("products")
      .select(
        "id, type, slug, title, price, is_published, sort_order, course_lessons(count), workshop_sessions(count)",
      )
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (typeFilter) query = query.eq("type", typeFilter);
    if (publishFilter) query = query.eq("is_published", publishFilter === "published");

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    type Raw = {
      id: string;
      type: string;
      slug: string;
      title: string;
      price: number;
      is_published: boolean;
      sort_order: number;
      course_lessons: { count: number }[] | null;
      workshop_sessions: { count: number }[] | null;
    };

    rows = ((data ?? []) as unknown as Raw[]).map((raw) => ({
      id: raw.id,
      type: toProductType(raw.type),
      slug: raw.slug,
      title: raw.title,
      price: raw.price,
      is_published: raw.is_published,
      sort_order: raw.sort_order,
      lessonCount: raw.course_lessons?.[0]?.count ?? 0,
      sessionCount: raw.workshop_sessions?.[0]?.count ?? 0,
    }));
  } catch (err) {
    console.error("[admin/products] 讀取清單失敗", err);
    loadError = "課程清單讀取失敗，請重新整理一次。";
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-[24px] leading-tight font-medium text-ink">
            課程與工作坊
          </h1>
          <p className="mt-1 text-[14px] text-ink-soft">
            共 {rows.length} 門{hasFilter ? "（已套用篩選）" : ""}。草稿也會列在這裡，
            只有「發布中」的才會出現在前台。
          </p>
        </div>
        <Link href="/admin/products/new" className={`${adminPrimaryButton} shrink-0`}>
          新增課程
        </Link>
      </div>

      {notice && <FormNotice code={notice} />}

      {/*
        純 HTML 的 GET 表單，沒有 JavaScript 也能篩選。
        AdminSelect 是非受控的，所以要用 key 綁住目前的值 ——
        不然從網址列改參數之後 React 會沿用舊的 DOM 值，畫面與網址對不上。
      */}
      <form
        method="get"
        className="grid grid-cols-1 gap-3 rounded-card border border-line bg-panel p-3.5 admin:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_1fr] admin:items-end admin:p-4"
      >
        <AdminSelect
          key={`type-${typeFilter}`}
          name="type"
          label="類型"
          defaultValue={typeFilter}
          options={[
            { value: "", label: "全部類型" },
            ...PRODUCT_TYPES.map((value) => ({
              value,
              label: PRODUCT_TYPE_LABEL[value],
            })),
          ]}
        />
        <AdminSelect
          key={`published-${publishFilter}`}
          name="published"
          label="發布狀態"
          defaultValue={publishFilter}
          options={[
            { value: "", label: "全部狀態" },
            { value: "published", label: "發布中" },
            { value: "draft", label: "草稿" },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={adminSecondaryButton}>
            套用篩選
          </button>
          {hasFilter && (
            <Link
              href="/admin/products"
              className="text-[14px] text-accent-ink underline underline-offset-4"
            >
              清除
            </Link>
          )}
        </div>
      </form>

      {loadError ? (
        <LoadError message={loadError} />
      ) : (
        <DataList
          items={rows}
          keyOf={(row) => row.id}
          href={(row) => `/admin/products/${row.id}`}
          caption="課程與工作坊清單，含類型、售價、發布狀態與內容數量"
          empty={
            hasFilter
              ? "沒有符合篩選條件的課程。試著把篩選清除看看。"
              : "還沒有任何課程。點右上角的「新增課程」開始建立。"
          }
          columns={[
            {
              header: "課程名稱",
              primary: true,
              cell: (row) => (
                <span className="block">
                  {row.title}
                  <span className="mt-0.5 block text-[12px] font-normal text-ink-soft">
                    /{row.slug}
                  </span>
                </span>
              ),
            },
            {
              header: "發布狀態",
              trailing: true,
              cell: (row) => <PublishChip published={row.is_published} />,
            },
            { header: "類型", cell: (row) => <TypeChip type={row.type} /> },
            { header: "售價", align: "right", cell: (row) => formatMoney(row.price) },
            {
              header: "單元／場次",
              align: "right",
              cell: (row) => <ContentCount row={row} />,
            },
            {
              header: "排序",
              align: "right",
              desktopOnly: true,
              cell: (row) => row.sort_order,
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * 單元數與場次數。
 *
 * 兩個都顯示而不是依 type 二選一：資料庫刻意沒有限制
 * workshop_sessions.product_id 必須是 workshop 類型（見 init.sql 的表註解），
 * 實際資料裡「讀脈入門課」就是一門 course 同時掛著一場台北實體班。
 * 只依類型顯示其中一個，那一場就會在後台徹底消失。
 */
function ContentCount({ row }: { row: { lessonCount: number; sessionCount: number } }) {
  const parts: string[] = [];
  if (row.lessonCount > 0) parts.push(`${row.lessonCount} 單元`);
  if (row.sessionCount > 0) parts.push(`${row.sessionCount} 場次`);
  if (parts.length === 0) return <span className="text-ink-soft">—</span>;
  return <span className="whitespace-nowrap">{parts.join("／")}</span>;
}

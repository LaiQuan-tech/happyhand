import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, adminErrorMessage, AdminAuthError } from "@/lib/admin/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/admin/product-form";
import { LessonEditor } from "@/components/admin/lesson-editor";
import { SessionEditor } from "@/components/admin/session-editor";
import { BlockEditor } from "@/components/admin/block-editor";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { deleteProduct, togglePublish } from "../actions";
import {
  firstValue,
  toProductType,
  toSessionStatus,
  type LessonRow,
  type ProductRow,
  type SessionRow,
  type BlockRow,
} from "../shared";
import {
  FormNotice,
  LoadError,
  PermissionDenied,
  PublishChip,
  SectionHeader,
  TypeChip,
} from "../ui";

/**
 * 新增／編輯課程。
 *
 * id === "new" 走新增。用同一個路由而不是另開 /admin/products/new/page.tsx，
 * 表單與驗證只會有一份。
 *
 * 單元／場次區塊只在編輯既有課程時出現：它們都需要 product_id 才掛得上去，
 * 新增時還沒有。所以新增成功後 redirect 到 ?msg=created，
 * 那句話會告訴使用者現在可以往下編輯了。
 */

export const dynamic = "force-dynamic";

/** 報名頁區塊的顯示順序與說明。順序就是後台的排列順序。 */
const BLOCK_SECTIONS = [
  {
    kind: "faq",
    title: "常見問題",
    description: "客人最常問的問題。前台是可以點開收合的手風琴。",
  },
  {
    kind: "step",
    title: "學習路徑",
    description: "從報名到完課的階段。前台會自動編號 01、02…",
  },
  {
    kind: "info_row",
    title: "報名資訊",
    description: "課程費用、上課地點、付款方式這類「項目：內容」的對照表。",
  },
  {
    kind: "pricing",
    title: "費用方案",
    description: "新生價、複訓價等不同方案。可以各自帶金額與附註。",
  },
  {
    kind: "feature",
    title: "特色說明",
    description: "陪伴機制、教學特色這類三欄卡片。",
  },
] as const;

export default async function AdminProductEditPage({
  params,
  searchParams,
}: {
  // Next 15：params 與 searchParams 都是 Promise
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  try {
    await requireCapability("catalog:read");
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return <PermissionDenied message={adminErrorMessage(err)} />;
    }
    throw err;
  }

  const { id } = await params;
  const notice = firstValue((await searchParams).msg);
  const isNew = id === "new";

  if (isNew) {
    return (
      <div className="flex flex-col gap-5">
        <Header title="新增課程" />
        {notice && <FormNotice code={notice} />}
        <ProductForm product={null} />
      </div>
    );
  }

  let product: ProductRow | null = null;
  let lessons: LessonRow[] = [];
  let blocks: BlockRow[] = [];
  let sessions: SessionRow[] = [];
  let loadError = "";

  try {
    const db = createServiceClient();

    const { data, error } = await db
      .from("products")
      .select(
        "id, type, slug, title, subtitle, description, price, compare_at_price, cover_url, is_published, is_featured, tags, benefits, sort_order, hero_lead, suitable_for, not_suitable_for, outcomes, curriculum_online, curriculum_onsite, includes, notes, asks_intake",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) notFound();

    const raw = data as unknown as ProductRow & { type: string };
    product = { ...raw, type: toProductType(raw.type) };

    const [lessonResult, sessionResult, blockResult] = await Promise.all([
      db
        .from("course_lessons")
        .select("id, title, duration_sec, youtube_id, free_preview, sort_order")
        .eq("product_id", id)
        .order("sort_order", { ascending: true }),
      db
        .from("workshop_sessions")
        .select("id, starts_at, ends_at, location, address, capacity, seats_taken, status, title, summary, format, price, notes")
        .eq("product_id", id)
        .order("starts_at", { ascending: true }),
      db
        .from("product_blocks")
        .select("id, kind, sort_order, title, body, meta")
        .eq("product_id", id)
        .order("kind", { ascending: true })
        .order("sort_order", { ascending: true }),
    ]);

    if (lessonResult.error) throw new Error(lessonResult.error.message);
    if (sessionResult.error) throw new Error(sessionResult.error.message);
    if (blockResult.error) throw new Error(blockResult.error.message);

    lessons = (lessonResult.data ?? []) as unknown as LessonRow[];
    blocks = (blockResult.data ?? []) as unknown as BlockRow[];
    sessions = ((sessionResult.data ?? []) as unknown as (SessionRow & { status: string })[]).map(
      (row) => ({ ...row, status: toSessionStatus(row.status) }),
    );
  } catch (err) {
    // notFound() 是靠丟例外實作的，被這裡 catch 住就會變成「讀取失敗」
    // 而不是 404 畫面。原封不動往上丟。
    if (isNextControlFlow(err)) throw err;
    console.error("[admin/products] 讀取課程失敗", err);
    loadError = "課程資料讀取失敗，請重新整理一次。";
  }

  if (loadError || !product) {
    return (
      <div className="flex flex-col gap-5">
        <Header title="編輯課程" />
        <LoadError message={loadError || "找不到這門課。"} />
      </div>
    );
  }

  /*
    單元／場次要不要顯示，看的是「有沒有資料」而不是只看 type。

    資料庫刻意沒有限制 workshop_sessions.product_id 必須是 workshop
    （見 init.sql 的表註解），實際資料裡「快樂手 JSJ 讀脈入門課」就是
    一門 course 同時掛著一場台北實體班。只依 type 二選一顯示的話，
    那一場會在後台完全消失 —— 沒有人改得到，也沒有人知道它還在。
  */
  const showLessons = product.type === "course" || lessons.length > 0;
  const showSessions = product.type === "workshop" || sessions.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Header
        title={product.title}
        meta={
          <>
            <TypeChip type={product.type} />
            <PublishChip published={product.is_published} />
            <span className="text-[13px] text-ink-soft">/{product.slug}</span>
          </>
        }
        actions={
          <>
            <ConfirmButton
              action={togglePublish.bind(null, product.id, !product.is_published)}
              confirmText={
                product.is_published
                  ? `確定要把「${product.title}」下架嗎？\n\n下架後前台就看不到這門課了，已經買過的學員仍然看得到。`
                  : `確定要發布「${product.title}」嗎？\n\n發布後任何人都能在前台看到並購買。`
              }
            >
              {product.is_published ? "下架" : "發布"}
            </ConfirmButton>
            <ConfirmButton
              action={deleteProduct.bind(null, product.id)}
              variant="danger"
              confirmText={
                `確定要刪除「${product.title}」嗎？\n\n` +
                "這門課的所有單元與場次都會一起刪除，無法復原。\n" +
                "如果已經有人買過，系統會擋下來並請你改用「下架」。"
              }
            >
              刪除
            </ConfirmButton>
          </>
        }
      />

      {notice && <FormNotice code={notice} />}

      <section className="flex flex-col gap-4">
        <SectionHeader title="基本資料" />
        <ProductForm product={product} />
      </section>

      {showLessons && (
        <section id="lessons" className="flex flex-col gap-4 border-t border-line pt-6">
          <SectionHeader
            title="課程單元"
            description={
              product.type === "course"
                ? "調整順序不會動到學員已經看到的進度。移除單元則會連進度一起刪掉。"
                : "這門課的類型不是線上課程，但它底下已經有單元，所以一併列出來讓你能編輯。"
            }
          />
          <LessonEditor productId={product.id} lessons={lessons} />
        </section>
      )}

      {/*
        報名頁的內容區塊。每一種都可以增減與排序，全部留空就不會顯示在前台。
        一個 BlockEditor 吃 kind 參數重用五次 —— 它們的差別只有標籤文字。
      */}
      <section className="flex flex-col gap-6 border-t border-line pt-6">
        <SectionHeader
          title="報名頁區塊"
          description="常見問題、學習路徑、報名資訊、費用方案與特色說明。每一區留空就不會出現在前台。"
        />
        {BLOCK_SECTIONS.map((sec) => (
          <div key={sec.kind} className="flex flex-col gap-3">
            <h3 className="text-[15px] font-medium text-ink">{sec.title}</h3>
            <p className="text-[13px] text-ink-soft">{sec.description}</p>
            <BlockEditor
              productId={product.id}
              kind={sec.kind}
              blocks={blocks.filter((b) => b.kind === sec.kind)}
            />
          </div>
        ))}
      </section>

      {showSessions && (
        <section id="sessions" className="flex flex-col gap-4 border-t border-line pt-6">
          <SectionHeader
            title="工作坊場次"
            description={
              product.type === "workshop"
                ? "已報名人數由結帳流程維護，在這裡看得到但改不了；要微調請到「場次報名」。"
                : "這門課的類型不是實體工作坊，但它底下已經有場次（例如線上課另外開的實體班），所以一併列出來讓你能編輯。"
            }
          />
          <SessionEditor productId={product.id} sessions={sessions} />
        </section>
      )}
    </div>
  );
}

function Header({
  title,
  meta,
  actions,
}: {
  title: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/admin/products"
        className="text-[14px] text-accent-ink underline underline-offset-4"
      >
        ← 回課程列表
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-[24px] leading-tight font-medium break-words text-ink">
            {title}
          </h1>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Next 用「丟例外」實作 notFound() 與 redirect()。
 * 這種例外必須原封不動往上丟，被 catch 住的話 404 會變成一句
 * 「讀取失敗」，而使用者以為是系統壞了。
 */
function isNextControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

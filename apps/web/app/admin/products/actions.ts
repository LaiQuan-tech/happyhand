"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability, adminErrorMessage } from "@/lib/admin/guard";
import { writeAudit, diffOf } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { parseYouTubeId } from "@/lib/youtube";
import { taipeiLocalToIso, formatTaipei } from "@/components/admin/datetime-field";
import { applyLessonPlan, planLessonWrites, type SubmittedLesson } from "./lesson-plan";
import { checkProductDeletable, checkSessionDeletable, type CountClient } from "./guards";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABEL,
  SESSION_STATUS_CHOICES,
  SESSION_STATUS_LABEL,
  isValidSlug,
  joinDuration,
  linesToArray,
  parseIntField,
  toSessionStatus,
  type ProductType,
  type SessionStatus,
  contentLinesToArray,
  toSessionFormat,
} from "./shared";

/**
 * 課程與工作坊的寫入動作。
 *
 * ⚠️ 每一支都自己呼叫一次 requireCapability("catalog:write")。
 *    app/admin/layout.tsx 的守衛只在 render 頁面時跑，server action 的 POST
 *    不經過它 —— 少寫一行，任何登入的一般會員都能改課程價格。
 *
 * ⚠️ 前台是 ISR（/、/courses、/workshops 都是 revalidate = 300），
 *    改完沒有 revalidatePath 的話客戶會盯著沒變的頁面說「你根本沒改」。
 *    所以每一支成功的寫入最後都會呼叫 revalidateStorefront()。
 *
 * ⚠️ 一律不要手寫 updated_at：那幾張表都有 `trg_*_updated_at` trigger
 *    （before update -> set_updated_at()），應用層再寫一次只會互相打架。
 */

export type ActionResult = { error?: string | null } | undefined;

/* ------------------------------------------------------------ 快取清除 */

/**
 * 前台所有會看到商品資料的路徑。
 *
 * 動態路由用 `("/courses/[slug]", "page")` 這個形式而不是拼真實 slug：
 * 改名時舊網址那一份也要打掉，拼字串只會清到新的那一個，
 * 舊網址會繼續從快取吐出已經不存在的頁面直到 300 秒過去。
 */
function revalidateStorefront() {
  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath("/courses/[slug]", "page");
  revalidatePath("/workshops");
  revalidatePath("/workshops/[slug]", "page");
}

function revalidateAdmin(productId?: string) {
  revalidatePath("/admin/products");
  if (productId) revalidatePath(`/admin/products/${productId}`);
  // 場次頁與後台首頁都會列出課程名稱與場次，一起打掉才不會前後不一致。
  revalidatePath("/admin/sessions");
  revalidatePath("/admin");
}

/* ------------------------------------------------------------ 新增／編輯 */

/**
 * 建立或更新一門課。
 *
 * 這支是 `<form action={upsertProduct}>` 直接呼叫的，回傳值沒有地方接
 * （要接就得把整張表單變成 client component 走 useActionState，
 * 那會為了錯誤訊息把整組 AdminField 拉進 client bundle）。
 * 所以結果一律用 redirect 帶一個短代碼回來，由頁面翻成中文。
 *
 * 取捨：驗證失敗時使用者剛打的字會不見。
 * 為了把這件事的發生率壓到最低，格式類的規則同時掛在 <input> 的
 * required / pattern / min 上，瀏覽器會在送出前就擋下來；
 * 真正會走到這裡的只剩「代稱重複」這種 server 才知道的情況。
 */
export async function upsertProduct(formData: FormData): Promise<void> {
  let destination = "/admin/products";

  try {
    const staff = await requireCapability("catalog:write");

    const id = String(formData.get("id") ?? "").trim();
    const isNew = id === "";

    const typeRaw = String(formData.get("type") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const title = String(formData.get("title") ?? "").trim();
    const subtitle = String(formData.get("subtitle") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const coverUrl = String(formData.get("cover_url") ?? "").trim();
    const heroLead = String(formData.get("hero_lead") ?? "").trim();

    // ⚠️ 沒勾的 checkbox 根本不會出現在 FormData 裡，
    //    所以是比對 "on" 而不是 Boolean(...)。
    const isPublished = formData.get("is_published") === "on";
    const isFeatured = formData.get("is_featured") === "on";

    const failTo = isNew ? "/admin/products/new" : `/admin/products/${id}`;

    if (!(PRODUCT_TYPES as readonly string[]).includes(typeRaw)) {
      destination = `${failTo}?msg=type_invalid`;
      return;
    }
    const type = typeRaw as ProductType;

    if (!isValidSlug(slug)) {
      destination = `${failTo}?msg=slug_format`;
      return;
    }
    if (!title) {
      destination = `${failTo}?msg=title_required`;
      return;
    }

    const price = parseIntField(String(formData.get("price") ?? ""));
    if (price === undefined || price === null || price < 0) {
      destination = `${failTo}?msg=price_invalid`;
      return;
    }

    const compareAt = parseIntField(String(formData.get("compare_at_price") ?? ""));
    if (compareAt === undefined) {
      destination = `${failTo}?msg=compare_invalid`;
      return;
    }
    // products_compare_at_price_sane check (compare_at_price is null or >= price)。
    // 不先擋的話資料庫會回一句 23514 的英文，員工只會看到「儲存失敗」。
    if (compareAt !== null && compareAt < price) {
      destination = `${failTo}?msg=compare_invalid`;
      return;
    }

    const sortOrder = parseIntField(String(formData.get("sort_order") ?? ""));
    if (sortOrder === undefined || sortOrder === null) {
      destination = `${failTo}?msg=sort_invalid`;
      return;
    }

    const payload = {
      type,
      slug,
      title: title.slice(0, 200),
      subtitle: subtitle ? subtitle.slice(0, 200) : null,
      description: description ? description.slice(0, 4000) : null,
      price,
      compare_at_price: compareAt,
      cover_url: coverUrl ? coverUrl.slice(0, 500) : null,
      is_published: isPublished,
      is_featured: isFeatured,
      tags: linesToArray(String(formData.get("tags") ?? "")),
      benefits: linesToArray(String(formData.get("benefits") ?? "")),
      sort_order: sortOrder,

      // 報名頁內容。用 contentLinesToArray（40 項 × 200 字）而不是上面那個
      // linesToArray（20 項 × 60 字）—— 課程大綱條目用 60 字寫不完。
      hero_lead: heroLead ? heroLead.slice(0, 2000) : null,
      suitable_for: contentLinesToArray(String(formData.get("suitable_for") ?? "")),
      not_suitable_for: contentLinesToArray(
        String(formData.get("not_suitable_for") ?? ""),
      ),
      outcomes: contentLinesToArray(String(formData.get("outcomes") ?? "")),
      curriculum_online: contentLinesToArray(
        String(formData.get("curriculum_online") ?? ""),
      ),
      curriculum_onsite: contentLinesToArray(
        String(formData.get("curriculum_onsite") ?? ""),
      ),
      includes: contentLinesToArray(String(formData.get("includes") ?? "")),
      notes: contentLinesToArray(String(formData.get("notes") ?? "")),
      asks_intake: formData.get("asks_intake") === "on",
    };

    const db = createServiceClient();

    if (isNew) {
      const { data, error } = await db
        .from("products")
        .insert(payload)
        .select("id")
        .maybeSingle();

      if (error) {
        // 23505 = unique_violation，這裡只可能是 products_slug_key。
        destination =
          error.code === "23505"
            ? `${failTo}?msg=slug_taken`
            : `${failTo}?msg=failed`;
        if (error.code !== "23505") {
          console.error("[admin/products] 建立商品失敗", error);
        }
        return;
      }

      const newId = (data as unknown as { id: string } | null)?.id ?? "";
      await writeAudit(staff, {
        action: "product.create",
        entity: "product",
        entityId: newId || null,
        summary: `新增${PRODUCT_TYPE_LABEL[type]}「${payload.title}」（${slug}）`,
        diff: { created: payload },
      });

      revalidateAdmin(newId);
      revalidateStorefront();
      destination = newId ? `/admin/products/${newId}?msg=created` : "/admin/products";
      return;
    }

    const { data: before, error: beforeError } = await db
      .from("products")
      .select(
        "id, type, slug, title, subtitle, description, price, compare_at_price, cover_url, is_published, is_featured, tags, benefits, sort_order, hero_lead, suitable_for, not_suitable_for, outcomes, curriculum_online, curriculum_onsite, includes, notes, asks_intake",
      )
      .eq("id", id)
      .maybeSingle();

    if (beforeError) {
      console.error("[admin/products] 讀取商品失敗", beforeError);
      destination = `${failTo}?msg=failed`;
      return;
    }
    if (!before) {
      destination = "/admin/products?msg=notfound";
      return;
    }

    const { error } = await db.from("products").update(payload).eq("id", id);
    if (error) {
      destination =
        error.code === "23505" ? `${failTo}?msg=slug_taken` : `${failTo}?msg=failed`;
      if (error.code !== "23505") {
        console.error("[admin/products] 更新商品失敗", error);
      }
      return;
    }

    const prev = before as unknown as Record<string, unknown>;
    const diff = diffOf(prev, payload as unknown as Record<string, unknown>, [
      "type",
      "slug",
      "title",
      "subtitle",
      "description",
      "price",
      "compare_at_price",
      "cover_url",
      "is_published",
      "is_featured",
      "tags",
      "benefits",
      "sort_order",
      // 報名頁內容也要留稽核 —— 這些是對外文案，改錯了要查得到是誰改的
      "hero_lead",
      "suitable_for",
      "not_suitable_for",
      "outcomes",
      "curriculum_online",
      "curriculum_onsite",
      "includes",
      "notes",
      "asks_intake",
    ]);

    // 代稱換掉＝舊網址從此 404。稽核摘要要看得出來，
    // 之後客人反映連結壞掉時才查得到是誰在什麼時候改的。
    const slugChanged = prev.slug !== slug;
    await writeAudit(staff, {
      action: "product.update",
      entity: "product",
      entityId: id,
      summary: slugChanged
        ? `更新「${payload.title}」，網址代稱 ${String(prev.slug)} → ${slug}（舊網址將失效）`
        : `更新「${payload.title}」`,
      diff,
    });

    revalidateAdmin(id);
    revalidateStorefront();
    destination = `/admin/products/${id}?msg=saved`;
  } catch (err) {
    console.error("[admin/products] upsertProduct 例外", err);
    const id = String(formData.get("id") ?? "").trim();
    destination = id
      ? `/admin/products/${id}?msg=denied`
      : "/admin/products/new?msg=denied";
  } finally {
    // redirect() 是靠丟例外實作的，寫在 try 裡會被自己的 catch 吃掉。
    redirect(destination);
  }
}

/* ---------------------------------------------------------------- 上下架 */

export async function togglePublish(
  productId: string,
  next: boolean,
): Promise<ActionResult> {
  try {
    const staff = await requireCapability("catalog:write");
    const db = createServiceClient();

    const { data: before, error: beforeError } = await db
      .from("products")
      .select("id, title, is_published")
      .eq("id", productId)
      .maybeSingle();
    if (beforeError) return { error: "讀取課程失敗，請重試一次。" };
    if (!before) return { error: "找不到這門課，可能已經被其他同事刪除了。" };

    const row = before as unknown as { title: string; is_published: boolean };
    if (row.is_published === next) {
      return { error: next ? "這門課已經是發布中了。" : "這門課已經是草稿了。" };
    }

    const { error } = await db
      .from("products")
      .update({ is_published: next })
      .eq("id", productId);
    if (error) {
      console.error("[admin/products] 切換發布狀態失敗", error);
      return { error: "更新發布狀態失敗，請重試一次。" };
    }

    await writeAudit(staff, {
      action: next ? "product.publish" : "product.unpublish",
      entity: "product",
      entityId: productId,
      summary: `${next ? "發布" : "下架"}「${row.title}」`,
      diff: { is_published: { from: row.is_published, to: next } },
    });

    revalidateAdmin(productId);
    revalidateStorefront();
    return undefined;
  } catch (err) {
    console.error("[admin/products] togglePublish 例外", err);
    return { error: adminErrorMessage(err) };
  }
}

/* ------------------------------------------------------------------ 刪除 */

/**
 * 刪除一門課。
 *
 * 🔴 order_items.product_id 是 `on delete restrict`。
 *    有人買過就刪不掉，資料庫會回 23503。不先擋的話員工看到的是
 *    「儲存失敗」而完全不知道原因，只會一直重按。
 *
 * 🔴 另外一個更陰險的路徑：products 刪掉會 cascade 掉它底下的
 *    workshop_sessions，而 order_items.session_id 是 `on delete set null`。
 *    也就是說如果某張訂單只有 session_id 指過來、product_id 是 null，
 *    restrict 擋不住，刪下去訂單還在但「報名的是哪一場」會靜靜地變成 null。
 *    所以這裡連場次的參照也一起查。
 */
export async function deleteProduct(productId: string): Promise<ActionResult> {
  try {
    const staff = await requireCapability("catalog:write");
    const db = createServiceClient();

    const { data: before, error: beforeError } = await db
      .from("products")
      .select("id, title, slug, type, is_published")
      .eq("id", productId)
      .maybeSingle();
    if (beforeError) return { error: "讀取課程失敗，請重試一次。" };
    if (!before) return { error: "找不到這門課，可能已經被其他同事刪除了。" };
    const row = before as unknown as { title: string; is_published: boolean; slug: string };

    // 參照檢查抽在 ./guards.ts，驗收腳本跑的是同一支。
    // cast 的理由見 guards.ts 的 CountFilter 註解（supabase 的建構器泛型
    // 拿去比對結構型別會讓 tsc 爆 TS2589）。只在這一行銜接。
    const block = await checkProductDeletable(db as unknown as CountClient, productId, async (id) => {
      const { data, error } = await db
        .from("workshop_sessions")
        .select("id")
        .eq("product_id", id);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => (row as unknown as { id: string }).id);
    });
    if (block.blocked) return { error: block.reason };

    const { error } = await db.from("products").delete().eq("id", productId);
    if (error) {
      // 23503 = foreign_key_violation。上面已經先查過，走到這裡代表
      // 查完到刪掉之間剛好有人下單（競態）。照樣要說人話。
      if (error.code === "23503") {
        return { error: "這門課已經有人買過，不能刪除。請改成下架。" };
      }
      console.error("[admin/products] 刪除商品失敗", error);
      return { error: "刪除失敗，請重試一次。" };
    }

    await writeAudit(staff, {
      action: "product.delete",
      entity: "product",
      entityId: productId,
      summary: `刪除「${row.title}」（${row.slug}）`,
      diff: { deleted: { title: row.title, slug: row.slug, was_published: row.is_published } },
    });

    revalidateAdmin(productId);
    revalidateStorefront();
  } catch (err) {
    console.error("[admin/products] deleteProduct 例外", err);
    return { error: adminErrorMessage(err) };
  }

  // 成功才會走到這裡。redirect 要在 try/catch 外面，否則會被自己的 catch 吃掉。
  redirect("/admin/products?msg=saved");
}

/* ------------------------------------------------------------ 單元整批存 */

export type LessonSaveState = { error?: string; ok?: string } | null;

/**
 * 一次存下某門課的所有單元。
 *
 * 寫入計畫由 ./lesson-plan.ts 的 planLessonWrites() 算出來（純函式，
 * 驗收腳本跑的是同一支），這裡只負責照著計畫打資料庫。
 *
 * 🔴 兩階段搬移的原因見 lesson-plan.ts 的檔頭：
 *    unique (product_id, sort_order) 會在重排途中撞到，
 *    而 delete-then-insert 會經由 lesson_progress 的 cascade
 *    把所有學員的觀看進度洗掉。這裡全程 UPDATE，id 不變。
 */
export async function saveLessons(
  productId: string,
  _prev: LessonSaveState,
  formData: FormData,
): Promise<LessonSaveState> {
  try {
    const staff = await requireCapability("catalog:write");

    const count = Number(formData.get("lesson_count") ?? "0");
    if (!Number.isInteger(count) || count < 0 || count > 200) {
      return { error: "單元數量不正確，請重新整理後再試。" };
    }

    const submitted: SubmittedLesson[] = [];
    for (let i = 0; i < count; i += 1) {
      // 用「索引命名」而不是同名多值 + getAll()：
      // 沒勾的 checkbox 不會出現在 FormData，用 getAll() 對齊會整排錯位，
      // 第 3 課的「可試看」會跑到第 5 課身上。
      const title = String(formData.get(`lessons.${i}.title`) ?? "").trim();
      if (!title) {
        return { error: `第 ${i + 1} 個單元沒有填標題。` };
      }

      // 員工貼的是整條 YouTube 網址（他們不會知道什麼叫「影片 ID」），
      // 存進資料庫的是 11 碼 ID。
      //
      // ⚠️ 認不出來的字串**不要默默當成沒填**。那會變成
      //    「後台看起來有填、學員點播放卻說沒有影片」，而且沒有人查得出原因。
      //    寧可擋下整次儲存並回一句人話。
      const rawUrl = String(formData.get(`lessons.${i}.youtube_url`) ?? "").trim();
      const youtubeId = rawUrl ? parseYouTubeId(rawUrl) : null;
      if (rawUrl && !youtubeId) {
        return {
          error:
            `第 ${i + 1} 個單元的 YouTube 網址看不懂：「${rawUrl.slice(0, 60)}」。` +
            "請從 YouTube 影片頁的網址列整條複製過來（watch?v=、youtu.be 都可以）。",
        };
      }

      submitted.push({
        id: String(formData.get(`lessons.${i}.id`) ?? "").trim(),
        title: title.slice(0, 200),
        duration_sec: joinDuration(
          String(formData.get(`lessons.${i}.min`) ?? ""),
          String(formData.get(`lessons.${i}.sec`) ?? ""),
        ),
        youtube_id: youtubeId,
        free_preview: formData.get(`lessons.${i}.free_preview`) === "on",
      });
    }

    const db = createServiceClient();

    const { data: existingRaw, error: existingError } = await db
      .from("course_lessons")
      .select("id, sort_order")
      .eq("product_id", productId)
      .order("sort_order");
    if (existingError) {
      console.error("[admin/products] 讀取單元失敗", existingError);
      return { error: "讀取現有單元失敗，請重試一次。" };
    }
    const existing = (existingRaw ?? []) as unknown as { id: string; sort_order: number }[];

    const plan = planLessonWrites(existing, submitted);

    if (plan.unknownIds.length > 0) {
      return {
        error: "這份單元清單已經過期（有單元被其他同事刪掉了），請重新整理後再存一次。",
      };
    }

    // 實際寫入（刪除 -> PARK -> 寫回目標位置 -> 新增）交給 applyLessonPlan()。
    // 那四步的順序本身就是正確性的一部分，抽在 lesson-plan.ts 裡，
    // 驗收腳本才能跑到同一段程式碼而不是一份複製品。
    const failure = await applyLessonPlan(db, productId, plan);
    if (failure) {
      console.error("[admin/products] 寫入單元失敗", failure.stage, failure.message);
      const MESSAGES: Record<typeof failure.stage, string> = {
        delete: "刪除單元失敗，請重試一次。",
        park: "重新排序失敗，請重新整理後再試一次。",
        update: "儲存單元失敗，請重新整理後再試一次。",
        insert: "新增單元失敗，請重新整理後再試一次。",
      };
      return { error: MESSAGES[failure.stage] };
    }

    await writeAudit(staff, {
      action: "lesson.save",
      entity: "product",
      entityId: productId,
      summary: `更新單元清單：共 ${submitted.length} 個單元（新增 ${plan.insert.length}、刪除 ${plan.deleteIds.length}）`,
      diff: {
        total: submitted.length,
        inserted: plan.insert.length,
        deleted: plan.deleteIds.length,
        order: plan.update.map((row) => ({ id: row.id, sort_order: row.sort_order })),
      },
    });

    revalidateAdmin(productId);
    revalidateStorefront();
    return { ok: `已儲存 ${submitted.length} 個單元。` };
  } catch (err) {
    console.error("[admin/products] saveLessons 例外", err);
    return { error: adminErrorMessage(err) };
  }
}

/* ------------------------------------------------------------------ 場次 */

/**
 * 新增或更新一個場次。
 *
 * ⚠️ 這裡刻意完全不碰 seats_taken。那個數字歸結帳流程（reserve_seat /
 *    commit_seat_hold）與 /admin/sessions 的 admin_adjust_seats() 管，
 *    在課程編輯頁順手改它會直接和實際報名人數打架。
 *
 * ⚠️ 送上來的是台北牆上時間字串（"2026-09-12T14:00"），
 *    datetime-field 不會偷偷幫忙轉時區，所以這裡必須自己
 *    taipeiLocalToIso() 之後才寫進 timestamptz 欄位。
 */
export async function upsertSession(productId: string, formData: FormData): Promise<void> {
  let destination = `/admin/products/${productId}`;

  try {
    const staff = await requireCapability("catalog:write");

    const sessionId = String(formData.get("session_id") ?? "").trim();
    const startsAt = taipeiLocalToIso(String(formData.get("starts_at") ?? ""));
    const endsAt = taipeiLocalToIso(String(formData.get("ends_at") ?? ""));

    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
      destination = `/admin/products/${productId}?msg=session_time_invalid#sessions`;
      return;
    }

    const capacity = parseIntField(String(formData.get("capacity") ?? ""));
    if (capacity === undefined || capacity === null || capacity < 0) {
      destination = `/admin/products/${productId}?msg=session_capacity_invalid#sessions`;
      return;
    }

    const statusRaw = String(formData.get("status") ?? "").trim();
    const status: SessionStatus = (SESSION_STATUS_CHOICES as readonly string[]).includes(
      statusRaw,
    )
      ? (statusRaw as SessionStatus)
      : "open";

    const location = String(formData.get("location") ?? "").trim();
    const address = String(formData.get("address") ?? "").trim();

    const sessionTitle = String(formData.get("title") ?? "").trim();
    const sessionSummary = String(formData.get("summary") ?? "").trim();
    const sessionNotes = String(formData.get("notes") ?? "").trim();
    const sessionPrice = parseIntField(String(formData.get("price") ?? ""));
    if (sessionPrice === undefined || (sessionPrice !== null && sessionPrice < 0)) {
      destination = `/admin/products/${productId}?msg=session_price_invalid#sessions`;
      return;
    }

    const payload = {
      starts_at: startsAt,
      ends_at: endsAt,
      location: location ? location.slice(0, 200) : null,
      address: address ? address.slice(0, 300) : null,
      capacity,
      status,
      title: sessionTitle ? sessionTitle.slice(0, 200) : null,
      summary: sessionSummary ? sessionSummary.slice(0, 300) : null,
      format: toSessionFormat(formData.get("format")),
      // ⚠️ 留空 = null = 用課程定價。0 是合法價格（免費場次），
      //    所以這裡用 parseIntField 的 null/undefined 區分，不能用 falsy 判斷。
      price: sessionPrice ?? null,
      notes: sessionNotes ? sessionNotes.slice(0, 300) : null,
    };

    const db = createServiceClient();

    if (sessionId === "") {
      const { data, error } = await db
        .from("workshop_sessions")
        .insert({ ...payload, product_id: productId })
        .select("id, status")
        .maybeSingle();
      if (error) {
        // 23505 = workshop_sessions_product_starts_key
        destination =
          error.code === "23505"
            ? `/admin/products/${productId}?msg=session_duplicate#sessions`
            : `/admin/products/${productId}?msg=failed#sessions`;
        if (error.code !== "23505") console.error("[admin/products] 新增場次失敗", error);
        return;
      }
      const created = data as unknown as { id: string; status: string } | null;
      await writeAudit(staff, {
        action: "session.create",
        entity: "session",
        entityId: created?.id ?? null,
        summary: `新增場次 ${formatTaipei(startsAt)}（${payload.location ?? "未填地點"}，名額 ${capacity}）`,
        diff: { product_id: productId, ...payload, landed_status: created?.status },
      });
    } else {
      const { data: before, error: beforeError } = await db
        .from("workshop_sessions")
        .select("id, starts_at, ends_at, location, address, capacity, status, seats_taken")
        .eq("id", sessionId)
        .eq("product_id", productId)
        .maybeSingle();
      if (beforeError) {
        console.error("[admin/products] 讀取場次失敗", beforeError);
        destination = `/admin/products/${productId}?msg=failed#sessions`;
        return;
      }
      if (!before) {
        destination = `/admin/products/${productId}?msg=session_notfound#sessions`;
        return;
      }
      const prev = before as unknown as Record<string, unknown>;

      // 名額不能砍到比已經報名的人數還少：
      // workshop_sessions_not_oversold check (seats_taken <= capacity) 會擋，
      // 但擋出來是 23514 的英文。先在這裡翻成人話。
      const seatsTaken = Number(prev.seats_taken ?? 0);
      if (capacity < seatsTaken) {
        destination = `/admin/products/${productId}?msg=session_capacity_invalid#sessions`;
        return;
      }

      const { data: after, error } = await db
        .from("workshop_sessions")
        .update(payload)
        .eq("id", sessionId)
        .select("status")
        .maybeSingle();
      if (error) {
        destination =
          error.code === "23505"
            ? `/admin/products/${productId}?msg=session_duplicate#sessions`
            : `/admin/products/${productId}?msg=failed#sessions`;
        if (error.code !== "23505") console.error("[admin/products] 更新場次失敗", error);
        return;
      }

      // trigger sync_workshop_session_status() 可能把 open 立刻改成 full
      // （人數已滿）。據實記錄真正落地的值，不要記我們「以為」寫進去的。
      const landed = toSessionStatus(
        (after as unknown as { status: string } | null)?.status ?? status,
      );

      await writeAudit(staff, {
        action: "session.update",
        entity: "session",
        entityId: sessionId,
        summary: `更新場次 ${formatTaipei(startsAt)}（${SESSION_STATUS_LABEL[landed]}，名額 ${capacity}）`,
        diff: diffOf(prev, { ...payload, status: landed } as unknown as Record<string, unknown>, [
          "starts_at",
          "ends_at",
          "location",
          "address",
          "capacity",
          "status",
        ]),
      });
    }

    revalidateAdmin(productId);
    revalidateStorefront();
    destination = `/admin/products/${productId}?msg=session_saved#sessions`;
  } catch (err) {
    console.error("[admin/products] upsertSession 例外", err);
    destination = `/admin/products/${productId}?msg=denied#sessions`;
  } finally {
    redirect(destination);
  }
}

/**
 * 刪除一個場次。
 *
 * 🔴 order_items.session_id 是 `on delete set null`，不是 restrict。
 *    刪下去資料庫不會吭聲，但訂單會變成「有人付了錢報名，可是不知道是哪一場」。
 *    這種資料一旦壞掉沒有辦法還原（沒有其他欄位記得場次）。
 *    所以只要有任何訂單明細指向這一場就不給刪，請他改成「已取消」——
 *    取消會保留紀錄，前台也看得出來這場不辦了。
 */
export async function deleteSession(
  sessionId: string,
  productId: string,
): Promise<ActionResult> {
  try {
    const staff = await requireCapability("catalog:write");
    const db = createServiceClient();

    const { data: before, error: beforeError } = await db
      .from("workshop_sessions")
      .select("id, starts_at, location, status")
      .eq("id", sessionId)
      .eq("product_id", productId)
      .maybeSingle();
    if (beforeError) return { error: "讀取場次失敗，請重試一次。" };
    if (!before) return { error: "找不到這個場次，可能已經被其他同事刪除了。" };
    const row = before as unknown as { starts_at: string; location: string | null };

    // 已付款／未付款兩種訊息都在 ./guards.ts，驗收腳本跑的是同一支。
    const block = await checkSessionDeletable(db as unknown as CountClient, sessionId);
    if (block.blocked) return { error: block.reason };

    const { error } = await db.from("workshop_sessions").delete().eq("id", sessionId);
    if (error) {
      console.error("[admin/products] 刪除場次失敗", error);
      return { error: "刪除場次失敗，請重試一次。" };
    }

    await writeAudit(staff, {
      action: "session.delete",
      entity: "session",
      entityId: sessionId,
      summary: `刪除場次 ${formatTaipei(row.starts_at)}（${row.location ?? "未填地點"}）`,
      diff: { product_id: productId, starts_at: row.starts_at },
    });

    revalidateAdmin(productId);
    revalidateStorefront();
    return undefined;
  } catch (err) {
    console.error("[admin/products] deleteSession 例外", err);
    return { error: adminErrorMessage(err) };
  }
}

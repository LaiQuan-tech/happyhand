import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { checkCapability } from "@/lib/admin/guard";
import { writeAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";
import {
  MATERIALS_BUCKET,
  MATERIAL_KIND_LABELS,
  MATERIAL_MAX_BYTES,
  MATERIAL_MAX_PER_LESSON,
  MATERIAL_MIME,
  extForMime,
  isMaterialKind,
  materialObjectPath,
  type MaterialKind,
} from "@/lib/admin/materials";

/**
 * 單元講義與插圖的上傳／刪除。
 *
 * 🔴 course-materials 是**私有** bucket，而且 storage.objects 沒有任何 policy
 *    （見 migration 20260828000001）—— 也就是 anon / authenticated 既寫不進去
 *    也讀不到。這支 route handler 是整條上傳鏈唯一的授權關卡，這裡漏掉就等於全開。
 *
 * 這是 fetch 端點不是頁面：權限不足回 403 JSON 不 redirect
 * （同 /api/admin/uploads 的理由：前端 fetch 拿到一坨登入頁 HTML 只會
 *  JSON.parse 失敗，看不出真正的原因）。
 */

export const runtime = "nodejs";
export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string, status: number) {
  return NextResponse.json({ message }, { status });
}

/* ------------------------------------------------------------------ 上傳 */

export async function POST(request: Request) {
  // 講義是課程內容，跟改課程同一個能力。support 拿不到 catalog:write。
  const staff = await checkCapability("catalog:write");
  if (!staff) return fail("你的帳號沒有編輯課程內容的權限。", 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch (err) {
    console.error("[admin/materials] 無法解析 multipart", err);
    return fail("上傳內容無法解析，請重新選擇檔案再試一次。", 400);
  }

  const lessonId = String(form.get("lesson_id") ?? "").trim();
  if (!UUID_RE.test(lessonId)) {
    return fail("請先儲存這個單元，再上傳檔案。", 400);
  }

  const rawKind = form.get("kind");
  if (!isMaterialKind(rawKind)) {
    // kind 決定允許的格式，一定要走白名單
    return fail("檔案用途不正確，請重新整理後再試一次。", 400);
  }
  const kind: MaterialKind = rawKind;

  const file = form.get("file");
  if (!(file instanceof File)) return fail("沒有收到檔案，請重新選擇。", 400);
  if (file.size === 0) return fail("這個檔案是空的，請換一個再試。", 400);
  if (file.size > MATERIAL_MAX_BYTES) {
    return fail("檔案太大，單檔上限 20MB。", 413);
  }
  if (!MATERIAL_MIME[kind].includes(file.type)) {
    return fail(
      kind === "file"
        ? "課程文件目前只收 PDF。Word 或 PowerPoint 請先另存成 PDF 再上傳。"
        : "圖片格式需為 JPEG、PNG 或 WebP。",
      400,
    );
  }

  const db = createServiceClient();
  if (!db) return fail("儲存服務暫時無法使用，請稍後再試。", 503);

  // 這一堂真的存在嗎（也順便擋掉亂送 lesson_id）
  const { data: lesson } = await db
    .from("course_lessons")
    .select("id, title")
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) return fail("找不到這個單元，請重新整理後再試一次。", 404);

  const { data: existing } = await db
    .from("lesson_materials")
    .select("sort_order")
    .eq("lesson_id", lessonId)
    .eq("kind", kind)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSort = ((existing?.[0]?.sort_order as number | undefined) ?? 0) + 1;
  if (nextSort > MATERIAL_MAX_PER_LESSON) {
    return fail(`一堂課最多 ${MATERIAL_MAX_PER_LESSON} 份，請先移除用不到的。`, 400);
  }

  const id = randomUUID();
  const path = materialObjectPath(lessonId, id, extForMime(file.type));

  const { error: upErr } = await db.storage
    .from(MATERIALS_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });
  if (upErr) {
    console.error("[admin/materials] 存檔失敗", upErr.message);
    return fail("檔案存不進去，請重試一次。", 500);
  }

  const { data: row, error: insErr } = await db
    .from("lesson_materials")
    .insert({
      id,
      lesson_id: lessonId,
      kind,
      storage_path: path,
      // 原始檔名只拿來顯示。截長度避免有人用超長檔名撐爆後台版面。
      file_name: (file.name || "未命名").slice(0, 200),
      mime_type: file.type,
      size_bytes: file.size,
      sort_order: nextSort,
    })
    .select("id, kind, file_name, mime_type, size_bytes, caption, sort_order")
    .single();

  if (insErr || !row) {
    // 資料列建不起來就把檔案收回去，不要在 bucket 裡留孤兒。
    await db.storage.from(MATERIALS_BUCKET).remove([path]);
    console.error("[admin/materials] 建立資料失敗", insErr?.message);
    return fail("儲存失敗，請重試一次。", 500);
  }

  await writeAudit(staff, {
    action: "lesson.material_added",
    entity: "lesson_materials",
    entityId: row.id,
    summary: `為單元「${lesson.title}」新增${MATERIAL_KIND_LABELS[kind]}：${row.file_name}`,
  });

  return NextResponse.json({ material: row }, { headers: { "Cache-Control": "no-store" } });
}

/* ------------------------------------------------------------------ 刪除 */

export async function DELETE(request: Request) {
  const staff = await checkCapability("catalog:write");
  if (!staff) return fail("你的帳號沒有編輯課程內容的權限。", 403);

  let body: { id?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("請求格式不正確。", 400);
  }
  const id = String(body.id ?? "").trim();
  if (!UUID_RE.test(id)) return fail("找不到這個檔案。", 400);

  const db = createServiceClient();
  if (!db) return fail("儲存服務暫時無法使用，請稍後再試。", 503);

  const { data: row } = await db
    .from("lesson_materials")
    .select("id, kind, file_name, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (!row) return fail("這個檔案已經不在了。", 404);

  // 先刪資料列再刪檔案：反過來的話，檔案刪掉但資料列還在，
  // 學員端會看到一個點了會壞掉的下載按鈕。
  const { error: delErr } = await db.from("lesson_materials").delete().eq("id", id);
  if (delErr) {
    console.error("[admin/materials] 刪除資料失敗", delErr.message);
    return fail("移除失敗，請重試一次。", 500);
  }
  const { error: rmErr } = await db.storage
    .from(MATERIALS_BUCKET)
    .remove([row.storage_path as string]);
  if (rmErr) {
    // 資料列已經沒了，學員端看不到它；bucket 裡留一個孤兒檔不影響任何人。
    console.error("[admin/materials] 檔案刪除失敗（已成孤兒）", rmErr.message);
  }

  await writeAudit(staff, {
    action: "lesson.material_removed",
    entity: "lesson_materials",
    entityId: id,
    summary: `移除${MATERIAL_KIND_LABELS[row.kind as MaterialKind]}：${row.file_name}`,
  });

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}

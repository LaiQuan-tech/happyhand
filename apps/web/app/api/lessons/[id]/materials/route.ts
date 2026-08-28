import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkLessonAccess } from "@/lib/account/lesson-access";
import {
  MATERIALS_BUCKET,
  MATERIAL_URL_TTL,
  type MaterialKind,
} from "@/lib/admin/materials";

/**
 * POST /api/lessons/[id]/materials — 驗過權限才發簽章網址
 *
 * 🔑 這支跟 ../video/route.ts 是**同一道付費牆的兩個出口**，
 *    授權判斷共用 lib/account/lesson-access.ts。要改條件請改那一支。
 *
 * course-materials 是私有 bucket 且沒有任何 storage policy，所以檔案本體
 * 只有 service role 拿得到。這裡的簽章網址是唯一的取得管道，
 * 而它在發出之前一定先過 checkLessonAccess()。
 *
 * ⚠️ 對「內容保護」要誠實：這擋得住**沒買的人**，擋不住**買了的人**。
 *    已購買者可以在效期內把網址複製給別人。真正的補救是效期要短
 *    （見 MATERIAL_URL_TTL）以及檔案可以隨時換掉。
 *
 * 用 POST 而不是 GET：GET 會被瀏覽器與中介層快取，而這個回應是
 * 「這個人現在有沒有權限」，快取下來就變成過期的授權。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function deny(message: string, status: number) {
  return NextResponse.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  const access = await checkLessonAccess(id, "lessons/materials");
  if (!access.ok) return deny(access.message, access.status);

  const admin = createServiceClient();
  if (!admin) return deny("服務暫時無法使用，請稍後再試。", 503);

  // body 也在這裡回：課程文字同樣是付費內容，跟講義走同一道門，
  // 前台就只有一個「拿這一堂內容」的入口，不必兩套判斷。
  const { data: lesson } = await admin
    .from("course_lessons")
    .select("body")
    .eq("id", id)
    .maybeSingle();

  const { data: rows, error } = await admin
    .from("lesson_materials")
    // storage_path 有查出來但**不會**進回應 —— 下面是逐欄組裝，不是整包 spread。
    // 它是私有 bucket 裡的真實路徑，回給瀏覽器等於把門牌號碼交出去。
    .select(
      "id, kind, file_name, mime_type, size_bytes, caption, sort_order, storage_path",
    )
    .eq("lesson_id", id)
    .order("kind")
    .order("sort_order");

  if (error) {
    console.error("[lessons/materials] 讀取失敗", id, error.message);
    return deny("讀取失敗，請重新整理後再試一次。", 500);
  }

  const list = rows ?? [];

  // 逐份簽。Supabase 有批次 API，但兩種 kind 的效期不同（圖片要撐著頁面、
  // 檔案只是按一下就下載），分開簽比為了省幾個往返而讓效期一致更值得。
  const materials = await Promise.all(
    list.map(async (m) => {
      const kind = m.kind as MaterialKind;
      const { data: signed } = await admin.storage
        .from(MATERIALS_BUCKET)
        .createSignedUrl(
          m.storage_path as string,
          MATERIAL_URL_TTL[kind],
          // 檔案類帶上原始檔名，瀏覽器下載下來才不是一串 uuid
          kind === "file"
            ? { download: (m.file_name as string) || "講義.pdf" }
            : undefined,
        );
      return {
        id: m.id as string,
        kind,
        fileName: m.file_name as string,
        sizeBytes: m.size_bytes as number,
        caption: (m.caption as string | null) ?? null,
        url: signed?.signedUrl ?? null,
      };
    }),
  );

  return NextResponse.json(
    {
      body: (lesson?.body as string | null) ?? null,
      // 簽不出網址的（檔案被人從 bucket 手動刪掉）直接不回，
      // 不要給前台一個點了會壞掉的按鈕。
      materials: materials.filter((m) => m.url),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

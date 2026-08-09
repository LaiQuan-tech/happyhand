import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { checkCapability } from "@/lib/admin/guard";
import { writeAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";
import {
  MEDIA_ALLOWED_FORMATS,
  MEDIA_ALLOWED_MIME,
  MEDIA_AUDIT_ENTITY,
  MEDIA_BUCKET,
  MEDIA_KIND_LABELS,
  MEDIA_MAX_BYTES,
  MEDIA_MAX_EDGE,
  MEDIA_MAX_PIXELS,
  MEDIA_WEBP_QUALITY,
  isMediaKind,
  mediaObjectPath,
  type MediaKind,
} from "@/lib/admin/media";

/**
 * 後台圖片上傳。
 *
 * media bucket 的 storage.objects **刻意沒有任何寫入 policy**
 * （見 supabase/migrations/20260810000002_media_bucket.sql），
 * 也就是說 anon / authenticated 都寫不進去，寫入只能靠 service role。
 * 所以這支 route handler 是整條上傳鏈唯一的授權關卡 —— 這裡漏掉就等於全開。
 *
 * 這是 fetch 端點不是頁面：權限不足回 **403 JSON，不 redirect**
 * （同 api/admin/sessions/[id]/roster.csv/route.ts 的理由：
 *  前端 fetch 拿到一坨登入頁 HTML 只會 JSON.parse 失敗，看不出真正的原因）。
 * 未登入的情況更早就被 middleware.ts 攔成 401 JSON。
 */

// sharp 是原生模組，只跑得動 node runtime。少了這行會被排進 edge runtime 直接爆。
export const runtime = "nodejs";
// 8MB 的圖解碼 + 縮放 + 轉檔，在冷啟動的 Vercel function 上可能要十幾秒。
export const maxDuration = 30;

/* ------------------------------------------------------------------ 錯誤 */

/**
 * 錯誤一律回中文，而且是「使用者能據此行動」的中文。
 *
 * ⚠️ 絕對不要把 sharp / supabase 的原始錯誤訊息塞進 error 欄位：
 *    一來後台使用者是好日子的員工，看到 "Input buffer contains unsupported
 *    image format" 只會截圖來問；二來那些訊息偶爾會帶出路徑之類的內部資訊。
 *    要除錯的細節走 console.error 進 Vercel log。
 */
function fail(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/* ---------------------------------------------------------------- 影像處理 */

export type ProcessedImage = {
  buffer: Buffer;
  width: number;
  height: number;
  bytes: number;
};

/** 處理失敗的原因。分開回報才有辦法給出不同的中文訊息。 */
export type ProcessFailure = "undecodable" | "format" | "toolarge";

export type ProcessResult =
  | { ok: true; image: ProcessedImage }
  | { ok: false; reason: ProcessFailure; detail?: string };

/**
 * 驗證 + 正規化一張圖。**這支是整個把關的核心**，刻意跟 HTTP 層分開，
 * 讓它可以被單獨餵資料測試（見驗收腳本）。
 *
 * ⚠️ 為什麼不能只看副檔名或 file.type：
 *    兩者都是瀏覽器依副檔名猜的，把 `report.pdf` 改名成 `report.jpg`
 *    就會得到 file.type === "image/jpeg"，MIME 檢查完全形同虛設。
 *    真正的把關是「sharp 解析得出中繼資料，而且格式在白名單內」。
 *
 * 順序也是刻意的：
 *   1. metadata() 只讀檔頭，不解碼 → 解壓縮炸彈在這裡就被擋下來，
 *      不會先吃掉 1.6GB 記憶體才發現太大。
 *   2. rotate() 依 EXIF 轉正。手機直拍的照片 EXIF Orientation=6，
 *      不轉正的話上傳完在網頁上是躺著的，而且客戶會以為是我們弄壞的。
 *   3. resize(fit: "inside", withoutEnlargement: true) 只縮不放。
 *      沒有 withoutEnlargement 的話，一張 400px 的老照片會被放大成 2000px
 *      的糊圖，檔案還變大。
 *   4. 一律轉 WebP：省流量，而且輸出格式固定就不必再擔心輸入格式的怪東西
 *      （EXIF、ICC、動畫幀、SVG 內嵌 script）被原封不動傳到前台。
 */
export async function processImage(input: Buffer): Promise<ProcessResult> {
  let meta;
  try {
    meta = await sharp(input, { limitInputPixels: MEDIA_MAX_PIXELS }).metadata();
  } catch (err) {
    // 解不開就不是圖片。改過副檔名的 PDF / ZIP / 純文字都會落在這裡。
    console.error("[admin/uploads] sharp 無法解析輸入", err);
    return { ok: false, reason: "undecodable" };
  }

  if (!meta.width || !meta.height) return { ok: false, reason: "undecodable" };

  if (!(MEDIA_ALLOWED_FORMATS as readonly string[]).includes(meta.format ?? "")) {
    // sharp 解得開 TIFF / GIF / SVG / AVIF，但那些不在 bucket 的 allowed_mime_types 裡。
    return { ok: false, reason: "format", detail: meta.format };
  }

  if (meta.width * meta.height > MEDIA_MAX_PIXELS) {
    return { ok: false, reason: "toolarge" };
  }

  try {
    const { data, info } = await sharp(input, { limitInputPixels: MEDIA_MAX_PIXELS })
      .rotate()
      .resize({
        width: MEDIA_MAX_EDGE,
        height: MEDIA_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: MEDIA_WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });

    return {
      ok: true,
      image: { buffer: data, width: info.width, height: info.height, bytes: info.size },
    };
  } catch (err) {
    console.error("[admin/uploads] sharp 轉檔失敗", err);
    return { ok: false, reason: "undecodable" };
  }
}

function messageFor(reason: ProcessFailure): string {
  switch (reason) {
    case "format":
      return "這個檔案不是 JPEG／PNG／WebP 圖片，請換一張再試。";
    case "toolarge":
      return "圖片的尺寸太大（超過 5000 萬像素），請先縮小再上傳。";
    default:
      return "圖片內容無法解析，請確認檔案沒有損毀，或換一張再試。";
  }
}

/* ------------------------------------------------------------------ POST */

export async function POST(request: Request) {
  const staff = await checkCapability("media:upload");
  if (!staff) {
    return fail("你的帳號沒有上傳圖片的權限。", 403);
  }

  let form: FormData;
  try {
    // 原生 multipart。用 base64 包 JSON 的話傳輸量會膨脹 33%，
    // 8MB 的照片變成 10.7MB，Vercel 4.5MB 的 body 上限更容易撞到。
    form = await request.formData();
  } catch (err) {
    console.error("[admin/uploads] 無法解析 multipart", err);
    return fail("上傳內容無法解析，請重新選擇檔案再試一次。", 400);
  }

  const rawKind = form.get("kind");
  if (!isMediaKind(rawKind)) {
    // kind 會直接變成 storage 路徑的第一層目錄，一定要走白名單。
    return fail("圖片用途不正確，請重新整理後再試一次。", 400);
  }
  const kind: MediaKind = rawKind;

  const file = form.get("file");
  if (!(file instanceof File)) return fail("沒有收到檔案，請重新選擇。", 400);
  if (file.size === 0) return fail("這個檔案是空的，請換一張再試。", 400);
  if (file.size > MEDIA_MAX_BYTES) {
    return fail("圖片檔案太大，單張上限 8MB，請換一張或先縮小再上傳。", 413);
  }
  if (!(MEDIA_ALLOWED_MIME as readonly string[]).includes(file.type)) {
    // 這層只是省下讀整個檔的成本；真正的把關在 processImage()。
    return fail("圖片格式需為 JPEG、PNG 或 WebP。", 400);
  }

  const result = await processImage(Buffer.from(await file.arrayBuffer()));
  if (!result.ok) {
    console.error("[admin/uploads] 圖片被拒絕", {
      reason: result.reason,
      detail: result.detail,
      declaredType: file.type,
      bytes: file.size,
    });
    return fail(messageFor(result.reason), 400);
  }
  const image = result.image;

  if (image.bytes > MEDIA_MAX_BYTES) {
    // bucket 的 file_size_limit 也是 8MB，先擋下來才給得出清楚的訊息，
    // 否則使用者只會看到一句沒頭沒尾的「上傳失敗」。
    return fail("圖片壓縮後仍然超過 8MB，請換一張再試。", 413);
  }

  let db;
  try {
    db = createServiceClient();
  } catch (err) {
    console.error("[admin/uploads] service client 建立失敗", err);
    return fail("伺服器設定不完整，請聯絡工程師。", 500);
  }

  const path = mediaObjectPath(kind, randomUUID());
  const { error } = await db.storage.from(MEDIA_BUCKET).upload(path, image.buffer, {
    contentType: "image/webp",
    // uuid 檔名不可能撞，upsert:false 讓「萬一撞到」變成錯誤而不是靜默覆蓋別人的圖。
    upsert: false,
  });
  if (error) {
    console.error("[admin/uploads] storage 上傳失敗", error);
    return fail("圖片上傳失敗，請稍後再試一次。", 502);
  }

  const { data: pub } = db.storage.from(MEDIA_BUCKET).getPublicUrl(path);

  // 稽核在回應之前寫。writeAudit() 永不 throw，所以稽核掛了不影響上傳結果。
  await writeAudit(staff, {
    action: "media.upload",
    entity: MEDIA_AUDIT_ENTITY,
    entityId: path,
    summary: `上傳${MEDIA_KIND_LABELS[kind]}圖片 ${path}（${image.width}×${image.height}）`,
    diff: {
      kind,
      path,
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      // 原始檔名只是給人回想「我傳的是哪張」，截短避免有人用超長檔名塞爆稽核表。
      originalName: file.name.slice(0, 120),
      originalBytes: file.size,
    },
  });

  return NextResponse.json({
    url: pub.publicUrl,
    width: image.width,
    height: image.height,
    bytes: image.bytes,
  });
}

/**
 * 單元講義與插圖的共用設定。
 *
 * ⚠️ bucket 名稱一旦有檔案就不能改：lesson_materials.storage_path 存的是
 *    bucket 內的相對路徑。這裡是唯一真相（migration 20260828000001 有對照註解）。
 *
 * 這支刻意不 import 任何 server-only 的東西 —— 後台的 client 元件也要用
 * MATERIAL_MAX_BYTES 之類的常數來做上傳前的檢查。
 */

/** 🔴 私有 bucket，跟公開的 media 完全不同。講義是賣出去的東西。 */
export const MATERIALS_BUCKET = "course-materials";

export const MATERIAL_KINDS = ["file", "image"] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

export const MATERIAL_KIND_LABELS: Record<MaterialKind, string> = {
  file: "課程文件",
  image: "課程圖片",
};

export function isMaterialKind(v: unknown): v is MaterialKind {
  return typeof v === "string" && (MATERIAL_KINDS as readonly string[]).includes(v);
}

/** 與 bucket 的 file_size_limit 同一個值（20MB）。兩邊都擋，錯誤訊息才會是中文。 */
export const MATERIAL_MAX_BYTES = 20 * 1024 * 1024;

/**
 * 與 bucket 的 allowed_mime_types 同一組值。
 *
 * 刻意**不收** Word／PowerPoint：那些格式可以帶巨集，而這個 bucket 的檔案
 * 會直接發簽章網址給學員下載。要給 Word 就先另存成 PDF。
 */
export const MATERIAL_MIME: Record<MaterialKind, readonly string[]> = {
  file: ["application/pdf"],
  image: ["image/jpeg", "image/png", "image/webp"],
};

export const MATERIAL_ACCEPT: Record<MaterialKind, string> = {
  file: ".pdf",
  image: ".jpg,.jpeg,.png,.webp",
};

/** 一堂課最多幾份。防呆用，不是硬性業務規則。 */
export const MATERIAL_MAX_PER_LESSON = 20;

/**
 * 簽章網址的效期。
 *
 * image 給 1 小時：插圖是渲染在頁面上的，學員把分頁擱著一小時再回來看，
 *   網址過期就變破圖。
 * file 給 5 分鐘：那是「按下去就開始下載」的一次性動作，
 *   效期短一點，萬一連結被轉貼出去也很快失效。
 */
export const MATERIAL_URL_TTL: Record<MaterialKind, number> = {
  image: 3600,
  file: 300,
};

/**
 * bucket 內的物件路徑。
 *
 * 用 uuid 當檔名而不是原始檔名：避開路徑穿越（../）、中文與空白在 URL 的
 * 轉義問題，以及「兩個人上傳同名檔案互相覆蓋」。
 * 給學員看的檔名存在 lesson_materials.file_name。
 */
export function materialObjectPath(
  lessonId: string,
  id: string,
  ext: string,
): string {
  return `lessons/${lessonId}/${id}.${ext}`;
}

export function extForMime(mime: string): string {
  switch (mime) {
    case "application/pdf":
      return "pdf";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "jpg";
  }
}

/** 給人看的檔案大小。後台清單用。 */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

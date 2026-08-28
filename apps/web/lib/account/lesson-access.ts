import "server-only";

import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

/**
 * 「這個人現在能不能看這一堂」的唯一判斷。
 *
 * 🔴 抽出來共用是刻意的。影片端點原本把這段寫在自己裡面，而它的註解已經
 *    指出風險：「另外開一支公開的 endpoint 就會變成第二個要維護的權限邊界」。
 *    現在講義與插圖也要同一道牆，複製第二份判斷 = 兩邊遲早漂移，
 *    而漂移的方向永遠是「有一邊變寬」。
 *
 * 判斷內容（順序有意義）：
 *   1. 讀得到這一列嗎 —— course_lessons 的 RLS 只給「已上架的課」或
 *      「自己買過的課」，所以連讀得到本身就是一道檢查
 *   2. free_preview 直接放行
 *   3. 沒登入 → 401（訊息要說「登入就可以」，不是冷冰冰的 403）
 *   4. entitlements_select_own 這條 RLS 本身就是授權檢查：查得到那一列，
 *      就代表這是他自己的權限，不需要在這裡比對 user_id
 *   5. 有期限就檢查期限
 */

export type LessonAccess =
  | {
      ok: true;
      lesson: { id: string; product_id: string; duration_sec: number | null };
      /** 已登入的使用者 id；免費試看的訪客是 null */
      userId: string | null;
    }
  | { ok: false; message: string; status: number };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function checkLessonAccess(
  id: string,
  logTag: string,
): Promise<LessonAccess> {
  if (!UUID_RE.test(id)) {
    return { ok: false, message: "找不到這個單元。", status: 404 };
  }
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      message: "服務暫時無法使用，請稍後再試。",
      status: 503,
    };
  }

  const supabase = await createClient();

  // ⚠️ 不能 select("*") —— youtube_id 沒有 grant 給 authenticated，
  //    帶 * 會讓整個查詢 42501。
  const { data: lesson, error: lessonError } = await supabase
    .from("course_lessons")
    .select("id, product_id, free_preview, duration_sec")
    .eq("id", id)
    .maybeSingle();

  if (lessonError) {
    console.error(`[${logTag}] 讀取單元失敗`, id, lessonError.message);
    return {
      ok: false,
      message: "讀取失敗，請重新整理後再試一次。",
      status: 500,
    };
  }
  if (!lesson) return { ok: false, message: "找不到這個單元。", status: 404 };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const shaped = {
    id: lesson.id as string,
    product_id: lesson.product_id as string,
    duration_sec: (lesson.duration_sec as number | null) ?? null,
  };

  if (lesson.free_preview === true) {
    return { ok: true, lesson: shaped, userId: user?.id ?? null };
  }

  if (!user) {
    return {
      ok: false,
      message: "這一堂要買了課才看得到。登入之後就可以繼續。",
      status: 401,
    };
  }

  const { data: entitlement, error: entError } = await supabase
    .from("entitlements")
    .select("expires_at")
    .eq("product_id", shaped.product_id)
    .maybeSingle();

  if (entError) {
    console.error(`[${logTag}] 讀取權限失敗`, id, entError.message);
    return {
      ok: false,
      message: "讀取失敗，請重新整理後再試一次。",
      status: 500,
    };
  }
  if (!entitlement) {
    return { ok: false, message: "這一堂要買了課才看得到。", status: 403 };
  }

  const expiresAt = entitlement.expires_at as string | null;
  if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
    return {
      ok: false,
      message: "這門課的觀看期限已經到了。想繼續看的話用 LINE 跟我們說一聲。",
      status: 403,
    };
  }

  return { ok: true, lesson: shaped, userId: user.id };
}

import { NextResponse } from "next/server";
import { createClient, createServiceClient, hasSupabaseEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/lessons/[id]/video — 驗證權限後才回傳 YouTube 影片 ID
 *
 * 🔑 **這一支就是 entitlement 的執行點。** 它不是「額外的一層保護」，
 *    而是整個付費牆唯一真正生效的地方 —— 教室頁的 RSC 刻意不把 youtube_id
 *    帶下來（那會讓 12 堂課的 ID 一次全進 RSC payload，等於寫在 HTML 裡）。
 *
 * ⚠️ 對「內容保護」要誠實：這支擋得住**沒買的人**，擋不住**買了的人**。
 *    ID 一定要送到瀏覽器才能播，所以已購買者按 F12 讀 iframe 的 src、
 *    或在播放器上右鍵複製網址，就能拿到 ID 並用 yt-dlp 下載整支影片
 *    （unlisted 不需要登入）。這在架構上無解，換 Vimeo 或簽名 URL 也一樣
 *    （同一個人照樣可以螢幕錄影）。
 *    真正的補救手段是「影片 ID 可以隨時換」——外流後重新上傳一支 unlisted、
 *    在後台改 youtube_id，舊連結就變孤兒。
 *
 * 用 POST 而不是 GET：GET 會被瀏覽器與中介層快取，而這個回應是
 * 「這個人現在有沒有權限」，快取下來就變成過期的授權。
 */

type Params = { params: Promise<{ id: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 統一的回應。403 一律不帶 videoId —— 這是最重要的一條。 */
function deny(message: string, status: number) {
  return NextResponse.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    return deny("找不到這個單元。", 404);
  }
  if (!hasSupabaseEnv()) {
    return deny("影片服務暫時無法使用，請稍後再試。", 503);
  }

  const supabase = await createClient();

  // 1) 這一堂是哪一門課的、是不是免費試看
  //
  // 用使用者自己的 session client：course_lessons 的 RLS 只給
  // 「已上架的課」或「自己買過的課」，所以連讀得到這一列本身就是一道檢查。
  // ⚠️ 這裡不能 select("*") —— youtube_id 沒有 grant 給 authenticated，
  //    帶 * 會整個查詢 42501。
  const { data: lesson, error: lessonError } = await supabase
    .from("course_lessons")
    .select("id, product_id, free_preview, duration_sec")
    .eq("id", id)
    .maybeSingle();

  if (lessonError) {
    console.error("[lessons/video] 讀取單元失敗", id, lessonError.message);
    return deny("讀取失敗，請重新整理後再試一次。", 500);
  }
  if (!lesson) {
    return deny("找不到這個單元。", 404);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 2) 授權判斷。free_preview 走同一條程式路徑，只是條件不同 ——
  //    另外開一支公開的 endpoint 就會變成第二個要維護的權限邊界。
  let allowed = lesson.free_preview === true;

  if (!allowed) {
    if (!user) {
      return deny("這一堂要買了課才看得到。登入之後就可以繼續。", 401);
    }

    // entitlements_select_own 這條 RLS 本身就是授權檢查：
    // 查得到那一列，就代表這是他自己的權限。不需要在這裡比對 user_id。
    const { data: entitlement, error: entError } = await supabase
      .from("entitlements")
      .select("expires_at")
      .eq("product_id", lesson.product_id)
      .maybeSingle();

    if (entError) {
      console.error("[lessons/video] 讀取權限失敗", id, entError.message);
      return deny("讀取失敗，請重新整理後再試一次。", 500);
    }
    if (!entitlement) {
      return deny("這一堂要買了課才看得到。", 403);
    }

    const expiresAt = entitlement.expires_at as string | null;
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return deny(
        "這門課的觀看期限已經到了。想繼續看的話用 LINE 跟我們說一聲。",
        403,
      );
    }
    allowed = true;
  }

  if (!allowed) return deny("這一堂要買了課才看得到。", 403);

  // 3) 到這裡才拿 ID。youtube_id 只有 service role 讀得到（欄位級 grant）。
  let videoId: string | null = null;
  try {
    const admin = createServiceClient();
    const { data, error } = await admin
      .from("course_lessons")
      .select("youtube_id")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[lessons/video] 讀取影片 ID 失敗", id, error.message);
      return deny("讀取失敗，請重新整理後再試一次。", 500);
    }
    videoId = (data?.youtube_id as string | null) ?? null;
  } catch (err) {
    console.error("[lessons/video] service client 失敗", err);
    return deny("影片服務暫時無法使用，請稍後再試。", 503);
  }

  if (!videoId) {
    // 有權限但還沒上片。這是內容還沒準備好，不是權限問題，要講清楚，
    // 不然客人會以為自己買的東西壞了。
    return deny("這一堂的影片還在準備中，好了我們會用 LINE 通知你。", 404);
  }

  // 4) 上次看到哪裡（用來做「從上次的 12:34 繼續看」）
  let resumeAt = 0;
  if (user) {
    const { data: progress } = await supabase
      .from("lesson_progress")
      .select("position_sec")
      .eq("lesson_id", id)
      .maybeSingle();
    resumeAt = (progress?.position_sec as number | null) ?? 0;
  }

  return NextResponse.json(
    {
      videoId,
      resumeAt,
      durationSec: (lesson.duration_sec as number | null) ?? null,
    },
    // no-store 是必要的：這個回應等於一張門票，被任何中介層快取下來
    // 就變成「別人也拿得到」。
    { headers: { "Cache-Control": "no-store" } },
  );
}

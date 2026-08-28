import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkLessonAccess } from "@/lib/account/lesson-access";
import { createClient } from "@/lib/supabase/server";

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

/** 統一的回應。403 一律不帶 videoId —— 這是最重要的一條。 */
function deny(message: string, status: number) {
  return NextResponse.json(
    { message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;

  // 授權判斷抽到 lib/account/lesson-access.ts —— 講義端點用的是同一支。
  // 兩邊各寫一份的話遲早漂移，而漂移的方向永遠是「有一邊變寬」。
  const access = await checkLessonAccess(id, "lessons/video");
  if (!access.ok) return deny(access.message, access.status);
  const { lesson, userId } = access;

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
  if (userId) {
    const supabase = await createClient();
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

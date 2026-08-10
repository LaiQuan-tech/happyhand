import { NextResponse } from "next/server";
import { createClient, hasSupabaseEnv } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/progress — 記錄「這一堂看到第幾秒」
 *
 * 為什麼是 route handler 而不是 server action：
 * server action 每次呼叫都會觸發 RSC re-render，而這支每 20 秒就會被打一次，
 * 那太浪費了。而且 sendBeacon 只能打一般的 endpoint。
 *
 * 為什麼不讓瀏覽器直接寫 PostgREST：
 * lesson_progress 的 RLS 確實允許（select/insert/update own 三條都有），
 * 但那樣「看完幾成算完成」的規則就住在 client，改一次規則要改兩個地方，
 * 而且沒辦法把 position_sec 夾在合理範圍內。
 *
 * 用 session client 走 RLS，不需要 service role ——
 * lesson_progress_insert_own / _update_own 保證他只寫得到自己那一列。
 *
 * ⚠️ 這支要吃兩種 body：
 *    ・一般的 fetch（Content-Type: application/json）
 *    ・navigator.sendBeacon 送的 Blob（離開頁面時的保底寫入）
 *    sendBeacon 不能設自訂 header，但**會帶同源 cookie**，所以身分讀得到。
 *    request.json() 對兩者都能解析，不要依賴 Content-Type 判斷。
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 看到這個比例就算完成。YouTube 的片尾通常有幾秒空白，要求 100% 太苛。 */
const COMPLETE_RATIO = 0.9;

/** position_sec 的上限。防止壞掉的 client 送進一個荒謬的數字。 */
const MAX_POSITION = 24 * 60 * 60;

export async function POST(request: Request) {
  // 這支的回應一律是 204／簡短錯誤，內容不重要 ——
  // 它是背景寫入，前端不會（也不該）拿它的回應做任何事。
  if (!hasSupabaseEnv()) return new NextResponse(null, { status: 204 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const lessonId = String(body.lessonId ?? "");
  if (!UUID_RE.test(lessonId)) return new NextResponse(null, { status: 400 });

  const rawPosition = Number(body.positionSec);
  const rawDuration = Number(body.durationSec);
  const ended = body.ended === true;

  if (!Number.isFinite(rawPosition) || rawPosition < 0) {
    return new NextResponse(null, { status: 400 });
  }

  const duration =
    Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;

  // 夾在 [0, duration] 內。超過影片長度的位置回放時會直接跳到結尾，
  // 看起來像「明明沒看完卻從最後開始」。
  const position = Math.min(
    Math.round(rawPosition),
    duration ? Math.round(duration) : MAX_POSITION,
    MAX_POSITION,
  );

  // 完成判定放在 server：規則只有一份。
  // duration 用 client 傳來的 player.getDuration()，不是 course_lessons.duration_sec
  // ——後者是員工手打的，常常空的或錯的。
  const completedNow =
    ended || (duration !== null && position >= duration * COMPLETE_RATIO);

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return new NextResponse(null, { status: 401 });

    // 讀一次舊值，只為了「completed 一旦為 true 就不再變回 false」。
    // 重看一次不該把已完成的打勾拿掉。
    const { data: existing } = await supabase
      .from("lesson_progress")
      .select("completed")
      .eq("lesson_id", lessonId)
      .maybeSingle();

    const { error } = await supabase.from("lesson_progress").upsert(
      {
        user_id: user.id,
        lesson_id: lessonId,
        position_sec: position,
        completed: (existing?.completed as boolean | undefined) || completedNow,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,lesson_id" },
    );

    if (error) {
      // 只記 message：error.details 在 Postgres 的錯誤裡會帶整列內容。
      console.error("[progress] 寫入失敗", lessonId, error.message);
      return new NextResponse(null, { status: 500 });
    }
  } catch (err) {
    console.error("[progress] 例外", err);
    return new NextResponse(null, { status: 500 });
  }

  return new NextResponse(null, { status: 204 });
}

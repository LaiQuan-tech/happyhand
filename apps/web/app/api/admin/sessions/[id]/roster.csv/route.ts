import { NextResponse } from "next/server";
import { checkCapability } from "@/lib/admin/guard";
import { writeAudit } from "@/lib/admin/audit";
import { CSV_CONTENT_TYPE, csvContentDisposition, toCsv } from "@/lib/admin/csv";
import { createServiceClient } from "@/lib/supabase/server";
import { formatTaipei } from "@/components/admin/datetime-field";
import { loadRoster, loadSessionDetail, rosterHeadcount } from "@/app/admin/sessions/queries";
import { ROSTER_CSV_COLUMNS, rosterFilename } from "@/app/admin/sessions/roster-csv";

/**
 * 報名名單 CSV 匯出。
 *
 * 這是 fetch / 下載端點，不是頁面：權限不足一律回 403 JSON，**不 redirect**。
 * 導轉到登入頁的話瀏覽器會把那頁 HTML 存成一個叫 roster.csv 的檔案，
 * 員工打開看到一堆 <!DOCTYPE html> 卻不知道自己其實是沒權限。
 * （未登入的情況更早就被 middleware.ts 攔成 401 JSON。）
 *
 * ⚠️ 這支是個資出口：一次把姓名、電話、Email 全部帶離系統。
 *    所以 (1) 要 roster:export 這個能力，(2) 成功匯出一定 writeAudit，
 *    出事時查得到「誰、什麼時候、匯了哪一場、幾筆」。
 */

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // Next 15：params 是 Promise，一定要 await。
  const { id } = await params;

  const staff = await checkCapability("roster:export");
  if (!staff) {
    return NextResponse.json(
      { error: "你的帳號沒有匯出報名名單的權限。" },
      { status: 403 },
    );
  }

  let db;
  try {
    db = createServiceClient();
  } catch (err) {
    console.error("[admin/sessions] CSV service client 建立失敗", err);
    return NextResponse.json({ error: "伺服器設定不完整，請聯絡工程師。" }, { status: 500 });
  }

  const session = await loadSessionDetail(db, id);
  if (!session) {
    return NextResponse.json({ error: "找不到這個場次。" }, { status: 404 });
  }

  const { rows, error } = await loadRoster(db, id);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }

  const csv = toCsv(rows, ROSTER_CSV_COLUMNS);
  const filename = rosterFilename(session.productTitle, session.startsAt);
  const headcount = rosterHeadcount(rows);

  // 稽核在回應之前寫。writeAudit() 永不 throw，
  // 所以就算稽核掛了員工還是拿得到檔案（但 log 會留下 console.error）。
  await writeAudit(staff, {
    action: "roster.export",
    entity: "session",
    entityId: id,
    summary: `匯出報名名單：${session.productTitle} ${formatTaipei(session.startsAt)}（${rows.length} 筆 / ${headcount} 人）`,
    diff: { rows: rows.length, headcount, filename },
  });

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": CSV_CONTENT_TYPE,
      "Content-Disposition": csvContentDisposition(filename),
      // 名單隨時在變，而且內容是個資，不該被任何一層快取留下來。
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

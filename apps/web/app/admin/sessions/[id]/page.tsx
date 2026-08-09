import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, adminErrorMessage, AdminAuthError } from "@/lib/admin/guard";
import { can } from "@/lib/admin/roles";
import { createServiceClient } from "@/lib/supabase/server";
import { DataList } from "@/components/admin/data-list";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { formatTaipei } from "@/components/admin/datetime-field";
import { WaitlistPanel } from "@/components/admin/waitlist-panel";
import { adjustSeats, setSessionStatus } from "../actions";
import {
  loadRoster,
  loadSessionDetail,
  loadWaitlist,
  rosterHeadcount,
  SESSION_STATUS_LABEL,
  type SessionDetail,
  type SessionStatus,
} from "../queries";
import { allowedSessionTargets } from "../transitions";
import {
  Callout,
  LoadError,
  PermissionDenied,
  SeatMismatchNote,
  SessionStatusChip,
} from "../ui";

/**
 * 單場明細：報名名單 + 候補 + 名額與狀態調整。
 *
 * 這頁是開課當天真的會被打開的那一頁 —— 講師拿平板核對誰到了，
 * 客服在電話上查某個人有沒有報到名。所以：
 *   - 報名名單放在最上面（最常看的東西不該要捲）
 *   - 電話直接是 tel: 連結，手機上點了就撥
 *   - 破壞性的操作（關閉報名、取消場次）放在最下面
 */

export const dynamic = "force-dynamic";

export default async function AdminSessionDetailPage({
  params,
  searchParams,
}: {
  // Next 15：params 與 searchParams 都是 Promise
  params: Promise<{ id: string }>;
  searchParams: Promise<{ wl?: string }>;
}) {
  let staff;
  try {
    staff = await requireCapability("orders:read");
  } catch (err) {
    if (err instanceof AdminAuthError) return <PermissionDenied message={adminErrorMessage(err)} />;
    throw err;
  }

  const [{ id }, query] = await Promise.all([params, searchParams]);

  let db;
  try {
    db = createServiceClient();
  } catch (err) {
    console.error("[admin/sessions] service client 建立失敗", err);
    return <LoadError message="資料庫連線未設定，請檢查伺服器環境變數。" />;
  }

  const session = await loadSessionDetail(db, id);
  // 網址列亂打、或場次被別的同事刪掉了 —— 兩種都是 404，不是 500。
  if (!session) notFound();

  const [roster, waitlist] = await Promise.all([loadRoster(db, id), loadWaitlist(db, id)]);

  const canExport = can(staff.role, "roster:export");
  const canManageSeats = can(staff.role, "sessions:status");
  const canWaitlist = can(staff.role, "waitlist:write");

  const headcount = rosterHeadcount(roster.rows);
  const mismatch = headcount !== session.seatsTaken;

  return (
    <div className="flex flex-col gap-6">
      <SessionHeader session={session} />

      {/* ---------------------------------------------------------- 人數 */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[16px] font-medium text-ink">人數</h2>
        <div className="grid grid-cols-1 gap-3 admin:grid-cols-3">
          <Stat
            label="已付款報名"
            value={`${headcount} 人`}
            note={`${roster.rows.length} 筆訂單，由實際訂單即時計算`}
            emphasis={mismatch}
          />
          <Stat
            label="系統名額"
            value={`${session.seatsTaken} / ${session.capacity}`}
            note={
              session.seatsTaken >= session.capacity
                ? "已滿，前台不能再報名"
                : `前台還可以報名 ${session.capacity - session.seatsTaken} 個位子`
            }
          />
          <Stat
            label="候補待處理"
            value={`${waitlist.rows.filter((row) => row.status === "waiting").length} 人`}
            note={`候補名單共 ${waitlist.rows.length} 筆`}
          />
        </div>

        {mismatch && (
          <Callout tone="warn" title="這兩個數字目前對不起來">
            <SeatMismatchNote />
          </Callout>
        )}
      </section>

      {/* ------------------------------------------------------ 報名名單 */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[16px] font-medium text-ink">報名名單</h2>
          {canExport && roster.rows.length > 0 && (
            // 一般的 <a>，不是 <Link>：這是檔案下載，不該走 client 端路由。
            // download 屬性刻意不加 —— 檔名由 Content-Disposition 決定，
            // 加了反而會被瀏覽器用網址最後一段（roster.csv）蓋掉中文檔名。
            <a
              href={`/api/admin/sessions/${session.id}/roster.csv`}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-input border border-line-input bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-panel admin:min-h-10"
            >
              匯出報名名單 CSV
            </a>
          )}
        </div>

        {roster.error ? (
          <LoadError message={roster.error} />
        ) : (
          <DataList
            items={roster.rows}
            keyOf={(row) => row.itemId}
            caption="這一場已付款的報名者"
            empty={
              <>
                目前沒有已付款的報名者。
                <span className="mt-1 block text-[13px]">
                  未付款（待匯款）與已取消的訂單不會出現在這裡 ——
                  簽到表只放真的會來的人。
                </span>
              </>
            }
            columns={[
              { header: "姓名", primary: true, cell: (row) => row.name ?? "（未填姓名）" },
              {
                header: "人數",
                trailing: true,
                align: "right",
                cell: (row) => (
                  <span className={row.qty > 1 ? "font-medium text-accent-ink" : undefined}>
                    {row.qty} 人
                  </span>
                ),
              },
              { header: "電話", cell: (row) => <PhoneLink phone={row.phone} /> },
              {
                header: "Email",
                cell: (row) =>
                  row.email ? <span className="break-all">{row.email}</span> : "—",
              },
              {
                header: "訂單編號",
                cell: (row) => <span className="break-all">{row.orderNo}</span>,
              },
              { header: "付款時間", cell: (row) => formatTaipei(row.paidAt) || "—" },
              {
                header: "備註",
                desktopOnly: true,
                cell: (row) =>
                  row.note ? <span className="break-words">{row.note}</span> : "—",
              },
            ]}
          />
        )}
      </section>

      {/* ---------------------------------------------------------- 候補 */}
      <WaitlistPanel
        sessionId={session.id}
        entries={waitlist.rows}
        error={waitlist.error}
        canWrite={canWaitlist}
        notice={query.wl}
      />

      {/* ------------------------------------------------------ 名額調整 */}
      {canManageSeats && <SeatControls session={session} />}
      {canManageSeats && <StatusControls session={session} />}
    </div>
  );
}

/* ------------------------------------------------------------------ 版面 */

function SessionHeader({ session }: { session: SessionDetail }) {
  return (
    <div>
      <Link href="/admin/sessions" className="text-[13px] text-accent-ink hover:underline">
        ← 回場次列表
      </Link>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-serif text-[24px] leading-tight font-medium break-words text-ink">
          {session.productTitle}
        </h1>
        <SessionStatusChip status={session.status} />
      </div>
      <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
        <dt className="text-ink-soft">時間</dt>
        <dd className="min-w-0 break-words text-ink">
          {formatTaipei(session.startsAt)} – {formatTaipei(session.endsAt)}
        </dd>
        <dt className="text-ink-soft">地點</dt>
        <dd className="min-w-0 break-words text-ink">{session.location ?? "—"}</dd>
        {session.address && (
          <>
            <dt className="text-ink-soft">地址</dt>
            <dd className="min-w-0 break-words text-ink">{session.address}</dd>
          </>
        )}
      </dl>
    </div>
  );
}

/**
 * 電話做成 tel: 連結。客服在手機上點一下就撥出去，不用手抄。
 * 沒有電話的訂單顯示破折號而不是空白，空白會讓人以為是排版壞了。
 */
function PhoneLink({ phone }: { phone: string | null }) {
  if (!phone) return <>—</>;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="break-all hover:text-accent-ink hover:underline">
      {phone}
    </a>
  );
}

function Stat({
  label,
  value,
  note,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-card border p-4 ${emphasis ? "border-accent bg-panel" : "border-line bg-paper"}`}
    >
      <div className="text-[13px] text-ink-soft">{label}</div>
      <div className="mt-1.5 font-serif text-[24px] leading-none font-medium text-ink">{value}</div>
      {note && <div className="mt-1.5 text-[12px] leading-snug text-ink-soft">{note}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- 操作區 */

function SeatControls({ session }: { session: SessionDetail }) {
  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-line bg-panel px-4 py-3.5">
      <h2 className="text-[16px] font-medium text-ink">微調系統名額</h2>
      <p className="text-[13px] leading-relaxed text-ink-soft">
        目前 <span className="font-medium text-ink">{session.seatsTaken} / {session.capacity}</span>。
        這個數字決定前台還能不能報名，改動不會影響上面的報名名單。
        現場臨時多收一位、或有人取消時用它補回來。
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <ConfirmButton
          action={adjustSeats.bind(null, session.id, 1)}
          confirmText={`確定把已佔名額 +1 嗎？（${session.seatsTaken} → ${Math.min(session.seatsTaken + 1, session.capacity)}）\n前台可報名的位子會少一個。`}
        >
          ＋1 位
        </ConfirmButton>
        <ConfirmButton
          action={adjustSeats.bind(null, session.id, -1)}
          confirmText={`確定把已佔名額 −1 嗎？（${session.seatsTaken} → ${Math.max(session.seatsTaken - 1, 0)}）\n前台可報名的位子會多一個。`}
        >
          −1 位
        </ConfirmButton>
      </div>
    </section>
  );
}

/** 按鈕文字寫「會發生什麼」，不是狀態代號 —— 使用者要決定的是後果不是名詞。 */
const STATUS_ACTION_LABEL: Record<SessionStatus, string> = {
  open: "重新開放報名",
  full: "（由系統自動判定）",
  closed: "關閉報名",
  cancelled: "取消整場",
};

function statusConfirmText(session: SessionDetail, target: SessionStatus): string {
  switch (target) {
    case "open":
      return `確定重新開放「${session.productTitle}」這一場的報名嗎？\n前台會再次出現報名按鈕。若名額已滿，系統會自動顯示為已額滿。`;
    case "closed":
      return `確定關閉這一場的報名嗎？\n前台會停止收件，已經報名的人不受影響。`;
    case "cancelled":
      return `確定取消整場「${session.productTitle}」嗎？\n這代表這場課不辦了。已報名的人需要你另外通知與退款，系統不會自動處理。`;
    default:
      return `確定改成「${SESSION_STATUS_LABEL[target]}」嗎？`;
  }
}

function StatusControls({ session }: { session: SessionDetail }) {
  const targets = allowedSessionTargets(session.status);

  return (
    <section className="flex flex-col gap-2.5 rounded-card border border-line bg-panel px-4 py-3.5">
      <h2 className="text-[16px] font-medium text-ink">開關報名</h2>
      <p className="text-[13px] leading-relaxed text-ink-soft">
        目前狀態：<span className="font-medium text-ink">{SESSION_STATUS_LABEL[session.status]}</span>。
        「已額滿」由系統依名額自動判定，不能手動設定；「已關閉報名」與「已取消」是人工決定，系統不會自己改回來。
      </p>
      {targets.length === 0 ? (
        <p className="text-[13px] text-ink-soft">這個狀態沒有可以執行的操作。</p>
      ) : (
        <div className="flex flex-wrap items-start gap-2">
          {targets.map((target) => (
            <ConfirmButton
              key={target}
              action={setSessionStatus.bind(null, session.id, target)}
              confirmText={statusConfirmText(session, target)}
              variant={target === "cancelled" ? "danger" : "default"}
            >
              {STATUS_ACTION_LABEL[target]}
            </ConfirmButton>
          ))}
        </div>
      )}
    </section>
  );
}

import { requireCapability, adminErrorMessage, AdminAuthError } from "@/lib/admin/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { DataList } from "@/components/admin/data-list";
import { AdminCheckbox } from "@/components/admin/admin-field";
import { formatTaipei } from "@/components/admin/datetime-field";
import { loadSessionList, type SessionListRow } from "./queries";
import {
  Callout,
  LoadError,
  PermissionDenied,
  SeatMismatchNote,
  SessionStatusChip,
} from "./ui";

/**
 * 場次報名總覽。
 *
 * 以「場次」為軸而不是以訂單為軸：客服接到的電話是
 * 「我想問 9/12 那場還有沒有位子」，不是「我想查 HH-20260912-0007」。
 *
 * ⚠️ 這頁最重要的一件事是**同時**顯示兩個人數並在它們打架時說出來。
 *    見下方 loadSessionList() 與 SeatMismatchNote。
 */

export const dynamic = "force-dynamic";

export default async function AdminSessionsPage({
  searchParams,
}: {
  // Next 15：searchParams 是 Promise
  searchParams: Promise<{ past?: string }>;
}) {
  // 頁面層的授權。layout 只擋「不是員工」，擋不了「是員工但沒有 orders:read」
  // ——內容編輯（editor）就屬於後者，他不該看到客人的姓名電話。
  let staff;
  try {
    staff = await requireCapability("orders:read");
  } catch (err) {
    if (err instanceof AdminAuthError) {
      // 這裡不 redirect：把人丟回總覽而不說原因，他只會再點一次。
      return <PermissionDenied message={adminErrorMessage(err)} />;
    }
    throw err;
  }

  const params = await searchParams;
  // 沒勾的 checkbox 不會出現在 query string，所以「有這個參數」就等於「要看已結束的」。
  const includePast = params.past === "on";

  let db = null;
  try {
    db = createServiceClient();
  } catch (err) {
    console.error("[admin/sessions] service client 建立失敗", err);
  }

  const { rows, error } = await loadSessionList(db, { includePast });
  const mismatched = rows.filter((row) => row.paidHeadcount !== row.seatsTaken);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-[24px] leading-tight font-medium text-ink">場次報名</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          {includePast ? "所有場次" : "尚未結束的場次"}，共 {rows.length} 場。
          點進場次可以看報名名單、候補與名額調整。
        </p>
        <p className="sr-only">
          你好，{staff.email ?? "同事"}。
        </p>
      </div>

      {/*
        純 HTML 的 GET 表單，沒有 JavaScript 也能切換。
        用 <form method="get"> 而不是兩個 <Link>：切換條件之後未來要再加
        「只看有候補的」之類的條件時，表單天生就能組合多個參數。
      */}
      <form
        method="get"
        className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-line bg-panel px-4 py-2"
      >
        <AdminCheckbox
          name="past"
          label="顯示已結束的場次"
          defaultChecked={includePast}
          wrapperClassName="min-w-0"
        />
        <button
          type="submit"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-input border border-line-input bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-panel admin:min-h-10"
        >
          套用
        </button>
      </form>

      {mismatched.length > 0 && (
        <Callout tone="warn" title={`有 ${mismatched.length} 場的名額數字與實際報名對不起來`}>
          <SeatMismatchNote />
        </Callout>
      )}

      {error ? (
        <LoadError message={error} />
      ) : (
        <DataList
          items={rows}
          keyOf={(row) => row.id}
          href={(row) => `/admin/sessions/${row.id}`}
          caption="工作坊場次、實際報名人數與候補狀況"
          empty={
            includePast
              ? "資料庫裡沒有任何場次。"
              : "目前沒有尚未結束的場次。勾選「顯示已結束的場次」可以看過去的紀錄。"
          }
          columns={[
            { header: "課程", primary: true, cell: (row) => row.productTitle },
            {
              header: "狀態",
              trailing: true,
              cell: (row) => <SessionStatusChip status={row.status} />,
            },
            { header: "開始時間", cell: (row) => formatTaipei(row.startsAt) },
            { header: "地點", cell: (row) => row.location ?? "—" },
            {
              header: "已付款報名",
              align: "right",
              cell: (row) => <PaidCount row={row} />,
            },
            {
              header: "系統名額",
              align: "right",
              cell: (row) => (
                <span className={row.seatsTaken >= row.capacity ? "text-accent-ink" : undefined}>
                  {row.seatsTaken} / {row.capacity}
                </span>
              ),
            },
            {
              header: "候補待處理",
              align: "right",
              cell: (row) =>
                row.waitingCount > 0 ? (
                  <span className="font-medium text-accent-ink">{row.waitingCount} 人</span>
                ) : (
                  <span className="text-ink-soft">—</span>
                ),
            },
          ]}
        />
      )}
    </div>
  );
}

/**
 * 實際報名人數。與 seats_taken 不一致時標一個記號 —— 兩個數字都要看得到，
 * 只顯示其中一個會讓另一個悄悄地錯下去。
 */
function PaidCount({ row }: { row: SessionListRow }) {
  const mismatch = row.paidHeadcount !== row.seatsTaken;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={mismatch ? "font-medium text-ink" : undefined}>{row.paidHeadcount} 人</span>
      {mismatch && (
        <>
          <span aria-hidden="true" className="text-accent-ink">
            ⚠
          </span>
          <span className="sr-only">與系統名額不一致</span>
        </>
      )}
    </span>
  );
}

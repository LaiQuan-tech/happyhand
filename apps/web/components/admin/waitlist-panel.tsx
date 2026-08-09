import { DataList } from "@/components/admin/data-list";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { AdminField, AdminTextarea } from "@/components/admin/admin-field";
import { formatTaipei } from "@/components/admin/datetime-field";
import { addWaitlistEntry, setWaitlistStatus } from "@/app/admin/sessions/actions";
import {
  WAITLIST_STATUS_LABEL,
  type WaitlistEntry,
  type WaitlistStatus,
} from "@/app/admin/sessions/queries";
import { allowedWaitlistTargets } from "@/app/admin/sessions/transitions";
import { LoadError, WaitlistStatusChip } from "@/app/admin/sessions/ui";

/**
 * 候補名單面板。
 *
 * 這是客服「收到訊息後手動登記」用的，不是使用者自助排隊 ——
 * 前台額滿時的 CTA 是開 LINE（app/(storefront)/workshops/_components/session-row.tsx），
 * 客群 60–75 歲，用 LINE 講比填表單可靠（見 migration 20260810000004 的註解）。
 *
 * 刻意**沒有** "use client"：
 * 登記表單是原生 <form action={serverAction}>，沒有 JavaScript 也送得出去。
 * 代價是表單的驗證結果沒地方接（server action 的回傳值在原生表單裡拿不到），
 * 所以走 redirect 帶一個短代碼回來，由這裡翻成中文。
 * 換成 useActionState 的話得把整個面板標成 client，
 * 連帶把 AdminField 整組拉進 client bundle —— 為了一行錯誤訊息不划算。
 * 只有狀態按鈕是 client（ConfirmButton），因為那裡需要二次確認與行內錯誤。
 */

/** addWaitlistEntry() redirect 回來的短代碼。只帶代碼不帶內文，網址列不會出現客人姓名電話。 */
const NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  ok: { tone: "ok", text: "候補已登記。" },
  missing: { tone: "error", text: "姓名與電話是必填的，請補齊後再送出一次。" },
  toolong: { tone: "error", text: "姓名或電話太長，請確認是不是貼到多餘的內容。" },
  nosession: { tone: "error", text: "找不到這個場次，可能剛剛被刪除了。" },
  failed: { tone: "error", text: "候補登記失敗，請重試一次。若持續失敗請截圖回報。" },
  denied: { tone: "error", text: "你的帳號沒有登記候補的權限。" },
};

const TARGET_LABEL: Record<WaitlistStatus, string> = {
  waiting: "改回候補中",
  offered: "標記已通知",
  converted: "標記已報名",
  cancelled: "取消候補",
};

function confirmText(entry: WaitlistEntry, target: WaitlistStatus): string {
  switch (target) {
    case "offered":
      return `確定把「${entry.name}」標記為已通知有位子嗎？\n代表你已經聯絡過對方，正在等他回覆。`;
    case "converted":
      return `確定把「${entry.name}」標記為已轉正式報名嗎？\n請先確認訂單已經建立並收到款項。`;
    case "cancelled":
      return `確定取消「${entry.name}」的候補嗎？\n取消後不能改回來，要恢復請重新登記一筆。`;
    default:
      return `確定把「${entry.name}」改成「${WAITLIST_STATUS_LABEL[target]}」嗎？`;
  }
}

export function WaitlistPanel({
  sessionId,
  entries,
  error,
  canWrite,
  notice,
}: {
  sessionId: string;
  entries: readonly WaitlistEntry[];
  error: string;
  /** 有 waitlist:write 才顯示登記表單與狀態按鈕 */
  canWrite: boolean;
  /** 網址上的 ?wl= 代碼 */
  notice?: string;
}) {
  const waitingCount = entries.filter((entry) => entry.status === "waiting").length;
  // Object.hasOwn 而不是 NOTICES[notice]：?wl=__proto__ 或 ?wl=constructor
  // 會從 Object.prototype 拿到一個 truthy 的東西，然後渲染一個內容是 undefined 的紅框。
  // 不會 XSS（React 會 escape），但畫面會出現一個沒有文字的錯誤提示。
  const resolvedNotice =
    notice && Object.hasOwn(NOTICES, notice) ? NOTICES[notice] : undefined;

  return (
    <section id="waitlist" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-medium text-ink">候補名單</h2>
        <p className="text-[13px] text-ink-soft">
          共 {entries.length} 筆，其中 {waitingCount} 筆還在等。依登記時間排序。
        </p>
      </div>

      {resolvedNotice && (
        <p
          // 成功用 status（不打斷螢幕閱讀器），失敗用 alert（要立刻讀出來）
          role={resolvedNotice.tone === "ok" ? "status" : "alert"}
          className={`rounded-card border px-4 py-2.5 text-[14px] ${
            resolvedNotice.tone === "ok"
              ? "border-line bg-panel text-ink"
              : "border-danger bg-paper text-danger"
          }`}
        >
          {resolvedNotice.text}
        </p>
      )}

      {error ? (
        <LoadError message={error} />
      ) : (
        <DataList
          items={entries}
          keyOf={(entry) => entry.id}
          caption="這一場的候補名單與處理狀態"
          empty="還沒有人候補。客人用 LINE 來問的時候，可以用下面的表單登記。"
          columns={[
            { header: "姓名", primary: true, cell: (entry) => entry.name },
            {
              header: "狀態",
              trailing: true,
              cell: (entry) => <WaitlistStatusChip status={entry.status} />,
            },
            { header: "電話", cell: (entry) => entry.phone },
            {
              header: "Email",
              // break-all：客人的 Email 可能很長，不斷字的話 390px 會被撐出橫向捲軸
              cell: (entry) =>
                entry.email ? <span className="break-all">{entry.email}</span> : "—",
            },
            {
              header: "備註",
              cell: (entry) =>
                entry.note ? <span className="break-words">{entry.note}</span> : "—",
            },
            {
              header: "登記時間",
              desktopOnly: true,
              cell: (entry) => formatTaipei(entry.createdAt),
            },
          ]}
          actions={
            canWrite
              ? (entry) => (
                  <>
                    {allowedWaitlistTargets(entry.status).map((target) => (
                      <ConfirmButton
                        key={target}
                        action={setWaitlistStatus.bind(null, entry.id, sessionId, target)}
                        confirmText={confirmText(entry, target)}
                        variant={target === "cancelled" ? "danger" : "default"}
                      >
                        {TARGET_LABEL[target]}
                      </ConfirmButton>
                    ))}
                  </>
                )
              : undefined
          }
        />
      )}

      {canWrite && (
        <details className="rounded-card border border-line bg-panel px-4 py-3">
          {/* 收合起來：多數時候客服是來看名單的，不是來登記的。
              需要時展開，展開狀態不用記——每次登記完 redirect 回來本來就會收起。 */}
          {/* list-none 收掉 Firefox/Chrome 的三角形，::-webkit-details-marker 收掉 Safari 的。
              兩個都要寫，只寫一個會在另一個瀏覽器留下一個孤兒箭頭。 */}
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-[15px] font-medium text-ink admin:min-h-0 [&::-webkit-details-marker]:hidden">
            ＋ 登記一筆候補
          </summary>

          <form
            action={addWaitlistEntry.bind(null, sessionId)}
            className="mt-3 grid grid-cols-1 gap-3 admin:grid-cols-2"
          >
            <AdminField
              label="姓名"
              name="name"
              required
              maxLength={60}
              autoComplete="off"
              hint="客人在電話裡報的名字"
            />
            <AdminField
              label="電話"
              name="phone"
              type="tel"
              required
              maxLength={40}
              autoComplete="off"
              inputMode="tel"
              hint="有位子時要回撥的號碼"
            />
            <AdminField
              label="Email"
              name="email"
              type="email"
              maxLength={200}
              autoComplete="off"
              hint="可以不填"
            />
            <AdminTextarea
              label="備註"
              name="note"
              rows={2}
              maxLength={500}
              wrapperClassName="admin:col-span-2"
              hint="例如：只能參加下午場、需要素食"
            />
            <div className="admin:col-span-2">
              <button
                type="submit"
                className="inline-flex min-h-11 w-full items-center justify-center rounded-input border border-accent-ink bg-accent-ink px-5 text-[15px] font-medium text-paper transition-opacity hover:opacity-90 admin:min-h-10 admin:w-auto"
              >
                登記候補
              </button>
            </div>
          </form>
        </details>
      )}
    </section>
  );
}

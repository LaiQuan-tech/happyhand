import { AdminField, AdminSelect } from "@/components/admin/admin-field";
import { AdminDateTimeField, formatTaipei } from "@/components/admin/datetime-field";
import { ConfirmButton } from "@/components/admin/confirm-button";
import { upsertSession, deleteSession } from "@/app/admin/products/actions";
import {
  SESSION_STATUS_CHOICES,
  SESSION_STATUS_LABEL,
  type SessionRow,
} from "@/app/admin/products/shared";
import { StatusChip, adminPrimaryButton } from "@/app/admin/products/ui";

/**
 * 工作坊場次編輯器。
 *
 * 刻意是 server component：每一場自己一個 `<form action={...}>`，
 * 新增也是一個獨立的表單。完全不需要 client state，
 * 所以這一整塊送到瀏覽器的 JavaScript 是 0（只有刪除鈕是既有的
 * ConfirmButton，那本來就是 client component）。
 *
 * 為什麼不像單元那樣整批存：場次上有
 * `unique (product_id, starts_at)`，而且刪除牽涉到報名紀錄的檢查。
 * 一場一場存，錯誤才能精準地指向出問題的那一場。
 *
 * 🔴 這裡看不到也改不了 seats_taken，這是刻意的。
 *    那個數字歸結帳流程（reserve_seat / commit_seat_hold）與
 *    /admin/sessions 的 admin_adjust_seats() 管。在課程編輯頁順手改它，
 *    會直接和實際報名人數打架 —— 而現場備課、印講義是看報名人數的。
 */

export function SessionEditor({
  productId,
  sessions,
}: {
  productId: string;
  sessions: SessionRow[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {sessions.length === 0 ? (
        <p className="rounded-card border border-line bg-panel px-4 py-6 text-center text-[14px] text-ink-soft">
          這門課還沒有任何場次。用下面的表單新增第一場。
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="rounded-card border border-line bg-paper p-3.5 admin:p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <span className="text-[14px] font-medium text-ink">
                  {formatTaipei(session.starts_at)}
                </span>
                <div className="flex items-center gap-2">
                  <StatusChip
                    label={SESSION_STATUS_LABEL[session.status]}
                    tone={
                      session.status === "open"
                        ? "ok"
                        : session.status === "cancelled"
                          ? "danger"
                          : session.status === "full"
                            ? "warn"
                            : "neutral"
                    }
                  />
                  {/*
                    已報名人數在這裡是唯讀資訊。看得到才知道名額不能砍到多低，
                    但沒有任何輸入框可以改它。
                  */}
                  <span className="text-[13px] text-ink-soft">
                    已報名 {session.seats_taken} / {session.capacity}
                  </span>
                </div>
              </div>

              <SessionFields productId={productId} session={session} />
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-card border border-dashed border-line-strong bg-panel p-3.5 admin:p-4">
        <h3 className="mb-3 text-[14px] font-medium text-ink">新增場次</h3>
        <SessionFields productId={productId} session={null} />
      </div>
    </div>
  );
}

/**
 * 一場的欄位。新增與編輯共用同一份 markup，
 * 差別只在有沒有 session_id 這個 hidden input。
 */
function SessionFields({
  productId,
  session,
}: {
  productId: string;
  session: SessionRow | null;
}) {
  const isNew = session === null;
  // 同一頁會出現多份這些欄位，id 必須帶上場次識別才不會重複，
  // 否則 <label for> 會全部指到第一場的輸入框。
  const scope = session?.id ?? "new";

  return (
    <form action={upsertSession.bind(null, productId)} className="flex flex-col gap-3">
      {session && <input type="hidden" name="session_id" value={session.id} />}

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 admin:grid-cols-2">
        <AdminDateTimeField
          id={`session-starts-${scope}`}
          name="starts_at"
          label="開始時間"
          required
          valueIso={session?.starts_at}
        />
        <AdminDateTimeField
          id={`session-ends-${scope}`}
          name="ends_at"
          label="結束時間"
          required
          valueIso={session?.ends_at}
        />

        <AdminField
          id={`session-location-${scope}`}
          name="location"
          label="地點名稱"
          maxLength={200}
          defaultValue={session?.location ?? ""}
          hint="例如「好日子台北教室」"
        />
        <AdminField
          id={`session-address-${scope}`}
          name="address"
          label="地址"
          maxLength={300}
          defaultValue={session?.address ?? ""}
        />

        <AdminField
          id={`session-capacity-${scope}`}
          name="capacity"
          label="名額上限"
          type="number"
          min={session?.seats_taken ?? 0}
          step={1}
          required
          defaultValue={session?.capacity ?? 12}
          hint={
            session && session.seats_taken > 0
              ? `已經有 ${session.seats_taken} 人報名，名額不能低於這個數字。`
              : undefined
          }
        />

        <AdminSelect
          id={`session-status-${scope}`}
          name="status"
          label="報名狀態"
          defaultValue={
            session && (SESSION_STATUS_CHOICES as readonly string[]).includes(session.status)
              ? session.status
              : "open"
          }
          options={SESSION_STATUS_CHOICES.map((value) => ({
            value,
            label: SESSION_STATUS_LABEL[value],
          }))}
          // full 不在選項裡：trigger sync_workshop_session_status() 會依
          // seats_taken >= capacity 自動判定，人選了也會被覆寫。
          hint="「已額滿」由系統依名額自動判定，不用手動選。"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={adminPrimaryButton}>
          {isNew ? "新增這一場" : "儲存這一場"}
        </button>

        {session && (
          <ConfirmButton
            action={deleteSession.bind(null, session.id, productId)}
            variant="danger"
            confirmText={
              `確定要刪除 ${formatTaipei(session.starts_at)} 這一場嗎？\n\n` +
              "如果已經有人報名，系統會擋下來並請你改用「已取消」。\n" +
              "沒有人報名的場次會直接刪除，無法復原。"
            }
          >
            刪除這一場
          </ConfirmButton>
        )}
      </div>
    </form>
  );
}

"use client";

import { useActionState, useState } from "react";
import { ConfirmButton } from "@/components/admin/confirm-button";
import {
  rebindOrderAccount,
  regrantEntitlements,
  forceGrantEntitlements,
  resendSetupEmail,
  revokeCourseAccess,
  type AccountActionResult,
} from "@/app/admin/orders/account-actions";

/**
 * 訂單的「會員帳號與課程開通」面板。
 *
 * 這一區回答客服每天最常被問的那句話：「我付錢了為什麼看不到課？」
 * 所以它必須把整條鏈都攤開：訂單綁到誰、那個帳號的信箱是什麼、
 * 開通了哪幾門課。任何一環斷掉都要看得出來斷在哪裡，不能只顯示「正常」。
 *
 * ⚠️ 顯示層藏按鈕只是體貼，不是保護。每一支 action 都自己驗權限。
 */

export type OrderAccountInfo = {
  orderId: string;
  orderNo: string;
  status: string;
  priceUnverified: boolean;
  /** 訂單上填的 Email */
  contactEmail: string | null;
  userId: string | null;
  /** 綁定帳號的 Email。查不到（帳號被刪）時是 null。 */
  accountEmail: string | null;
  /** 這筆訂單開通出去的課 */
  entitlements: { productId: string; title: string; expiresAt: string | null }[];
  /** 這筆訂單裡有幾個是線上課程（workshop 不需要開通） */
  courseItemCount: number;
};

const EMPTY: AccountActionResult = {};

function Notice({ state }: { state: AccountActionResult }) {
  if (!state.error && !state.ok) return null;
  const isError = Boolean(state.error);
  return (
    <p
      role={isError ? "alert" : "status"}
      className={`mt-3 rounded-card border px-4 py-2.5 text-[14px] ${
        isError
          ? "border-danger bg-paper text-danger"
          : "border-line bg-panel text-ink"
      }`}
    >
      {state.error ?? state.ok}
    </p>
  );
}

export function OrderAccountPanel({
  info,
  canWrite,
}: {
  info: OrderAccountInfo;
  canWrite: boolean;
}) {
  const [rebindState, rebindAction, rebinding] = useActionState(
    rebindOrderAccount.bind(null, info.orderId),
    EMPTY,
  );
  const [editing, setEditing] = useState(false);

  const bound = Boolean(info.userId);
  const emailMismatch =
    bound &&
    info.accountEmail !== null &&
    info.contactEmail !== null &&
    info.accountEmail.toLowerCase() !== info.contactEmail.trim().toLowerCase();

  // 「已付款、有線上課、卻沒有任何 entitlement」＝ 客人正在付了錢看不到課
  const missingGrant =
    info.status === "paid" &&
    info.courseItemCount > 0 &&
    info.entitlements.length === 0;

  return (
    <section className="rounded-card border border-line bg-paper p-4 admin:p-5">
      <h2 className="mb-3 text-[16px] font-medium text-ink">
        會員帳號與課程開通
      </h2>

      {/* --- 最重要的一句話放最上面。客服掃一眼就要知道有沒有事。 --- */}
      {missingGrant ? (
        <p className="mb-3 rounded-card border border-danger bg-paper px-4 py-3 text-[14px] leading-relaxed text-danger">
          <strong>這筆訂單已收款，但線上課還沒有開通。</strong>
          <br />
          {info.priceUnverified
            ? "原因是金額沒有經過系統核對。請核對金額後按下方的「我已核對金額無誤，開通課程」。"
            : bound
              ? "請按下方的「重新開通」。"
              : "原因是這筆訂單沒有綁到會員帳號。請確認客人的 Email 後按「綁定並開通」。"}
        </p>
      ) : info.status === "paid" && info.courseItemCount === 0 ? (
        <p className="mb-3 text-[14px] text-ink-soft">
          這筆訂單沒有線上課程（只有工作坊或實體品項），不需要開通。
        </p>
      ) : null}

      <dl className="grid grid-cols-1 gap-y-2.5 text-[14px] admin:grid-cols-[8rem_minmax(0,1fr)] admin:gap-x-4 admin:gap-y-3">
        <dt className="text-ink-soft">會員帳號</dt>
        <dd className="text-ink">
          {bound ? (
            <span className="break-all">
              {info.accountEmail ?? (
                <span className="text-danger">
                  帳號已被刪除（id {info.userId?.slice(0, 8)}…）
                </span>
              )}
            </span>
          ) : (
            <span className="text-danger">尚未綁定</span>
          )}
        </dd>

        <dt className="text-ink-soft">訂單填的 Email</dt>
        <dd className="text-ink">
          <span className="break-all">{info.contactEmail || "—"}</span>
          {emailMismatch && (
            <span className="mt-1 block text-[13px] text-danger">
              ⚠️ 跟帳號的 Email 不一樣。客人可能是用另一個信箱登入的，
              開通通知會寄到訂單填的這一個。
            </span>
          )}
        </dd>

        <dt className="text-ink-soft">已開通的課</dt>
        <dd className="text-ink">
          {info.entitlements.length === 0 ? (
            <span className="text-ink-soft">無</span>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {info.entitlements.map((e) => (
                <li key={e.productId} className="flex flex-wrap items-center gap-2">
                  <span>{e.title}</span>
                  <span className="text-[13px] text-ink-soft">
                    {e.expiresAt
                      ? `到期 ${e.expiresAt.slice(0, 10)}`
                      : "永久回放"}
                  </span>
                  {canWrite && info.userId && (
                    <ConfirmButton
                      action={revokeCourseAccess.bind(
                        null,
                        info.orderId,
                        info.userId,
                        e.productId,
                      )}
                      confirmText={`確定關閉「${e.title}」的觀看權限嗎？\n客人會立刻看不到這門課。\n\n提醒：如果客人用兩筆訂單買過同一門課，關掉之後另一筆也會失效。`}
                      variant="danger"
                      className="text-[13px]"
                    >
                      關閉權限
                    </ConfirmButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>

      {canWrite && (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap gap-2">
            {info.priceUnverified && info.status === "paid" ? (
              <ConfirmButton
                action={() => forceGrantEntitlements(info.orderId)}
                confirmText={`這筆訂單的金額沒有經過系統核對。\n\n按下去代表你已經人工確認過金額正確，系統會記下是誰確認的，然後開通課程。\n\n確定金額無誤嗎？`}
              >
                我已核對金額無誤，開通課程
              </ConfirmButton>
            ) : (
              <ConfirmButton
                action={() => regrantEntitlements(info.orderId)}
                confirmText={`重新跑一次開通。\n本來就開通的課不會有變化，也不會重複寄信。\n\n要繼續嗎？`}
                disabled={!bound || info.status !== "paid"}
              >
                重新開通
              </ConfirmButton>
            )}

            <ConfirmButton
              action={() => resendSetupEmail(info.orderId)}
              confirmText={`重新寄一封「設定密碼」信到 ${info.contactEmail ?? "訂單的 Email"}。\n\n舊的連結會失效，請提醒客人用最新收到的那一封。`}
              disabled={!bound}
            >
              重寄設定密碼信
            </ConfirmButton>

            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="inline-flex min-h-11 items-center rounded-input border border-line-input bg-paper px-4 text-[14px] text-ink hover:bg-panel admin:min-h-10"
              aria-expanded={editing}
            >
              {bound ? "修正 Email／換綁帳號" : "綁定並開通"}
            </button>
          </div>

          {editing && (
            <form action={rebindAction} className="flex flex-col gap-2">
              <label
                htmlFor="rebind-email"
                className="text-[14px] font-medium text-ink"
              >
                客人正確的 Email
              </label>
              <p className="text-[13px] text-ink-soft">
                留空就用訂單現在填的「{info.contactEmail || "（空白）"}」再綁一次。
                填了新的會一併更新訂單上的 Email，已開通的課也會搬到新帳號。
              </p>
              <input
                id="rebind-email"
                name="email"
                type="email"
                autoComplete="off"
                inputMode="email"
                defaultValue=""
                placeholder={info.contactEmail ?? "someone@example.com"}
                className="min-h-11 rounded-input border border-line-input bg-paper px-3 text-[15px] text-ink admin:min-h-10"
              />
              <div>
                <button
                  type="submit"
                  disabled={rebinding}
                  aria-busy={rebinding}
                  className="inline-flex min-h-11 items-center rounded-input border border-accent-ink bg-accent-ink px-5 text-[15px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-55 admin:min-h-10"
                >
                  {rebinding ? "處理中…" : "綁定並開通"}
                </button>
              </div>
              <Notice state={rebindState} />
            </form>
          )}
        </div>
      )}
    </section>
  );
}

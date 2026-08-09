"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  toRole,
  type Role,
} from "@/lib/admin/roles";
import { adminBorderClass, adminControlClass, adminControlHeight } from "./admin-field";

/**
 * 改某個帳號角色的下拉選單 + 二次確認。
 *
 * 改自 goodday 的 RoleToggle.tsx，但那邊是 admin/customer 的二元 toggle，
 * 一顆按鈕點下去就換邊；這裡是四個值，而且「客服 → 內容編輯」這種橫向調整
 * 沒有明顯的方向性，toggle 表達不了，所以換成 select。
 *
 * 從 goodday 那版改掉的三件事：
 *
 * 1. 失敗訊息顯示在畫面上，不用 alert()。
 *    alert 會被瀏覽器的「封鎖此網頁的其他對話框」永久關掉，
 *    之後所有失敗都變成靜默無反應。
 * 2. 失敗或取消時把 select 轉回原值。
 *    select 是受控的，不轉回去畫面就會顯示一個資料庫裡根本不存在的角色 —— 畫面在說謊。
 * 3. 送出前的 confirm 會把「新角色能做什麼」念出來（ROLE_DESCRIPTIONS）。
 *    「確定改成內容編輯？」對負責人來說不構成決策資訊，
 *    「內容編輯看不到訂單與客人個資」才是。
 *
 * ⚠️ 伺服器端的值變了之後這個元件不會自己跟上（useState 只吃初始值）。
 *    呼叫端要傳 key={`${id}:${role}`} 讓 React 在角色變動時重新掛載，
 *    這比塞一個 useEffect 同步 props → state 乾淨。
 */

export type RoleSelectResult = { error?: string | null } | void | undefined;

/** 與 confirm-button.tsx 同一份判斷：Next 的 redirect()/notFound() 是用丟例外實作的。 */
function isNextControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

export function RoleSelect({
  role,
  action,
  subject,
  id,
  disabled = false,
  disabledReason,
  showDescription = true,
}: {
  /** 目前的角色（資料庫的值） */
  role: Role;
  /** 通常是 setStaffRole.bind(null, userId)。帳號代號綁在伺服器端，client 只送新角色。 */
  action: (next: Role) => Promise<RoleSelectResult>;
  /** 確認對話框裡用來指認對象的字串，通常是 Email */
  subject: string;
  /** <select> 的 id，同一頁會有多個所以必須由呼叫端指定 */
  id: string;
  disabled?: boolean;
  /** 為什麼不能改。有值時顯示在選單下方，不是只把控制項變灰。 */
  disabledReason?: string;
  /** 顯示目前角色的說明。桌機表格一列一句話會有點吵，可以關掉。 */
  showDescription?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Role>(role);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const next = toRole(event.target.value);
    if (next === value) return;

    setError(null);

    // confirm() 是同步阻塞的，要在 startTransition 外面呼叫，
    // 否則 transition 已經開始了才被使用者取消。
    const ok = window.confirm(
      `確定把 ${subject} 的角色從「${ROLE_LABELS[value]}」改成「${ROLE_LABELS[next]}」嗎？\n\n` +
        `${ROLE_LABELS[next]}：${ROLE_DESCRIPTIONS[next]}`,
    );
    if (!ok) {
      // 使用者按了取消，但 <select> 的值已經被瀏覽器改掉了，要自己轉回去。
      event.target.value = value;
      return;
    }

    const previous = value;
    setValue(next);

    startTransition(async () => {
      try {
        const result = await action(next);
        if (result && result.error) {
          setValue(previous);
          setError(result.error);
          return;
        }
        // 成功後刷新伺服器元件：負責人數、可不可以移除等等都會跟著變。
        router.refresh();
      } catch (err) {
        if (isNextControlFlow(err)) throw err;
        setValue(previous);
        setError(
          err instanceof Error && err.message
            ? err.message
            : "改角色失敗，請重試一次。若持續失敗請截圖回報。",
        );
      }
    });
  }

  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, disabledReason ? hintId : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <select
        id={id}
        value={value}
        onChange={handleChange}
        disabled={disabled || pending}
        aria-busy={pending}
        aria-label={`${subject} 的角色`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        // adminControlClass 已經有 w-full，這裡不要再寫 w-auto 去跟它打架
        // —— Tailwind v4 的勝負由 CSS 產出順序決定，不是 class 字串的順序，
        // 那種寫法在不同版本會翻盤。撐滿容器對觸控也比較好按，只加一個上限避免桌機拉太寬。
        className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass(
          error ?? undefined,
        )} max-w-[18rem] appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9`}
        style={{
          // 與 admin-field.tsx 的 AdminSelect 用同一張收合箭頭，外觀才一致。
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%237A6248' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
      >
        {ROLES.map((option) => (
          <option key={option} value={option}>
            {ROLE_LABELS[option]}
          </option>
        ))}
      </select>

      {pending && (
        <span className="text-[12px] text-ink-soft" role="status">
          儲存中…
        </span>
      )}

      {showDescription && !error && !pending && (
        <span className="max-w-[18rem] text-[12px] leading-snug text-ink-soft">
          {ROLE_DESCRIPTIONS[value]}
        </span>
      )}

      {disabledReason && (
        <span id={hintId} className="max-w-[18rem] text-[12px] leading-snug text-ink-soft">
          {disabledReason}
        </span>
      )}

      {error && (
        <span
          id={errorId}
          role="alert"
          className="max-w-[18rem] text-[13px] leading-snug text-danger"
        >
          {error}
        </span>
      )}
    </div>
  );
}

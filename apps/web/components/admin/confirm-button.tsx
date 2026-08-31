"use client";

import { useState, useTransition } from "react";

/**
 * 需要二次確認的破壞性操作按鈕（取消訂單、刪除場次、移除員工…）。
 *
 * 三件事刻意做滿：
 * 1. 執行中 disable + aria-busy，避免連點兩次送出兩筆。
 * 2. 失敗訊息「顯示在畫面上」而不是 console.error。
 *    後台的使用者是好日子的員工，不會開 DevTools；
 *    按了沒反應又沒訊息，他們只會再按一次。
 * 3. server action 的 redirect() 不當成錯誤（見下方 isNextControlFlow）。
 */

/** server action 可以回 { error } 讓按鈕顯示訊息，也可以直接 throw，兩種都接。 */
export type ConfirmActionResult =
  | { error?: string | null; ok?: string | null }
  | void
  | undefined;

type Variant = "default" | "danger";

const VARIANTS: Record<Variant, string> = {
  default:
    "border border-line-input bg-paper text-ink hover:bg-panel disabled:opacity-55",
  danger:
    "border border-danger bg-paper text-danger hover:bg-danger hover:text-paper disabled:opacity-55",
};

/**
 * Next 用「丟例外」實作 redirect() 與 notFound()。
 * 這種例外必須原封不動往上丟，被 catch 住的話畫面會停在原地並顯示一句
 * 看不懂的 "NEXT_REDIRECT"，而使用者以為操作失敗了。
 */
function isNextControlFlow(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

export function ConfirmButton({
  action,
  confirmText,
  children,
  variant = "default",
  disabled = false,
  pendingLabel = "處理中…",
  className = "",
}: {
  /** 通常是一個 server action。回 { error } 或 throw 都會顯示訊息。 */
  action: () => Promise<ConfirmActionResult>;
  /** confirm() 對話框的內容。寫清楚「會發生什麼」，不要只寫「確定嗎？」 */
  confirmText: string;
  children: React.ReactNode;
  variant?: Variant;
  disabled?: boolean;
  pendingLabel?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 有些動作成功之後還有話要說（例如退款到底是「取消授權」還是「真的退錢」，
  // 對客人的對帳單影響完全不同）。狀態變更本身看得到，但那句話看不到。
  const [okMessage, setOkMessage] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    setOkMessage(null);
    // confirm() 是同步阻塞的，必須在 startTransition 外面呼叫，
    // 不然 transition 已經開始了才被取消。
    if (!window.confirm(confirmText)) return;

    startTransition(async () => {
      try {
        const result = await action();
        if (result && result.error) setError(result.error);
        else if (result && result.ok) setOkMessage(result.ok);
      } catch (err) {
        if (isNextControlFlow(err)) throw err;
        setError(
          err instanceof Error && err.message
            ? err.message
            : "操作失敗，請重試一次。若持續失敗請截圖回報。",
        );
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || pending}
        aria-busy={pending}
        className={`inline-flex min-h-11 items-center justify-center rounded-input px-4 text-[14px] font-medium transition-colors admin:min-h-10 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      >
        {pending ? pendingLabel : children}
      </button>
      {error && (
        <span role="alert" className="max-w-[22rem] text-[13px] leading-snug text-danger">
          {error}
        </span>
      )}
      {okMessage && (
        <span role="status" className="max-w-[22rem] text-[13px] leading-snug text-ok">
          {okMessage}
        </span>
      )}
    </span>
  );
}

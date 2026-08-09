import type { ReactNode } from "react";
import {
  SESSION_STATUS_LABEL,
  WAITLIST_STATUS_LABEL,
  type SessionStatus,
  type WaitlistStatus,
} from "./queries";

/**
 * 場次報名管理的共用顯示零件。
 *
 * app/admin/page.tsx 裡有一個同名的 StatusChip，但它沒 export 而且只認 ok/warn 兩色。
 * 這裡不去改那支（那是別人的檔案），改在這裡放一份能表達四種語氣的版本，
 * 總覽頁、明細頁、候補面板共用同一份，狀態顏色才不會三個地方各長各的。
 *
 * 色票用途遵守 app/globals.css 的註記：
 * 有字的地方一律 accent-ink（6.33:1），不用 accent（4.29:1，達不到 AA）。
 */

type Tone = "ok" | "warn" | "danger" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-accent-ink",
  danger: "text-danger",
  neutral: "text-ink-soft",
};

export function StatusChip({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill bg-chip px-2.5 py-1 text-[12px] font-medium whitespace-nowrap ${TONE_TEXT[tone]}`}
    >
      {label}
    </span>
  );
}

const SESSION_TONE: Record<SessionStatus, Tone> = {
  open: "ok",
  full: "warn",
  closed: "neutral",
  cancelled: "danger",
};

export function SessionStatusChip({ status }: { status: SessionStatus }) {
  return <StatusChip label={SESSION_STATUS_LABEL[status]} tone={SESSION_TONE[status]} />;
}

const WAITLIST_TONE: Record<WaitlistStatus, Tone> = {
  waiting: "warn",
  offered: "ok",
  converted: "ok",
  cancelled: "neutral",
};

export function WaitlistStatusChip({ status }: { status: WaitlistStatus }) {
  return <StatusChip label={WAITLIST_STATUS_LABEL[status]} tone={WAITLIST_TONE[status]} />;
}

/* ------------------------------------------------------------------ 版面 */

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warn";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`rounded-card border px-4 py-3 ${
        tone === "warn" ? "border-accent bg-panel" : "border-line bg-panel"
      }`}
    >
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && (
        <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">{children}</div>
      )}
    </div>
  );
}

export function LoadError({ message }: { message: string }) {
  return (
    <p className="rounded-card border border-line bg-panel px-4 py-3 text-[14px] text-ink-soft">
      {message}
      <span className="block text-[13px]">詳細錯誤已記在伺服器 log。</span>
    </p>
  );
}

export function PermissionDenied({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-line bg-panel px-5 py-10 text-center">
      <p className="text-[15px] font-medium text-ink">{message}</p>
      <p className="mt-1.5 text-[13px] text-ink-soft">
        報名名單含有客人的姓名與電話，只開放客服與負責人查看。
        <br />
        需要權限請找負責人調整你的角色。
      </p>
    </div>
  );
}

/**
 * 「已付款報名人數」與 seats_taken 對不起來時的說明。
 *
 * 這一段刻意講得很白：seats_taken 是 seed 寫死的數字，
 * 目前沒有任何程式碼會寫它（結帳流程走的是 reserve_seat()，
 * 但正式資料庫裡一筆訂單都還沒有）。
 * 不解釋的話員工只會看到兩個打架的數字，然後開始不信任整個後台。
 */
export function SeatMismatchNote({ compact = false }: { compact?: boolean }) {
  return (
    <p className={`leading-relaxed text-ink-soft ${compact ? "text-[12px]" : "text-[13px]"}`}>
      「已付款報名」是從實際訂單即時算出來的（訂單狀態＝已付款），
      「系統名額」則是場次建立時寫入的初始值，尚未與實際報名對帳。
      兩者不一致時，<span className="font-medium text-ink">請以「已付款報名」為準備課資料的依據</span>，
      系統名額只影響前台還能不能報名。
    </p>
  );
}

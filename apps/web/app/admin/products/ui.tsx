import type { ReactNode } from "react";
import { PRODUCT_TYPE_LABEL, messageFor, type ProductType } from "./shared";

/**
 * 課程後台的共用顯示零件。
 *
 * 沒有去 import app/admin/sessions/ui.tsx 的那一份：那是別人路由底下的檔案，
 * 跨路由相依之後改一邊會不小心動到另一邊。等第三個地方也需要同一顆 chip 時，
 * 再一起抽到 components/admin/ 才是對的時機。
 *
 * 色票遵守 app/globals.css 的註記：有字的地方一律 accent-ink（6.33:1），
 * 不用 accent（4.29:1，達不到 AA）。
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

export function PublishChip({ published }: { published: boolean }) {
  return (
    <StatusChip label={published ? "發布中" : "草稿"} tone={published ? "ok" : "neutral"} />
  );
}

export function TypeChip({ type }: { type: ProductType }) {
  return <StatusChip label={PRODUCT_TYPE_LABEL[type]} tone="neutral" />;
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
        課程與工作坊的編輯開放給內容編輯與負責人。
        <br />
        需要權限請找負責人調整你的角色。
      </p>
    </div>
  );
}

/**
 * server action 用 redirect 帶回來的結果訊息。
 *
 * 只認 FORM_MESSAGES 這張表裡的代碼，認不得的一律不顯示 ——
 * 直接把網址上的文字印出來等於讓任何人都能做一個顯示任意訊息的後台畫面。
 */
export function FormNotice({ code }: { code: string }) {
  const message = messageFor(code);
  if (!message) return null;
  return (
    <div
      // role=status 讓螢幕閱讀器在畫面更新後讀出結果；
      // 存檔成功是「有事情發生了」，不該只有看得到的人知道。
      role="status"
      className={`rounded-card border px-4 py-3 text-[14px] ${
        message.tone === "ok"
          ? "border-line bg-panel text-ink"
          : "border-danger bg-panel text-danger"
      }`}
    >
      {message.text}
    </div>
  );
}

/**
 * 表單區塊的標題 + 說明。
 *
 * step 是「這是前台頁面由上到下的第幾段」。編輯頁的區段順序刻意等同
 * 前台頁面的區塊順序，編號讓人確認自己沒有跳著填。
 * 編號在頁面端連號產生（見 [id]/page.tsx 的 nextStep），區段被條件隱藏時
 * 也不會出現 ①②③⑤ 這種斷號。
 */
export function SectionHeader({
  title,
  description,
  id,
  step,
  actions,
}: {
  title: string;
  description?: ReactNode;
  id?: string;
  /** 顯示在標題左邊的順序徽章，例如 "3" */
  step?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 gap-2.5">
        {step && (
          // aria-hidden：這是視覺上的定位輔助，朗讀出來只會在每個標題前面
          // 多念一個數字。順序對讀螢幕的人來說是 DOM 順序本身。
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-pill bg-accent-soft text-[13px] font-medium text-ink"
          >
            {step}
          </span>
        )}
        <div className="min-w-0">
          <h2 id={id} className="font-serif text-[19px] leading-tight font-medium text-ink">
            {title}
          </h2>
          {description && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * 「這一段前台會顯示，但不是在這裡改」的唯讀提示。
 *
 * 前台頁面上有幾塊內容不屬於這門課（講師、健康聲明來自 site_settings，
 * 上課地點來自場次）。編輯頁照前台順序排的時候要是直接跳過它們，
 * 看的人會以為那些東西不存在或不見了。留一塊提示並指出去哪裡改。
 */
export function MirrorNote({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-panel px-4 py-3">
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}

/** 後台的主要按鈕樣式，表單送出鈕共用 */
export const adminPrimaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-input bg-accent-ink px-5 text-[15px] font-medium text-paper transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-55 admin:min-h-10";

/** 次要按鈕（取消、套用篩選） */
export const adminSecondaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-input border border-line-input bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-panel admin:min-h-10";

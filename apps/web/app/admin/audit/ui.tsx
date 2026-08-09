import type { ReactNode } from "react";

/**
 * 稽核紀錄頁的共用顯示零件。
 *
 * ⚠️ Callout / PermissionDenied 與 app/admin/sessions/ui.tsx、app/admin/staff/ui.tsx
 *    是同一套東西。它們該住在 components/admin/，但這次的改動範圍沒開放新增共用檔，
 *    所以先各自留一份。收斂方式寫在交付說明的「發現但沒處理」。
 */

type Tone = "neutral" | "ok" | "warn" | "danger";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-ink-soft",
  ok: "text-ok",
  warn: "text-accent-ink",
  danger: "text-danger",
};

const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-line",
  ok: "border-ok",
  warn: "border-accent",
  danger: "border-danger",
};

export function Chip({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center rounded-pill bg-chip px-2.5 py-1 text-[12px] font-medium whitespace-nowrap ${TONE_TEXT[tone]}`}
    >
      {label}
    </span>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={`rounded-card border bg-panel px-4 py-3 ${TONE_BORDER[tone]}`}>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      {children && (
        <div className="mt-1 text-[13px] leading-relaxed text-ink-soft">{children}</div>
      )}
    </div>
  );
}

export function PermissionDenied({ message }: { message: string }) {
  return (
    <div className="rounded-card border border-line bg-panel px-5 py-10 text-center">
      <p className="text-[15px] font-medium text-ink">{message}</p>
      <p className="mt-1.5 text-[13px] text-ink-soft">
        稽核紀錄會顯示每一位同事做過什麼，只開放負責人查看。
        <br />
        需要權限請找負責人調整你的角色。
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ diff */

function isChangePair(value: unknown): value is { from?: unknown; to?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    ("from" in value || "to" in value)
  );
}

/**
 * 把 diff 裡的任意值變成一句看得懂的字。
 *
 * ⚠️ 不用 <pre> 呈現 JSON：<pre> 預設 white-space: pre 不換行，
 *    390px 的手機上一個長 uuid 就會把整頁推寬（body 有 overflow-x:hidden，
 *    所以症狀不是出現橫向捲軸，而是內容被裁掉看不到）。
 */
function scalarText(value: unknown): string {
  if (value === null || value === undefined) return "（空）";
  if (typeof value === "string") return value === "" ? "（空字串）" : value;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

export function DiffRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="contents">
      <dt className="break-all text-ink-soft">{label}</dt>
      <dd className="min-w-0 break-all text-ink">
        {isChangePair(value) ? (
          <>
            <span className="text-ink-soft line-through">{scalarText(value.from)}</span>
            <span aria-hidden="true" className="mx-1 text-ink-soft">
              →
            </span>
            <span className="sr-only">改成</span>
            <span className="font-medium">{scalarText(value.to)}</span>
          </>
        ) : (
          scalarText(value)
        )}
      </dd>
    </div>
  );
}

/**
 * 展開才看得到的明細。
 *
 * 用原生 <details>：這一頁一次會有上百列，每列各掛一個 client component
 * 只為了做展開收合，是把整個 React runtime 拖進來換一個瀏覽器本來就有的東西。
 */
export function AuditDetails({
  entityId,
  diff,
}: {
  entityId: string | null;
  diff: Record<string, unknown> | null;
}) {
  const entries = diff ? Object.entries(diff) : [];
  if (entries.length === 0 && !entityId) {
    return <span className="text-ink-soft">—</span>;
  }

  return (
    <details className="min-w-0">
      <summary className="cursor-pointer text-[13px] text-accent-ink hover:underline">
        {entries.length > 0 ? `明細（${entries.length} 項）` : "明細"}
      </summary>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] leading-relaxed">
        {entries.map(([key, value]) => (
          <DiffRow key={key} label={key} value={value} />
        ))}
        {entityId && <DiffRow label="對象代號" value={entityId} />}
      </dl>
    </details>
  );
}

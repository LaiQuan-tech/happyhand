import type { ReactNode } from "react";
import { ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, type Role } from "@/lib/admin/roles";

/**
 * 員工頁的共用顯示零件。
 *
 * ⚠️ Callout / PermissionDenied 與 app/admin/sessions/ui.tsx、app/admin/audit/ui.tsx
 *    是同一套東西的第三份。它們本來就該住在 components/admin/，
 *    但這次的改動範圍只開放 app/admin/staff/**、app/admin/audit/** 與
 *    components/admin/role-select.tsx，沒辦法新增共用檔。
 *    收斂方式寫在交付說明的「發現但沒處理」。
 *
 * 色票遵守 app/globals.css 的註記：有字的地方一律用 accent-ink（6.33:1），
 * 不用 accent（4.29:1，達不到 AA）。
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

const ROLE_TONE: Record<Role, Tone> = {
  owner: "warn",
  editor: "neutral",
  support: "neutral",
  customer: "neutral",
};

export function RoleChip({ role }: { role: Role }) {
  return <Chip label={ROLE_LABELS[role]} tone={ROLE_TONE[role]} />;
}

export function Callout({
  tone = "neutral",
  title,
  children,
  /** role="status" 讓螢幕閱讀器在操作完成後主動念出結果 */
  live = false,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  live?: boolean;
}) {
  return (
    <div
      role={live ? "status" : undefined}
      className={`rounded-card border bg-panel px-4 py-3 ${TONE_BORDER[tone]}`}
    >
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
        員工管理可以把任何帳號升成負責人，只開放負責人使用。
        <br />
        需要權限請找負責人調整你的角色。
      </p>
    </div>
  );
}

/**
 * 一個有標題的區塊。id 是給 redirect 後的 #錨點用的
 * —— 送出邀請之後要回到表單旁邊看結果，不是回到頁面最上面。
 */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="flex flex-col gap-3">
      <div>
        {/* scroll-mt：手機的固定頁首會蓋住錨點跳過去的標題 */}
        <h2 className="scroll-mt-20 font-serif text-[18px] leading-snug font-medium text-ink">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * 四種角色各自能做什麼。
 *
 * 放一整塊而不是只在下拉選單旁邊寫一句：負責人要決定「這個人該給哪個角色」時，
 * 需要的是四個角色**互相比較**，一次只看到一句話比較不出來。
 */
export function RoleLegend() {
  return (
    <dl className="grid gap-x-6 gap-y-3 rounded-card border border-line bg-panel px-4 py-4 admin:grid-cols-2">
      {ROLES.map((role) => (
        <div key={role} className="min-w-0">
          <dt className="text-[14px] font-medium text-ink">{ROLE_LABELS[role]}</dt>
          <dd className="mt-0.5 text-[13px] leading-relaxed break-words text-ink-soft">
            {ROLE_DESCRIPTIONS[role]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

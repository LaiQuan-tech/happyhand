import type { ComponentProps, ReactNode } from "react";

/**
 * 後台表單欄位。
 *
 * 刻意「不」重用 components/ui/field.tsx：那支是前台 56px 的樂齡規格、
 * 標了 "use client"、而且只支援 input / textarea。後台的使用者是好日子的員工
 * （一般上班族），56px 會讓一頁塞不下幾個欄位。這裡桌機 40px、手機 44px。
 *
 * 三個刻意的設計：
 *
 * 1. 沒有 "use client"、沒有任何 hook（包含 useId）。
 *    id 由 name 推導，所以整組可以直接放進 server component 的
 *    <form action={serverAction}>，不用為了一個 label 把整頁拉進 client bundle。
 *    同一頁若有兩個同名欄位（少見），自己傳 id 覆蓋。
 *
 * 2. 全部非受控（defaultValue / defaultChecked），值只在 submit 時經 FormData 讀取。
 *    後台沒有即時驗證的需求，受控只會製造 re-render 與 stale state。
 *
 * 3. 外框用 --color-line-input（brown-300, 3.49:1）而不是前台的 sand-400（1.71:1）。
 *    WCAG 1.4.11 要求表單邊界對背景至少 3:1，sand-400 達不到。
 */

/** 給 datetime-field.tsx 之類的自訂控制項共用，確保外觀一致 */
// placeholder 用 ink-soft（5.72:1）不用 ink-muted（3.49:1）：
// placeholder 是「文字」，適用 WCAG 1.4.3 的 4.5:1，ink-muted 達不到。
// ink-muted 只留給 aria-hidden 的圖示那種非文字用途。
export const adminControlClass =
  "w-full rounded-input border bg-paper px-3 text-[16px] text-ink outline-none transition-colors placeholder:text-ink-soft disabled:cursor-not-allowed disabled:bg-panel disabled:text-ink-soft admin:text-[15px]";

/** 桌機 40px、手機 44px。手機字級維持 16px，低於 16px iOS Safari 會在 focus 時自動放大整頁。 */
export const adminControlHeight = "h-11 admin:h-10";

export function adminBorderClass(error?: string) {
  return error
    ? "border-danger focus:border-danger"
    : "border-line-input focus:border-accent-ink";
}

function describedBy(hasError: boolean, hasHint: boolean, errId: string, hintId: string) {
  const ids = [hasError ? errId : null, hasHint ? hintId : null].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

export function AdminFieldLabel({
  htmlFor,
  children,
  required,
}: {
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-[14px] leading-snug font-medium text-ink"
    >
      {children}
      {required && (
        <>
          <span className="ml-1 text-danger" aria-hidden="true">
            ＊
          </span>
          <span className="sr-only">（必填）</span>
        </>
      )}
    </label>
  );
}

export function AdminFieldNotes({
  error,
  hint,
  errId,
  hintId,
}: {
  error?: string;
  hint?: string;
  errId: string;
  hintId: string;
}) {
  return (
    <>
      {/* hint 在有 error 時仍然保留：使用者正需要知道格式規則才改得對 */}
      {hint && (
        <p id={hintId} className="mt-1.5 text-[13px] leading-snug text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-1.5 text-[13px] leading-snug text-danger">
          {error}
        </p>
      )}
    </>
  );
}

type BaseProps = {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  /** 同一頁出現同名欄位時才需要自己指定 */
  id?: string;
  /** 加在最外層 wrapper，用來控制欄位在 grid 裡的跨欄 */
  wrapperClassName?: string;
};

/* ------------------------------------------------------------------ input */

export type AdminFieldProps = BaseProps &
  Omit<ComponentProps<"input">, "name" | "id">;

export function AdminField({
  label,
  name,
  error,
  hint,
  id,
  wrapperClassName = "",
  className = "",
  type = "text",
  ...rest
}: AdminFieldProps) {
  const fieldId = id ?? `admin-${name}`;
  const errId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={wrapperClassName}>
      <AdminFieldLabel htmlFor={fieldId} required={rest.required}>
        {label}
      </AdminFieldLabel>
      <input
        {...rest}
        id={fieldId}
        name={name}
        type={type}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(!!error, !!hint, errId, hintId)}
        className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass(error)} ${className}`}
      />
      <AdminFieldNotes error={error} hint={hint} errId={errId} hintId={hintId} />
    </div>
  );
}

/* --------------------------------------------------------------- textarea */

export type AdminTextareaProps = BaseProps &
  Omit<ComponentProps<"textarea">, "name" | "id">;

export function AdminTextarea({
  label,
  name,
  error,
  hint,
  id,
  wrapperClassName = "",
  className = "",
  rows = 4,
  ...rest
}: AdminTextareaProps) {
  const fieldId = id ?? `admin-${name}`;
  const errId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={wrapperClassName}>
      <AdminFieldLabel htmlFor={fieldId} required={rest.required}>
        {label}
      </AdminFieldLabel>
      <textarea
        {...rest}
        id={fieldId}
        name={name}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(!!error, !!hint, errId, hintId)}
        className={`${adminControlClass} ${adminBorderClass(error)} py-2.5 leading-relaxed ${className}`}
      />
      <AdminFieldNotes error={error} hint={hint} errId={errId} hintId={hintId} />
    </div>
  );
}

/* ----------------------------------------------------------------- select */

export type AdminSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type AdminSelectProps = BaseProps & {
  options: AdminSelectOption[];
  /** 顯示成第一個 disabled option，語意是「還沒選」 */
  placeholder?: string;
} & Omit<ComponentProps<"select">, "name" | "id" | "children">;

export function AdminSelect({
  label,
  name,
  error,
  hint,
  id,
  options,
  placeholder,
  wrapperClassName = "",
  className = "",
  ...rest
}: AdminSelectProps) {
  const fieldId = id ?? `admin-${name}`;
  const errId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={wrapperClassName}>
      <AdminFieldLabel htmlFor={fieldId} required={rest.required}>
        {label}
      </AdminFieldLabel>
      <select
        {...rest}
        id={fieldId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(!!error, !!hint, errId, hintId)}
        className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass(error)} appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-9 ${className}`}
        style={{
          // 收合箭頭。用 data URI 而不是額外疊一個 <svg>，
          // 疊 svg 的話點到箭頭不會展開 select（要再補 pointer-events-none）。
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%237A6248' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        }}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <AdminFieldNotes error={error} hint={hint} errId={errId} hintId={hintId} />
    </div>
  );
}

/* --------------------------------------------------------------- checkbox */

export type AdminCheckboxProps = BaseProps &
  Omit<ComponentProps<"input">, "name" | "id" | "type">;

/**
 * ⚠️ 沒勾的 checkbox 不會出現在 FormData 裡。
 *    server action 要寫 `formData.get("is_published") === "on"`，
 *    不要寫 `Boolean(formData.get(...))` 之後又期待拿到 false 以外的東西。
 */
export function AdminCheckbox({
  label,
  name,
  error,
  hint,
  id,
  wrapperClassName = "",
  className = "",
  ...rest
}: AdminCheckboxProps) {
  const fieldId = id ?? `admin-${name}`;
  const errId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;

  return (
    <div className={wrapperClassName}>
      {/* 整列都是 label，點文字也能切換；min-h-11 讓手機的點擊區達 44px */}
      <label
        htmlFor={fieldId}
        className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] text-ink admin:min-h-10"
      >
        <input
          {...rest}
          id={fieldId}
          name={name}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(!!error, !!hint, errId, hintId)}
          className={`size-5 shrink-0 cursor-pointer rounded-[4px] border accent-caramel-dk disabled:cursor-not-allowed ${
            error ? "border-danger" : "border-line-input"
          } ${className}`}
        />
        <span>
          {label}
          {rest.required && (
            <>
              <span className="ml-1 text-danger" aria-hidden="true">
                ＊
              </span>
              <span className="sr-only">（必填）</span>
            </>
          )}
        </span>
      </label>
      <AdminFieldNotes error={error} hint={hint} errId={errId} hintId={hintId} />
    </div>
  );
}

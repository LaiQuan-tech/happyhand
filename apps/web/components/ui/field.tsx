"use client";

import { useId } from "react";

/**
 * 表單欄位（README §4.5）
 * label 一律置於欄位上方，不用 placeholder 當 label。
 * 欄位高 56px、radius 12px、1px #DCC29E、字 18px；錯誤 16px #B04A2F 置於欄位下方。
 */
export function Field({
  label,
  name,
  type = "text",
  required = false,
  error,
  hint,
  autoComplete,
  inputMode,
  defaultValue,
  value,
  onChange,
  as = "input",
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  autoComplete?: string;
  inputMode?: "text" | "tel" | "email" | "numeric";
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  as?: "input" | "textarea";
}) {
  const id = useId();
  const errId = `${id}-err`;
  const hintId = `${id}-hint`;
  const shared =
    "w-full rounded-input border bg-white px-[16px] text-[18px] text-brown-900 outline-none transition-colors duration-200 placeholder:text-brown-300";
  const border = error
    ? "border-error"
    : "border-sand-400 focus:border-caramel";

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-[8px] block text-[17px] leading-[1.6] text-brown-700"
      >
        {label}
        {required && (
          <span className="ml-1 text-error" aria-hidden>
            ＊
          </span>
        )}
        {required && <span className="sr-only">（必填）</span>}
      </label>

      {as === "textarea" ? (
        <textarea
          id={id}
          name={name}
          required={required}
          defaultValue={defaultValue}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={[error ? errId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(" ")}
          rows={4}
          className={`${shared} ${border} py-[14px] leading-[1.8]`}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          autoComplete={autoComplete}
          inputMode={inputMode}
          defaultValue={defaultValue}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={[error ? errId : null, hint ? hintId : null]
            .filter(Boolean)
            .join(" ")}
          className={`${shared} ${border} h-[56px]`}
        />
      )}

      {hint && !error && (
        <p id={hintId} className="mt-[6px] text-[16px] text-brown-300">
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} className="mt-[6px] text-[16px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}

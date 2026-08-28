"use client";

import { useId, useRef, useState } from "react";
import {
  MATERIAL_ACCEPT,
  MATERIAL_KIND_LABELS,
  MATERIAL_MAX_BYTES,
  formatBytes,
  type MaterialKind,
} from "@/lib/admin/materials";

/**
 * 單元的講義與插圖。
 *
 * ⚠️ 這一區的上傳與移除是**當下就生效**的，不等外層那顆「儲存變更」。
 *    原因很實際：檔案要先送到 storage 才有 id，沒辦法塞進表單一起送。
 *    所以畫面上要講清楚，不然同事上傳完按「取消」，會以為檔案沒進去。
 *
 * ⚠️ 新增的單元還沒有 id，不能掛檔案。這時候顯示提示而不是把上傳鈕
 *    做成 disabled —— disabled 的按鈕不會告訴人為什麼。
 */

export type MaterialItem = {
  id: string;
  kind: MaterialKind;
  file_name: string;
  size_bytes: number;
  caption: string | null;
  sort_order: number;
};

export function LessonMaterialsField({
  lessonId,
  kind,
  initial,
}: {
  /** 空字串 = 這一列還沒存進資料庫 */
  lessonId: string;
  kind: MaterialKind;
  initial: MaterialItem[];
}) {
  const [items, setItems] = useState<MaterialItem[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const statusId = useId();

  const label = MATERIAL_KIND_LABELS[kind];

  async function upload(file: File) {
    setError(null);
    if (file.size > MATERIAL_MAX_BYTES) {
      setError("檔案太大，單檔上限 20MB。");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("lesson_id", lessonId);
      form.set("kind", kind);
      form.set("file", file);
      const res = await fetch("/api/admin/materials", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        material?: MaterialItem;
        message?: string;
      };
      if (!res.ok || !data.material) {
        setError(data.message ?? "上傳失敗，請重試一次。");
        return;
      }
      setItems((cur) => [...cur, data.material!]);
    } catch {
      setError("網路好像不太穩，請重試一次。");
    } finally {
      setBusy(false);
      // 同一個檔案再選一次也要能觸發 change
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`確定要移除「${name}」嗎？移除後學員就看不到了。`)) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/materials", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        setError(data.message ?? "移除失敗，請重試一次。");
        return;
      }
      setItems((cur) => cur.filter((m) => m.id !== id));
    } catch {
      setError("網路好像不太穩，請重試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin:col-span-2">
      <p className="text-[14px] font-medium text-ink">{label}</p>

      {items.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {items.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-input border border-line bg-panel px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                {m.file_name}
              </span>
              <span className="shrink-0 text-[13px] text-ink-soft">
                {formatBytes(m.size_bytes)}
              </span>
              <button
                type="button"
                onClick={() => void remove(m.id, m.file_name)}
                disabled={busy}
                className="min-h-9 shrink-0 rounded-input px-2.5 text-[13px] text-danger transition-colors hover:bg-cream-300 disabled:text-ink-muted"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}

      {lessonId === "" ? (
        <p className="mt-2 text-[13px] text-ink-soft">
          先按上面的「儲存變更」把這個單元存起來，才能上傳{label}。
        </p>
      ) : (
        <div className="mt-2">
          {/* 沒有 name：這個 input 不可以跟著外層表單一起送出去 */}
          <input
            ref={inputRef}
            type="file"
            accept={MATERIAL_ACCEPT[kind]}
            disabled={busy}
            aria-describedby={statusId}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
            className="block w-full text-[14px] text-ink-soft file:mr-3 file:min-h-11 file:cursor-pointer file:rounded-input file:border file:border-line-input file:bg-paper file:px-4 file:text-[14px] file:text-ink hover:file:border-line-strong"
          />
          <p id={statusId} className="mt-1.5 text-[13px] text-ink-soft">
            {busy
              ? "上傳中…"
              : kind === "file"
                ? "只收 PDF，單檔上限 20MB。選好檔案就會立刻上傳，不用等「儲存變更」。"
                : "JPG、PNG、WebP，單檔上限 20MB。選好圖片就會立刻上傳。"}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

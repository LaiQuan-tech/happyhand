"use client";

import { useId, useState } from "react";
import type { Lesson } from "@/lib/content";
import { formatDuration } from "./format";

const INITIAL_COUNT = 4;

/**
 * 單元列表 accordion（設計稿 365–383 桌機、431–445 手機）
 * 預設顯示 4 堂，其餘收在「展開其餘 N 堂」後面。
 */
export function LessonList({ lessons }: { lessons: Lesson[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();

  const rest = Math.max(0, lessons.length - INITIAL_COUNT);
  const visible = open ? lessons : lessons.slice(0, INITIAL_COUNT);

  return (
    <div className="mt-[14px] border-t border-sand-300 md:mt-[18px]">
      <ol id={listId}>
        {visible.map((lesson, i) => (
          <li
            key={`${lesson.title}-${i}`}
            className="flex items-center justify-between gap-[12px] border-b border-sand-300 px-[20px] py-[18px] md:px-[24px] md:py-[20px]"
          >
            <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[6px] md:gap-x-[14px]">
              <span
                aria-hidden
                className="font-serif text-[16px] text-brown-300 md:text-[18px]"
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[17px] leading-[1.5] text-brown-900 md:text-[18px]">
                {lesson.title}
              </span>
              {lesson.free_preview ? (
                <span className="rounded-pill bg-caramel-dk px-[12px] py-[4px] text-[16px] leading-[1.4] text-white">
                  可試看
                </span>
              ) : null}
            </div>
            <span className="shrink-0 text-[16px] text-brown-300">
              {formatDuration(lesson.duration_sec)}
            </span>
          </li>
        ))}
      </ol>

      {rest > 0 ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={listId}
            className="inline-flex min-h-[56px] items-center gap-[8px] px-[12px] text-[17px] text-brown-900 transition-colors duration-200 hover:text-caramel-dk"
          >
            <span className="border-b border-caramel pb-[4px]">
              {open ? "收合單元列表" : `展開其餘 ${rest} 堂`}
            </span>
            <span
              aria-hidden
              className="text-caramel-ink transition-transform duration-200"
              style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              ▾
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

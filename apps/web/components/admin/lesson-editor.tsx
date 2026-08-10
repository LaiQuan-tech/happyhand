"use client";

import { useActionState, useState } from "react";
import { saveLessons, type LessonSaveState } from "@/app/admin/products/actions";
import { splitDuration, type LessonRow } from "@/app/admin/products/shared";
import { youTubeWatchUrl } from "@/lib/youtube";
import {
  AdminFieldLabel,
  adminBorderClass,
  adminControlClass,
  adminControlHeight,
} from "@/components/admin/admin-field";

/**
 * 課程單元編輯器。
 *
 * 這是整個課程後台唯一真的需要 client state 的地方：
 * 上移／下移是「重新安排順序」，不重排 DOM 的話使用者要自己在腦中
 * 把數字對到內容。所以這支有 "use client"。
 *
 * 三個關鍵設計：
 *
 * 1. **整批送出，順序由位置決定**。表單欄位命名是 `lessons.{索引}.{欄位}`，
 *    索引來自陣列位置，不是使用者填的數字。這樣就不存在
 *    「兩個單元都寫第 3 課」這種第二個真相來源。
 *
 * 2. **索引命名而不是同名多值**。沒勾的 checkbox 根本不會出現在 FormData 裡，
 *    所以 getAll("free_preview") 拿到的陣列會比其他欄位短，
 *    對齊之後第 3 課的「可試看」會跑到第 5 課身上。索引命名不會有這個問題。
 *
 * 3. **輸入框全部非受控，只有「有哪幾列、什麼順序」是 state**。
 *    每一列的 key 綁 rowKey（穩定），所以上下移動時 React 是搬 DOM 節點，
 *    使用者已經打到一半的字會跟著走，不會被清空。
 *
 * 🔴 刪除單元會連帶刪掉那個單元的 lesson_progress（on delete cascade），
 *    也就是所有學員看到第幾分鐘的紀錄。所以移除鈕一定要二次確認。
 */

type Row = {
  /** React key。穩定不變，用來讓輸入框跟著列一起移動。 */
  rowKey: string;
  /** 資料庫 id，新增的列是空字串 */
  id: string;
  title: string;
  min: number;
  sec: number;
  /** 完整的 YouTube 網址（存的是 11 碼 ID，這裡回填成網址方便同事點開確認） */
  youtubeUrl: string;
  freePreview: boolean;
};

function toRow(lesson: LessonRow): Row {
  const { min, sec } = splitDuration(lesson.duration_sec);
  return {
    rowKey: lesson.id,
    id: lesson.id,
    title: lesson.title,
    min,
    sec,
    youtubeUrl: lesson.youtube_id ? youTubeWatchUrl(lesson.youtube_id) : "",
    freePreview: lesson.free_preview,
  };
}

let newRowSeq = 0;
function blankRow(): Row {
  newRowSeq += 1;
  return {
    rowKey: `new-${newRowSeq}`,
    id: "",
    title: "",
    min: 0,
    sec: 0,
    youtubeUrl: "",
    freePreview: false,
  };
}

export function LessonEditor({
  productId,
  lessons,
}: {
  productId: string;
  lessons: LessonRow[];
}) {
  const [rows, setRows] = useState<Row[]>(() => lessons.map(toRow));
  const [state, formAction, pending] = useActionState<LessonSaveState, FormData>(
    saveLessons.bind(null, productId),
    null,
  );

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    setRows((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function remove(index: number) {
    const row = rows[index];
    // 已經存在資料庫的單元才有學員進度可以損失。新增但還沒存的列直接移除就好。
    if (row.id) {
      const ok = window.confirm(
        `確定要移除「${row.title || "未命名單元"}」嗎？\n\n` +
          "按下方「儲存單元」之後，這個單元會從資料庫刪除，" +
          "所有學員在這個單元的觀看進度也會一併消失，而且無法復原。",
      );
      if (!ok) return;
    }
    setRows((current) => current.filter((_, i) => i !== index));
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="lesson_count" value={rows.length} />

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-panel px-4 py-6 text-center text-[14px] text-ink-soft">
          這門課還沒有任何單元。點下面的「新增單元」開始建立。
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li
              key={row.rowKey}
              className="rounded-card border border-line bg-paper p-3.5 admin:p-4"
            >
              <input type="hidden" name={`lessons.${index}.id`} value={row.id} />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-soft">
                  第 {index + 1} 個單元
                  {!row.id && (
                    <span className="ml-2 text-accent-ink">（尚未儲存）</span>
                  )}
                </span>

                <div className="flex items-center gap-1.5">
                  <MoveButton
                    direction="up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                    label={`把第 ${index + 1} 個單元往上移`}
                  />
                  <MoveButton
                    direction="down"
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                    label={`把第 ${index + 1} 個單元往下移`}
                  />
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="inline-flex min-h-11 items-center rounded-input border border-danger px-3 text-[13px] font-medium text-danger transition-colors hover:bg-danger hover:text-paper admin:min-h-9"
                  >
                    移除
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 admin:grid-cols-[minmax(0,1fr)_auto]">
                <div>
                  <AdminFieldLabel htmlFor={`lesson-title-${row.rowKey}`}>
                    單元標題
                  </AdminFieldLabel>
                  <input
                    id={`lesson-title-${row.rowKey}`}
                    name={`lessons.${index}.title`}
                    defaultValue={row.title}
                    required
                    maxLength={200}
                    className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass()}`}
                  />
                </div>

                {/*
                  時長拆成分 + 秒兩格。一格填秒數的話，
                  「12 分 30 秒」要員工自己心算成 750，很容易少打一個 0。
                */}
                <fieldset className="min-w-0">
                  <legend className="mb-1.5 block text-[14px] leading-snug font-medium text-ink">
                    時長
                  </legend>
                  <div className="flex items-center gap-2">
                    <input
                      name={`lessons.${index}.min`}
                      type="number"
                      min={0}
                      step={1}
                      defaultValue={row.min}
                      aria-label="分鐘"
                      className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass()} w-20`}
                    />
                    <span className="text-[14px] text-ink-soft">分</span>
                    <input
                      name={`lessons.${index}.sec`}
                      type="number"
                      min={0}
                      max={59}
                      step={1}
                      defaultValue={row.sec}
                      aria-label="秒"
                      className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass()} w-20`}
                    />
                    <span className="text-[14px] text-ink-soft">秒</span>
                  </div>
                </fieldset>

                <div className="admin:col-span-2">
                  <AdminFieldLabel htmlFor={`lesson-video-${row.rowKey}`}>
                    YouTube 影片網址
                  </AdminFieldLabel>
                  <input
                    id={`lesson-video-${row.rowKey}`}
                    name={`lessons.${index}.youtube_url`}
                    defaultValue={row.youtubeUrl}
                    maxLength={500}
                    inputMode="url"
                    placeholder="留空代表還沒上片"
                    aria-describedby={`lesson-video-hint-${row.rowKey}`}
                    className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass()}`}
                  />
                  {/* 這一段是給上片的同事看的，不是裝飾。
                      影片設成「公開」的話搜尋得到，付費內容等於免費送；
                      設成「私人」則無法嵌入，學員一定看不到。
                      沒有任何程式碼檢查得到這件事，只能靠寫在他眼前。 */}
                  <p
                    id={`lesson-video-hint-${row.rowKey}`}
                    className="mt-1.5 text-[13px] leading-relaxed text-ink-soft"
                  >
                    整條網址貼上來就好（watch?v=、youtu.be、shorts 都可以）。
                    <br />
                    <strong className="text-danger">
                      影片在 YouTube 上必須設成「不公開」
                    </strong>
                    ——設成「公開」的話任何人搜尋得到，設成「私人」的話學員會看不到。
                  </p>
                </div>

                <label
                  htmlFor={`lesson-free-${row.rowKey}`}
                  className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px] text-ink admin:col-span-2 admin:min-h-10"
                >
                  <input
                    id={`lesson-free-${row.rowKey}`}
                    name={`lessons.${index}.free_preview`}
                    type="checkbox"
                    defaultChecked={row.freePreview}
                    className="size-5 shrink-0 cursor-pointer rounded-[4px] border border-line-input accent-caramel-dk"
                  />
                  <span>可免費試看（沒買課的人也看得到）</span>
                </label>
              </div>
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setRows((current) => [...current, blankRow()])}
          className="inline-flex min-h-11 items-center justify-center rounded-input border border-line-input bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:bg-panel admin:min-h-10"
        >
          新增單元
        </button>

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-input bg-accent-ink px-5 text-[15px] font-medium text-paper transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-55 admin:min-h-10"
        >
          {pending ? "儲存中…" : "儲存單元"}
        </button>

        {/* 順序與刪除都只存在瀏覽器裡，沒按儲存就重新整理會全部回到原狀。
            不講的話使用者會以為排好就生效了。 */}
        <p className="text-[13px] text-ink-soft">
          調整順序、新增與移除都要按「儲存單元」才會寫進資料庫。
        </p>
      </div>

      {state?.error && (
        <p role="alert" className="text-[14px] leading-snug text-danger">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-[14px] leading-snug text-ok">
          {state.ok}
        </p>
      )}
    </form>
  );
}

function MoveButton({
  direction,
  disabled,
  onClick,
  label,
}: {
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      // 箭頭是裝飾，真正的名字給螢幕閱讀器讀：
      // 只有一個「↑」的按鈕在無障礙樹裡叫做「向上箭頭」，等於沒有名字。
      aria-label={label}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-input border border-line-input bg-paper text-[15px] text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40 admin:min-h-9 admin:min-w-9"
    >
      <span aria-hidden="true">{direction === "up" ? "↑" : "↓"}</span>
    </button>
  );
}

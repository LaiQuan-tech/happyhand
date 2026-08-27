"use client";

import { useActionState, useState } from "react";
import { saveBlocks, type BlockSaveState } from "@/app/admin/products/actions";
import type { BlockRow } from "@/app/admin/products/shared";
import {
  AdminFieldLabel,
  adminBorderClass,
  adminControlClass,
  adminControlHeight,
} from "@/components/admin/admin-field";

/**
 * 內容區塊編輯器（FAQ、學習路徑、報名資訊、費用方案、特色說明）。
 *
 * 一個元件吃 `kind` 參數重用於五種區塊 —— 它們的差別只有標籤文字，
 * 以及費用方案多了金額欄位。為每一種各寫一份會有五份要同步維護。
 *
 * 結構完全照 lesson-editor.tsx，三個關鍵設計原封不動搬過來：
 *
 * 1. **整批送出，順序由陣列位置決定**（欄位名 `blocks.{索引}.{欄位}`），
 *    不存在「兩列都寫第 3 個」這種第二個真相來源。
 * 2. **索引命名而不是同名多值**：空欄位在 FormData 裡的行為不一致，
 *    用 getAll() 對齊會整排錯位。
 * 3. **輸入框全部非受控，只有「有哪幾列、什麼順序」是 state**，
 *    每列 key 綁 rowKey（穩定），上下移動時 React 搬 DOM 節點，
 *    使用者打到一半的字會跟著走。
 *
 * 跟 lesson-editor 的差別：移除這裡的列**不會**牽連學員資料
 *（product_blocks 沒有任何東西外鍵參照它），所以不需要二次確認。
 */

type Row = {
  /** React key。穩定不變，讓輸入框跟著列一起移動。 */
  rowKey: string;
  /** 資料庫 id；新增的列是空字串 */
  id: string;
  title: string;
  body: string;
  amount: string;
  note: string;
};

/** 每種區塊的文案。改這裡就好，不要在 JSX 裡塞 kind 判斷。 */
const KIND_CONFIG: Record<
  string,
  {
    label: string;
    unit: string;
    titleLabel: string;
    bodyLabel: string;
    bodyRows: number;
    addLabel: string;
    titleHint?: string;
    bodyHint?: string;
    hasAmount?: boolean;
    empty: string;
  }
> = {
  faq: {
    label: "常見問題",
    unit: "題",
    addLabel: "新增一題",
    titleLabel: "問題",
    bodyLabel: "回答",
    bodyRows: 4,
    titleHint: "用客人會問的話寫，例如「沒有任何基礎，可以上嗎？」",
    empty: "還沒有常見問題。點「新增一題」開始建立。",
  },
  step: {
    label: "學習路徑",
    unit: "個階段",
    addLabel: "新增一個階段",
    titleLabel: "階段名稱",
    bodyLabel: "說明",
    bodyRows: 3,
    titleHint: "例如「觀看與理解」。前台會自動編號 01、02…",
    empty: "還沒有學習路徑。點「新增一個階段」開始建立。",
  },
  info_row: {
    label: "報名資訊",
    unit: "列",
    addLabel: "新增一列",
    titleLabel: "項目",
    bodyLabel: "內容",
    bodyRows: 2,
    titleHint: "例如「課程費用」「上課地點」「付款方式」。",
    empty: "還沒有報名資訊。點「新增一列」開始建立。",
  },
  pricing: {
    label: "費用方案",
    unit: "個方案",
    addLabel: "新增一個方案",
    titleLabel: "方案名稱",
    bodyLabel: "方案說明",
    bodyRows: 3,
    titleHint: "例如「新生」「複訓生方案」。",
    hasAmount: true,
    empty: "還沒有費用方案。點「新增一個方案」開始建立。",
  },
  feature: {
    label: "特色說明",
    unit: "項",
    addLabel: "新增一項",
    titleLabel: "標題",
    bodyLabel: "說明",
    bodyRows: 3,
    empty: "還沒有特色說明。點「新增一項」開始建立。",
  },
};

let seq = 0;
function blankRow(): Row {
  seq += 1;
  return { rowKey: `new-${seq}`, id: "", title: "", body: "", amount: "", note: "" };
}

function toRow(b: BlockRow): Row {
  const meta = (b.meta ?? {}) as { amount?: unknown; note?: unknown };
  return {
    rowKey: b.id,
    id: b.id,
    title: b.title ?? "",
    body: b.body ?? "",
    amount:
      typeof meta.amount === "number" ? String(meta.amount) : "",
    note: typeof meta.note === "string" ? meta.note : "",
  };
}

export function BlockEditor({
  productId,
  kind,
  blocks,
}: {
  productId: string;
  kind: string;
  blocks: BlockRow[];
}) {
  const cfg = KIND_CONFIG[kind];
  const [rows, setRows] = useState<Row[]>(() => blocks.map(toRow));
  const [state, formAction, pending] = useActionState<BlockSaveState, FormData>(
    saveBlocks.bind(null, productId, kind),
    null,
  );

  if (!cfg) return null;

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;
    setRows((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="block_count" value={rows.length} />

      {rows.length === 0 ? (
        <p className="rounded-card border border-line bg-panel px-4 py-6 text-center text-[14px] text-ink-soft">
          {cfg.empty}
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <li
              key={row.rowKey}
              className="rounded-card border border-line bg-paper p-3.5 admin:p-4"
            >
              <input type="hidden" name={`blocks.${index}.id`} value={row.id} />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-medium text-ink-soft">
                  第 {index + 1} {cfg.unit}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`往上移第 ${index + 1} ${cfg.unit}`}
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-input border border-line-input bg-paper text-[15px] text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === rows.length - 1}
                    aria-label={`往下移第 ${index + 1} ${cfg.unit}`}
                    className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-input border border-line-input bg-paper text-[15px] text-ink transition-colors hover:bg-panel disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRows((current) => current.filter((_, i) => i !== index))
                    }
                    aria-label={`移除第 ${index + 1} ${cfg.unit}`}
                    className="inline-flex min-h-9 items-center justify-center rounded-input border border-line-input bg-paper px-3 text-[14px] text-danger transition-colors hover:bg-panel"
                  >
                    移除
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <AdminFieldLabel htmlFor={`block-title-${row.rowKey}`}>
                    {cfg.titleLabel}
                  </AdminFieldLabel>
                  <input
                    id={`block-title-${row.rowKey}`}
                    name={`blocks.${index}.title`}
                    defaultValue={row.title}
                    maxLength={300}
                    className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass()}`}
                  />
                  {cfg.titleHint && (
                    <p className="mt-1 text-[13px] text-ink-soft">{cfg.titleHint}</p>
                  )}
                </div>

                <div>
                  <AdminFieldLabel htmlFor={`block-body-${row.rowKey}`}>
                    {cfg.bodyLabel}
                  </AdminFieldLabel>
                  <textarea
                    id={`block-body-${row.rowKey}`}
                    name={`blocks.${index}.body`}
                    defaultValue={row.body}
                    rows={cfg.bodyRows}
                    maxLength={4000}
                    className={`${adminControlClass} ${adminBorderClass()} py-2`}
                  />
                </div>

                {cfg.hasAmount && (
                  <div className="grid grid-cols-1 gap-3 admin:grid-cols-2">
                    <div>
                      <AdminFieldLabel htmlFor={`block-amount-${row.rowKey}`}>
                        金額
                      </AdminFieldLabel>
                      <input
                        id={`block-amount-${row.rowKey}`}
                        name={`blocks.${index}.amount`}
                        type="number"
                        min={0}
                        step={1}
                        defaultValue={row.amount}
                        className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass()}`}
                      />
                      <p className="mt-1 text-[13px] text-ink-soft">
                        留空就不顯示金額，只顯示方案說明。
                      </p>
                    </div>
                    <div>
                      <AdminFieldLabel htmlFor={`block-note-${row.rowKey}`}>
                        附註
                      </AdminFieldLabel>
                      <input
                        id={`block-note-${row.rowKey}`}
                        name={`blocks.${index}.note`}
                        defaultValue={row.note}
                        maxLength={300}
                        className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass()}`}
                      />
                    </div>
                  </div>
                )}
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
          {cfg.addLabel}
        </button>

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-11 items-center justify-center rounded-input bg-accent-ink px-5 text-[15px] font-medium text-paper transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-55 admin:min-h-10"
        >
          {pending ? "儲存中…" : `儲存${cfg.label}`}
        </button>

        {/* 順序與刪除都只存在瀏覽器裡，沒按儲存就重新整理會全部回到原狀。 */}
        <p className="text-[13px] text-ink-soft">
          調整順序、新增與移除都要按「儲存{cfg.label}」才會寫進資料庫。
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

/**
 * product_blocks 的排序寫入計畫。
 *
 * 這是 lesson-plan.ts 的姊妹檔，**刻意抄一份而不是把那支通用化**：
 * 那支管的是學員進度所依附的 course_lessons，已經驗證過也踩過雷，
 * 為了共用而動它的簽名不划算。兩支的差別只有表名、父鍵與內容欄位。
 * 改其中一支的演算法時，另一支通常也要跟著改。
 *
 * ─────────────────────────────────────────────
 * 為什麼要兩階段 PARK → FINAL
 * ─────────────────────────────────────────────
 * product_blocks 有 `unique (product_id, kind, sort_order)`。
 * 兩個天真的做法都會壞：
 *
 *   1. 逐筆 update 成目標值：把 [1,2,3] 排成 [3,2,1]，第一步就撞 23505。
 *      **不存在「剛好不會撞」的順序** —— 任何非恆等排列一定有某一步的目標值
 *      還被別人佔著。
 *   2. delete 全部再 insert：id 會全換，而且未來若有東西外鍵參照就會炸。
 *
 * 所以先把要保留的列搬到一段沒人用的高號碼（PARK），再寫入真正的值（FINAL）。
 *
 * ⚠️ 與 lesson-plan 的關鍵差異：這裡的唯一鍵含 kind，所以**一次只處理一種 kind**，
 *    offset 也只需要高過「同一個 kind 內」的最大值。
 *
 * 刻意純函式、零 import：好測，也不會把 supabase 型別拖進來。
 */

export type ExistingBlock = { id: string; sort_order: number };

export type SubmittedBlock = {
  /** 空字串 = 新增的列 */
  id: string;
  title: string | null;
  body: string | null;
  meta: Record<string, unknown>;
};

export type BlockWrite = {
  id: string;
  title: string | null;
  body: string | null;
  meta: Record<string, unknown>;
  sort_order: number;
};

export type BlockPlan = {
  deleteIds: string[];
  park: { id: string; sort_order: number }[];
  update: BlockWrite[];
  insert: Omit<BlockWrite, "id">[];
  /** 送上來但資料庫找不到的 id。呼叫端要據此擋下整批（樂觀鎖）。 */
  unknownIds: string[];
};

export function planBlockWrites(
  existing: readonly ExistingBlock[],
  submitted: readonly SubmittedBlock[],
): BlockPlan {
  const existingById = new Map(existing.map((r) => [r.id, r]));

  const unknownIds = submitted
    .map((r) => r.id)
    .filter((id) => id !== "" && !existingById.has(id));

  const keptIds = new Set(
    submitted.map((r) => r.id).filter((id) => id !== "" && existingById.has(id)),
  );

  const deleteIds = existing.filter((r) => !keptIds.has(r.id)).map((r) => r.id);

  // offset 要同時高過「現在佔用的最大值」與「等一下要寫的最大值」，
  // 少比其中一個都可能在該階段撞到。
  const maxExisting = existing.reduce((m, r) => Math.max(m, r.sort_order), 0);
  const offset = Math.max(maxExisting, submitted.length) + 1;

  // PARK 只搬要保留的列 —— 要刪的那些等一下就不見了，多搬一趟沒意義。
  const park = existing
    .filter((r) => keptIds.has(r.id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r, i) => ({ id: r.id, sort_order: offset + i }));

  const update: BlockWrite[] = [];
  const insert: Omit<BlockWrite, "id">[] = [];

  submitted.forEach((row, index) => {
    // sort_order 由陣列位置推導，**刻意不讀表單送上來的 sort_order**：
    // 那是畫面狀態，會變成第二個真相來源。
    const payload = {
      title: row.title,
      body: row.body,
      meta: row.meta,
      sort_order: index + 1,
    };
    if (row.id !== "" && existingById.has(row.id)) {
      update.push({ id: row.id, ...payload });
    } else if (row.id === "") {
      insert.push(payload);
    }
    // id 認不得的落在 unknownIds，由呼叫端擋下整批，不在這裡默默新增一列。
  });

  return { deleteIds, park, update, insert, unknownIds };
}

/* ------------------------------------------------------------------ 執行 */

/** 只描述我們用到的最小介面，讓這支不必 import supabase 型別。 */
export type BlockWriteClient = {
  from: (table: string) => {
    delete: () => {
      in: (col: string, values: string[]) => PromiseLike<{ error: unknown }>;
    };
    update: (values: Record<string, unknown>) => {
      eq: (col: string, value: string) => PromiseLike<{ error: unknown }>;
    };
    insert: (rows: Record<string, unknown>[]) => PromiseLike<{ error: unknown }>;
  };
};

export type BlockWriteFailure = {
  stage: "delete" | "park" | "final" | "insert";
} | null;

/**
 * 四個步驟的順序本身就是正確性的一部分：
 *   delete 要在 park 之前（少搬一趟）
 *   insert 一定要在 park 之後（否則新列的號碼可能還被舊列佔著）
 *
 * 逐列 update 而不是整批 upsert 是刻意的：upsert 走 INSERT ... ON CONFLICT，
 * 萬一某個 id 已經被別人刪掉，語意會從「更新失敗」變成「悄悄新增一列」。
 */
export async function applyBlockPlan(
  db: BlockWriteClient,
  productId: string,
  kind: string,
  plan: BlockPlan,
): Promise<BlockWriteFailure> {
  if (plan.deleteIds.length > 0) {
    const { error } = await db
      .from("product_blocks")
      .delete()
      .in("id", plan.deleteIds);
    if (error) return { stage: "delete" };
  }

  for (const row of plan.park) {
    const { error } = await db
      .from("product_blocks")
      .update({ sort_order: row.sort_order })
      .eq("id", row.id);
    if (error) return { stage: "park" };
  }

  for (const row of plan.update) {
    const { error } = await db
      .from("product_blocks")
      .update({
        title: row.title,
        body: row.body,
        meta: row.meta,
        sort_order: row.sort_order,
      })
      .eq("id", row.id);
    if (error) return { stage: "final" };
  }

  if (plan.insert.length > 0) {
    const { error } = await db.from("product_blocks").insert(
      plan.insert.map((row) => ({
        product_id: productId,
        kind,
        title: row.title,
        body: row.body,
        meta: row.meta,
        sort_order: row.sort_order,
      })),
    );
    if (error) return { stage: "insert" };
  }

  return null;
}

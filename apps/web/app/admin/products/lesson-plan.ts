/**
 * 單元重排的寫入計畫。
 *
 * 🔴 這支存在的唯一理由是 course_lessons 上的
 *    `course_lessons_product_sort_key unique (product_id, sort_order)`。
 *
 * 兩個天真的做法都會壞：
 *
 * 1. 一筆一筆 update 成目標值 —— 把 [1,2,3] 排成 [3,2,1] 時，
 *    第一筆要從 1 改成 3，但 3 還被別人佔著，直接撞 23505。
 *    順序換一下也只是換個撞的時機，不存在「剛好不會撞」的順序：
 *    任何排列只要不是恆等，就一定有某一步的目標值仍被佔用。
 *
 * 2. 先 delete 再 insert —— 唯一約束確實不會撞了，但
 *    lesson_progress.lesson_id 是 `on delete cascade`，
 *    這會把所有學員看到第幾分鐘的紀錄一起洗掉。
 *    對已經賣出去的課來說這是不可逆的資料損失。
 *
 * 所以是兩階段搬移，而且全程用 UPDATE（id 不變）：
 *
 *   Phase PARK  把所有要保留的列搬到 offset 之上的一段空號
 *   Phase FINAL 再從空號搬回 1..N 的目標值
 *
 * offset 取 `max(現有最大值, 目標最大值) + 1`，所以
 * PARK 的目標區間整段都在「現在有人佔的值」與「等一下要用的值」之上，
 * 兩個階段各自都不會有任何一步撞到 —— 連瞬間衝突都沒有，
 * 因此不需要 DEFERRABLE 約束（Postgres 的 unique 約束預設是逐列即時檢查，
 * 一句 UPDATE 影響多列時中途撞到照樣會 raise）。
 *
 * 這支刻意是純函式、零 import：
 * actions.ts 拿它去打資料庫，驗收腳本也拿同一支去打正式資料庫，
 * 測到的才會是真的會上線的那段邏輯，而不是另外寫一份長得像的。
 */

/** 資料庫現有的一列（只取排序需要的欄位） */
export type ExistingLesson = {
  id: string;
  sort_order: number;
};

/** 表單送上來的一列。id 為空字串代表這是新增的單元。 */
export type SubmittedLesson = {
  id: string;
  title: string;
  duration_sec: number | null;
  youtube_id: string | null;
  free_preview: boolean;
};

export type LessonPlan = {
  /** 要刪掉的既有 id（使用者在畫面上移除的那些） */
  deleteIds: string[];
  /** Phase 1：把保留的列搬到空號區。只帶 id 與 sort_order。 */
  park: { id: string; sort_order: number }[];
  /** Phase 2：既有列的最終內容與位置 */
  update: {
    id: string;
    title: string;
    duration_sec: number | null;
    youtube_id: string | null;
    free_preview: boolean;
    sort_order: number;
  }[];
  /** Phase 2：新增的列（沒有 id，交給資料庫產生） */
  insert: {
    title: string;
    duration_sec: number | null;
    youtube_id: string | null;
    free_preview: boolean;
    sort_order: number;
  }[];
  /** 送上來的 id 有哪些在資料庫裡找不到（表單過期或被動過手腳） */
  unknownIds: string[];
};

/**
 * 算出「現況 -> 送出的內容」需要做哪些寫入。
 *
 * submitted 的**陣列順序就是最終順序**，第 i 筆拿到 sort_order = i + 1。
 * 刻意不讀表單送上來的 sort_order 數字：那是畫面狀態，
 * 使用者按上下移動時很容易送出重複值，由位置推導才不會有第二個真相來源。
 */
export function planLessonWrites(
  existing: readonly ExistingLesson[],
  submitted: readonly SubmittedLesson[],
): LessonPlan {
  const existingById = new Map(existing.map((row) => [row.id, row]));

  const unknownIds = submitted
    .map((row) => row.id)
    .filter((id) => id !== "" && !existingById.has(id));

  const keptIds = new Set(
    submitted.map((row) => row.id).filter((id) => id !== "" && existingById.has(id)),
  );

  const deleteIds = existing.filter((row) => !keptIds.has(row.id)).map((row) => row.id);

  // offset 必須同時高過「現在佔用的最大值」與「等一下要寫的最大值」，
  // 少比其中一個都可能在該階段撞到。
  const maxExisting = existing.reduce((max, row) => Math.max(max, row.sort_order), 0);
  const offset = Math.max(maxExisting, submitted.length) + 1;

  // PARK 只搬要保留的列。要刪的那些等一下就不見了，多搬一趟沒有意義。
  // 依現有 sort_order 排一下只是為了讓 log 好讀，正確性不依賴這個順序。
  const park = existing
    .filter((row) => keptIds.has(row.id))
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row, index) => ({ id: row.id, sort_order: offset + index }));

  const update: LessonPlan["update"] = [];
  const insert: LessonPlan["insert"] = [];

  submitted.forEach((row, index) => {
    const sortOrder = index + 1;
    const payload = {
      title: row.title,
      duration_sec: row.duration_sec,
      youtube_id: row.youtube_id,
      free_preview: row.free_preview,
      sort_order: sortOrder,
    };
    if (row.id !== "" && existingById.has(row.id)) {
      update.push({ id: row.id, ...payload });
    } else if (row.id === "") {
      insert.push(payload);
    }
    // id 認不得的那些落在 unknownIds，由呼叫端擋下整批，不在這裡默默新增一列。
  });

  return { deleteIds, park, update, insert, unknownIds };
}

/* ------------------------------------------------------------------ 執行 */

/**
 * 打資料庫用的最小介面。
 *
 * 刻意不 import supabase 的型別：這支要能被驗收腳本用 node 直接載入
 * （node --experimental-strip-types 不認得 `@/` 路徑別名）。
 * 用結構型別描述「我會呼叫哪幾個方法」就夠了，
 * service client 本來就滿足這個形狀。
 */
export type LessonWriteClient = {
  from(table: string): {
    delete(): {
      in(column: string, values: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { message: string } | null }>;
    };
    insert(values: Record<string, unknown>[]): PromiseLike<{ error: { message: string } | null }>;
  };
};

/** 失敗時回一個代碼，由呼叫端翻成中文（這支不決定使用者看到什麼字） */
export type LessonWriteFailure = {
  stage: "delete" | "park" | "update" | "insert";
  message: string;
};

/**
 * 照計畫把單元寫進資料庫。
 *
 * 🔴 四個步驟的**順序是正確性的一部分**，不是風格問題：
 *    delete 要在 park 之前（少搬一趟已經不要的列），
 *    park 一定要在 update 與 insert 之前（1..N 這段要先空出來），
 *    insert 一定要在 park 之後（否則新列會撞到還沒搬走的舊列）。
 *
 * 所以這段被抽成函式而不是留在 server action 裡：
 * 驗收腳本跑的必須是「真的會上線的那個順序」，
 * 而不是另外寫一份長得很像、但某兩步剛好對調的複製品。
 *
 * 逐列 update 而不是整批 upsert 是刻意的：upsert 會走
 * INSERT ... ON CONFLICT，萬一某個 id 剛好被別人刪掉，
 * 語意會從「更新失敗」變成「悄悄新增一列」。
 */
export async function applyLessonPlan(
  db: LessonWriteClient,
  productId: string,
  plan: LessonPlan,
): Promise<LessonWriteFailure | null> {
  if (plan.deleteIds.length > 0) {
    const { error } = await db.from("course_lessons").delete().in("id", plan.deleteIds);
    if (error) return { stage: "delete", message: error.message };
  }

  for (const row of plan.park) {
    const { error } = await db
      .from("course_lessons")
      .update({ sort_order: row.sort_order })
      .eq("id", row.id);
    if (error) return { stage: "park", message: error.message };
  }

  for (const row of plan.update) {
    const { error } = await db
      .from("course_lessons")
      .update({
        title: row.title,
        duration_sec: row.duration_sec,
        youtube_id: row.youtube_id,
        free_preview: row.free_preview,
        sort_order: row.sort_order,
      })
      .eq("id", row.id);
    if (error) return { stage: "update", message: error.message };
  }

  if (plan.insert.length > 0) {
    const { error } = await db
      .from("course_lessons")
      .insert(plan.insert.map((row) => ({ ...row, product_id: productId })));
    if (error) return { stage: "insert", message: error.message };
  }

  return null;
}

/**
 * 記憶體去重（in-memory dedupe）。
 *
 * ⚠️⚠️ 這是有意識留下的暫時方案，不是完整解法。⚠️⚠️
 *
 * 用途：避免「同一場次、同一提醒階段」重複寄信。
 * 作法：以 `session_id + stage` 為 key 記在 process 記憶體裡。
 *
 * 已知限制（正式上線前必須處理）：
 *   1. **process 重啟就忘光**。Railway 每次 deploy、crash restart、
 *      或平台搬遷 instance 都會清空 → 當天已寄過的提醒會再寄一次。
 *   2. **不支援多副本**。worker 若擴成 2 個 replica，兩邊各有一份記憶體，
 *      同一封信會寄兩次。
 *
 * 正式解法：建一張 `notification_log(session_id, stage, sent_at)` 表，
 * 對 `(session_id, stage)` 下 unique constraint，寄信前先 insert，
 * 撞到 unique violation 就代表別人已經寄過 → 跳過。
 * 這樣重啟與多副本都安全。詳見 README「已知限制」。
 */

const DEFAULT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 天：涵蓋 3 天前提醒到開課後的區間

export interface DedupeStore {
  /**
   * 若 key 尚未標記過則標記並回傳 true（代表「這次該做」）；
   * 已標記過則回傳 false。
   */
  claim(key: string): boolean;
  /** 只查詢不標記。 */
  has(key: string): boolean;
  /** 清掉過期項目，回傳清掉幾筆。 */
  prune(): number;
  /** 目前保存的 key 數量（給 /healthz 觀察用）。 */
  size(): number;
}

export function createDedupeStore(ttlMs: number = DEFAULT_TTL_MS): DedupeStore {
  /** key → 過期時間（epoch ms） */
  const entries = new Map<string, number>();

  function prune(now: number = Date.now()): number {
    let removed = 0;
    for (const [key, expiresAt] of entries) {
      if (expiresAt <= now) {
        entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  return {
    claim(key: string): boolean {
      const now = Date.now();
      const expiresAt = entries.get(key);
      if (expiresAt !== undefined && expiresAt > now) return false;
      entries.set(key, now + ttlMs);
      return true;
    },
    has(key: string): boolean {
      const expiresAt = entries.get(key);
      return expiresAt !== undefined && expiresAt > Date.now();
    },
    prune: () => prune(),
    size: () => entries.size,
  };
}

/** 提醒階段：開課前 3 天 / 前 1 天。 */
export type ReminderStage = "d3" | "d1";

export function reminderKey(sessionId: string, stage: ReminderStage): string {
  return `reminder:${sessionId}:${stage}`;
}

/** 整個 process 共用一份。 */
export const dedupeStore: DedupeStore = createDedupeStore();

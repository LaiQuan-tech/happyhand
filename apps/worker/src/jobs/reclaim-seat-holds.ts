/**
 * reclaim-seat-holds — 每分鐘回收過期的名額暫扣。
 *
 * 實際邏輯全部在 Postgres function `release_expired_seat_holds()`（由
 * supabase/migrations 提供）。放在 DB 端是刻意的：刪 seat_holds 與回補
 * workshop_sessions.seats_taken 必須在同一個交易裡，才不會出現
 * 「暫扣刪掉了但名額沒還回去」的超賣／少賣狀態。
 * worker 只負責定時觸發與記錄結果。
 */

import { releaseExpiredSeatHolds } from "../lib/db.js";
import type { JobContext, JobDefinition, JobResult } from "../lib/runner.js";

async function handler(ctx: JobContext): Promise<JobResult> {
  const { released, rawKind } = await releaseExpiredSeatHolds(ctx.supabase);

  if (released === null) {
    // function 有跑成功，但回傳形狀不是我們認得的數字 → 記下來，別假裝知道釋放幾筆
    ctx.log.warn("seat_holds_release_count_unknown", {
      raw_kind: rawKind,
      hint:
        "release_expired_seat_holds() 沒有回傳可解析的筆數。" +
        "若想在 log 看到數量，請讓它回傳 integer（釋放的暫扣筆數）。",
    });
    return { released: null, raw_kind: rawKind };
  }

  if (released > 0) {
    ctx.log.info("seat_holds_released", { released });
  }

  return { released };
}

export const reclaimSeatHoldsJob: JobDefinition = {
  name: "reclaim-seat-holds",
  schedule: "* * * * *",
  description: "每分鐘呼叫 release_expired_seat_holds()，清掉過期暫扣並還原 seats_taken",
  handler,
};

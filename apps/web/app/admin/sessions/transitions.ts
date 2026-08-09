import type { SessionStatus, WaitlistStatus } from "./queries";

/**
 * 狀態轉移白名單。
 *
 * 為什麼獨立成一支而不是放在 actions.ts：
 * `"use server"` 的檔案只允許 export async function —— 匯出一個 const 物件或
 * 同步的 helper 會讓 build 直接失敗（"Only async functions are allowed to be
 * exported from a 'use server' file"）。而顯示層需要同步讀得到「現在能按哪些按鈕」，
 * 所以規則本身必須住在 server action 檔案外面。
 *
 * 純資料、零 IO：不 import supabase、不碰 next/headers。
 *
 * ⚠️ 這裡的 canTransition*() 是給顯示層決定「要不要畫這顆按鈕」用的，那是體貼不是保護。
 *    真正的擋關在 actions.ts 裡，每支 server action 自己再判一次。
 */

/**
 * 場次狀態的合法轉移。
 *
 * 白名單而不是 if/else 串：轉移規則是資料，寫成資料才看得出「少了哪一條」。
 *
 * ⚠️ 這張表永遠不會產生 'full'。open ↔ full 由 sync_workshop_session_status()
 *    trigger 依 seats_taken / capacity 自動維護（20260808000001_init.sql:197）。
 *    手動寫 full 會在下一次 seats_taken 異動時被 trigger 打回去，
 *    留下一個「我明明改過」的假象。
 *    反過來把 full 設回 open 是安全的 —— trigger 會立刻重算，
 *    真的還是滿的就自己變回 full，等於這個操作被無害地忽略。
 */
export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  open: ["closed", "cancelled"],
  full: ["closed", "cancelled"],
  closed: ["open", "cancelled"],
  // 取消是人手按的，也就代表按錯的可能。留一條回頭路，
  // 否則誤點一次就得進資料庫改。回到 open 之後 trigger 會自己決定是不是 full。
  cancelled: ["open"],
};

/**
 * 候補狀態的合法轉移。
 *
 * waiting → offered → converted 是正常流程；未結束的狀態都可以 → cancelled。
 * cancelled 是終點：「已取消」通常已經打電話通知客人了，要復活請重新登記一筆，
 * 才留得下正確的時間順序 —— 候補是照登記時間排的，復活一筆舊的會插隊。
 */
export const WAITLIST_TRANSITIONS: Record<WaitlistStatus, readonly WaitlistStatus[]> = {
  waiting: ["offered", "cancelled"],
  offered: ["converted", "cancelled"],
  converted: ["cancelled"],
  cancelled: [],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function canTransitionWaitlist(from: WaitlistStatus, to: WaitlistStatus): boolean {
  return WAITLIST_TRANSITIONS[from].includes(to);
}

export function allowedSessionTargets(from: SessionStatus): readonly SessionStatus[] {
  return SESSION_TRANSITIONS[from];
}

export function allowedWaitlistTargets(from: WaitlistStatus): readonly WaitlistStatus[] {
  return WAITLIST_TRANSITIONS[from];
}

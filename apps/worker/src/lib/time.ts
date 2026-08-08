/**
 * 時間工具 — 全部以台北時間為準。
 *
 * 台灣自 1980 年起不再實施日光節約時間，Asia/Taipei 永遠是 UTC+8，
 * 所以「當地日界線」可以用固定位移安全計算，不需要額外的 tz 套件。
 * 對外顯示（信件內容）則用 Intl API 產生正式的中文格式。
 */

export const TAIPEI_TZ = "Asia/Taipei";

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface InstantRange {
  /** 起（含） */
  startIso: string;
  /** 迄（不含） */
  endIso: string;
}

/**
 * 取得「從今天算起第 n 天」在台北時間的整日區間，回傳 UTC ISO 字串。
 *
 * 例：台北時間 2026-08-08 09:00 呼叫 taipeiDayRange(3)，
 * 得到 2026-08-11 00:00:00+08 ~ 2026-08-12 00:00:00+08。
 */
export function taipeiDayRange(daysFromNow: number, now: Date = new Date()): InstantRange {
  // 位移到「台北牆上時間」，再對 UTC 日界線取整 = 台北當地午夜
  const shifted = now.getTime() + TAIPEI_OFFSET_MS;
  const shiftedMidnight = Math.floor(shifted / DAY_MS) * DAY_MS;
  const startShifted = shiftedMidnight + daysFromNow * DAY_MS;

  const start = new Date(startShifted - TAIPEI_OFFSET_MS);
  const end = new Date(startShifted - TAIPEI_OFFSET_MS + DAY_MS);

  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** 現在時間往前推 n 天的 ISO 字串（用於「超過 N 天未付款」這類查詢）。 */
export function isoDaysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** 兩個時間點相差幾天（無條件捨去，用於顯示「已等待 N 天」）。 */
export function wholeDaysBetween(fromIso: string, to: Date = new Date()): number {
  const from = new Date(fromIso).getTime();
  if (!Number.isFinite(from)) return 0;
  return Math.floor((to.getTime() - from) / DAY_MS);
}

const DATE_FMT = new Intl.DateTimeFormat("zh-TW", {
  timeZone: TAIPEI_TZ,
  year: "numeric",
  month: "long",
  day: "numeric",
});

const WEEKDAY_FMT = new Intl.DateTimeFormat("zh-TW", {
  timeZone: TAIPEI_TZ,
  weekday: "long",
});

const TIME_FMT = new Intl.DateTimeFormat("zh-TW", {
  timeZone: TAIPEI_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * 例：2026年9月12日（星期六）
 *
 * 星期加括號是刻意的：zh-TW 的預設輸出是「2026年9月12日星期六」，
 * 全部黏在一起對長輩讀者不好認，加了括號一眼就能分出日期與星期。
 */
export function formatTaipeiDate(iso: string): string {
  const date = new Date(iso);
  return `${DATE_FMT.format(date)}（${WEEKDAY_FMT.format(date)}）`;
}

/** 例：09:30 */
export function formatTaipeiTime(iso: string): string {
  return TIME_FMT.format(new Date(iso));
}

/** 例：2026年9月12日（星期六）09:30–17:00 */
export function formatTaipeiRange(startIso: string, endIso: string): string {
  return `${formatTaipeiDate(startIso)}${formatTaipeiTime(startIso)}–${formatTaipeiTime(endIso)}`;
}

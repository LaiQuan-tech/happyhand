import type { ComponentProps } from "react";
import {
  AdminFieldLabel,
  AdminFieldNotes,
  adminBorderClass,
  adminControlClass,
  adminControlHeight,
} from "./admin-field";

/**
 * 工作坊場次的日期時間欄位，以及台北時間 <-> ISO 的轉換。
 *
 * 資料庫存的是 timestamptz（UTC），<input type="datetime-local"> 吃的是
 * 沒有時區資訊的「牆上時間」字串。中間一定要有人負責換算。
 *
 * ⚠️ 這裡刻意不用 new Date(localString)。
 *    那個寫法會用「執行環境的時區」去解讀字串：員工在日本出差用飯店電腦改場次時間，
 *    瀏覽器時區是 UTC+9，同一個 "2026-09-12T14:00" 就會被存成差一小時的時間點。
 *    server 端更糟——Railway / Vercel 的 container 通常是 UTC。
 *    所以下面全部用 Date.UTC / getUTC* 這組「與環境時區無關」的 API，
 *    自己明確加減 +08:00 的偏移量。
 *
 * 台北固定 UTC+8，無日光節約（1980 年後），所以固定偏移量是正確的，
 * 不需要 Intl.DateTimeFormat 或 tz 資料庫。
 */

/** 台北時間相對 UTC 的偏移（分鐘）。Asia/Taipei 自 1980 年起無 DST。 */
export const TAIPEI_OFFSET_MINUTES = 8 * 60;

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/**
 * ISO 時間字串 -> datetime-local 用的台北牆上時間。
 *
 *   isoToTaipeiLocal("2026-09-12T06:00:00Z") === "2026-09-12T14:00"
 *
 * 認不得的輸入回空字串（欄位就會是空的），不 throw——
 * 一格壞掉的時間不該讓整個編輯頁白畫面。
 */
export function isoToTaipeiLocal(iso: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";

  // 先把時間軸整個平移 +8 小時，再用 UTC getter 讀出來，
  // 讀到的就是台北的牆上時間，與執行環境時區無關。
  const shifted = new Date(ms + TAIPEI_OFFSET_MINUTES * 60_000);
  return (
    `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/**
 * datetime-local 的台北牆上時間 -> ISO 字串（UTC）。
 *
 *   taipeiLocalToIso("2026-09-12T14:00") === "2026-09-12T06:00:00.000Z"
 *
 * 格式不符或日期不存在（例如 2026-02-30）回空字串。
 * 不靠 Date 的自動進位吃掉錯誤——那會把「2 月 30 日」默默存成 3 月 2 日。
 */
export function taipeiLocalToIso(local: string): string {
  if (!local) return "";
  const match = LOCAL_PATTERN.exec(local.trim());
  if (!match) return "";

  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = second ? Number(second) : 0;

  // Date.UTC 會把 1899 以前的年份做 0–99 映射，這裡直接排除掉，
  // 順便擋掉月/時/分明顯越界的輸入。
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  if (h > 23 || mi > 59 || s > 59) return "";

  const utcMs = Date.UTC(y, mo - 1, d, h, mi, s) - TAIPEI_OFFSET_MINUTES * 60_000;
  const result = new Date(utcMs);
  if (Number.isNaN(result.getTime())) return "";

  // 回頭比對：日期不存在時 Date.UTC 會自動進位（2026-02-30 -> 2026-03-02），
  // 轉回台北時間比對就抓得到，直接視為無效輸入。
  const expected = `${pad(y, 4)}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
  if (isoToTaipeiLocal(result.toISOString()) !== expected) return "";

  return result.toISOString();
}

/**
 * 顯示用：ISO -> "2026/09/12 14:00"（台北時間）。
 * 同樣不經過環境時區，所以 server render 與 client hydrate 不會對不上。
 */
export function formatTaipei(iso: string | null | undefined, withTime = true): string {
  if (!iso) return "";
  const local = isoToTaipeiLocal(iso);
  if (!local) return "";
  const [datePart, timePart] = local.split("T");
  const date = datePart.replace(/-/g, "/");
  return withTime ? `${date} ${timePart}` : date;
}

/* ------------------------------------------------------------------------ */

export type AdminDateTimeFieldProps = {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  id?: string;
  wrapperClassName?: string;
  /** 直接餵資料庫來的 ISO 字串，內部換算成台北時間顯示 */
  valueIso?: string | null;
} & Omit<ComponentProps<"input">, "name" | "id" | "type" | "defaultValue" | "value">;

/**
 * 原生 <input type="datetime-local">，不引入 date picker 套件。
 *
 * 提交出去的值是台北牆上時間字串（例如 "2026-09-12T14:00"），
 * server action 必須自己呼叫 taipeiLocalToIso() 再寫進資料庫。
 * 這裡不偷偷塞 hidden input 幫忙轉——那會讓「送出什麼」變成隱性知識。
 */
export function AdminDateTimeField({
  label,
  name,
  error,
  hint,
  id,
  wrapperClassName = "",
  className = "",
  valueIso,
  ...rest
}: AdminDateTimeFieldProps) {
  const fieldId = id ?? `admin-${name}`;
  const errId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  // 預設補一句時區說明。算 aria-describedby 時要用補完後的值，
  // 否則螢幕閱讀器讀不到畫面上明明有的那行字。
  const resolvedHint = hint ?? "台北時間（UTC+8）";
  const ids = [error ? errId : null, resolvedHint ? hintId : null].filter(Boolean);

  return (
    <div className={wrapperClassName}>
      <AdminFieldLabel htmlFor={fieldId} required={rest.required}>
        {label}
      </AdminFieldLabel>
      <input
        {...rest}
        id={fieldId}
        name={name}
        type="datetime-local"
        defaultValue={isoToTaipeiLocal(valueIso ?? "")}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.length > 0 ? ids.join(" ") : undefined}
        className={`${adminControlClass} ${adminControlHeight} ${adminBorderClass(error)} ${className}`}
      />
      <AdminFieldNotes
        error={error}
        hint={resolvedHint}
        errId={errId}
        hintId={hintId}
      />
    </div>
  );
}

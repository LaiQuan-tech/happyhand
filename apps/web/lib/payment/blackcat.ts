import "server-only";
import { createHash } from "node:crypto";

/**
 * 黑貓 PAY（統一客樂得多元支付平台）線上刷卡 — COCS。
 * 規格：多元支付平台-WEBAPI介面規格 V1.28.2。
 *
 * 只實作線上刷卡。代收代付（ibon／ATM）的 cmd 是 CvsOrderAppend，這裡沒有。
 *
 * ⚠️ 這支檔案裡有**兩套完全不同的驗簽**，寫錯不會報錯只會驗不過：
 *
 *   1. 瀏覽器導回（success_url）的 `chk`
 *      MD5(hash_base + '$' + ... )   ← 用 $ 分隔，**含 hash_base**
 *
 *   2. APN 主動通知的 `checksum`
 *      MD5(api_id + ':' + trans_id + ':' + amount + ':' + status + ':' + nonce)
 *                                    ← 用 : 分隔，**不含 hash_base**，只有 5 個欄位
 *
 * ⚠️ 另一個大坑：APN 的 checksum 算的是 `amount`（繳款單金額）而不是實收金額。
 *    checksum 通過只證明「這則通知沒被竄改」，**不證明客人付對了錢**。
 *    規格 P35 注意事項 2 是紅字：「請技術要以實際繳款金額去判別這筆繳款應實收
 *    是否相符後才撥付商品給消費者」。金額比對在 APN route handler 裡做。
 */

const BASE_URL = (
  process.env.BLACKCAT_BASE_URL ?? "https://cocs.4128888card.com.tw"
).replace(/\/+$/, "");

const CUST_ID = process.env.BLACKCAT_CUST_ID ?? "";
const API_PASSWORD = process.env.BLACKCAT_API_PASSWORD ?? "";
const HASH_BASE = process.env.BLACKCAT_HASH_BASE ?? "";

/** 收單行。合約開通的是統一金流 PAYUNi（特店代號 CCAT…）。 */
const ACQUIRER_TYPE = process.env.BLACKCAT_ACQUIRER_TYPE ?? "payuni";

const REQUEST_TIMEOUT_MS = 20_000;

/** 規格 P40：金額上限以合約規範為主，預設 100,000。 */
const MAX_ORDER_AMOUNT = 100_000;

export function isBlackcatConfigured(): boolean {
  return Boolean(CUST_ID && API_PASSWORD);
}

/** hash_base 只有驗證瀏覽器導回時才需要，缺了不影響建單與 APN。 */
export function hasHashBase(): boolean {
  return Boolean(HASH_BASE);
}

function md5(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/**
 * 台北時間的 yyyy-MM-dd HH:mm:ss。
 *
 * 規格所有 send_time 都是這個格式，而且明寫「必須為傳送時之最新時間」。
 * 用 en-CA + Asia/Taipei 湊出來，跟 api/orders/route.ts 產訂單編號的做法一致，
 * 不要用 toISOString()（那是 UTC，會差 8 小時，錯誤訊息會是「send_time 異常」）。
 */
export function taipeiTimestamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return (
    `${get("year")}-${get("month")}-${get("day")} ` +
    `${get("hour")}:${get("minute")}:${get("second")}`
  );
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  /** epoch ms，已經扣掉安全邊際 */
  expiresAt: number;
}

let cached: CachedToken | null = null;

/**
 * 取得 Bearer token。
 *
 * 有效期規格自己講三種（內文 3 小時、欄位表 1 天、範例 86399 秒），
 * 但它同時指定了權威來源：「以 .expires 欄位表示的到期時間為主」。
 * 所以這裡讀 .expires，並提前 5 分鐘失效，避免在邊界上打到過期 token。
 *
 * 模組級快取。Serverless 每個 instance 各自持有，最壞情況是多取幾次 token，
 * 規格沒有頻率限制也沒有「不可重複取得」的規定。
 */
async function getToken(): Promise<string> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.token;

  const body = new URLSearchParams({
    grant_type: "password",
    username: CUST_ID,
    password: API_PASSWORD,
  });

  const res = await fetch(`${BASE_URL}/Token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`取得 token 失敗：回應不是 JSON（HTTP ${res.status}）`);
  }

  const token = typeof json.access_token === "string" ? json.access_token : "";
  if (!token) {
    // 錯誤欄位規格寫大寫 Error，實際範例是小寫 error —— 兩個都收。
    const code = json.error ?? json.Error ?? `HTTP ${res.status}`;
    const desc = json.error_description ?? "";
    throw new Error(`取得 token 失敗：${String(code)} ${String(desc)}`.trim());
  }

  const expiresRaw = json[".expires"];
  let expiresAt = now + 30 * 60_000; // 讀不到就保守用 30 分鐘
  if (typeof expiresRaw === "string") {
    const parsed = Date.parse(expiresRaw.trim()); // 值是 GMT 字串，前面可能有空格
    if (Number.isFinite(parsed)) expiresAt = parsed;
  }
  cached = { token, expiresAt: expiresAt - 5 * 60_000 };
  return token;
}

/** 測試用：清掉 token 快取。 */
export function resetTokenCache(): void {
  cached = null;
}

// ---------------------------------------------------------------------------
// 建立刷卡訂單
// ---------------------------------------------------------------------------

export interface CreateCreditOrderInput {
  /** 我們的訂單編號，會當成 cust_order_no（規格要求三位數以上英數字或減號） */
  orderNo: string;
  amount: number;
  /** 商品明細。規格 P40 紅字「為符合政府法規必須填寫」，上限 500 字 */
  detail: string;
  /** APN 通知網址；不給就用黑貓 PAY 後台設定的預設值 */
  apnUrl?: string;
  /** 授權成功導回網址；不給就用後台設定 */
  successUrl?: string;
}

export type CreateCreditOrderResult =
  | { ok: true; url: string; custOrderNo: string }
  | { ok: false; reason: string };

/**
 * 契客新增刷卡訂單（cmd = CocsOrderAppend）。
 *
 * 成功會拿到一個 `url`，那是黑貓 PAY 的刷卡頁，把客人導過去就好。
 * 這支 API **不需要任何 checksum**，只靠 Bearer token。
 */
export async function createCreditOrder(
  input: CreateCreditOrderInput,
): Promise<CreateCreditOrderResult> {
  if (!isBlackcatConfigured()) {
    return { ok: false, reason: "金流未設定（缺 BLACKCAT_CUST_ID／密碼）" };
  }
  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return { ok: false, reason: `金額不合法：${input.amount}` };
  }
  if (input.amount > MAX_ORDER_AMOUNT) {
    return { ok: false, reason: `金額超過上限 ${MAX_ORDER_AMOUNT}` };
  }

  let token: string;
  try {
    token = await getToken();
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }

  const payload: Record<string, unknown> = {
    cmd: "CocsOrderAppend",
    cust_id: CUST_ID,
    cust_order_no: input.orderNo,
    order_amount: input.amount,
    // 規格 P43 異常 9：不可包含 HTML tag。順手把角括號拿掉並截到 500。
    order_detail: input.detail.replace(/[<>]/g, "").slice(0, 500),
    acquirer_type: ACQUIRER_TYPE,
    send_time: taipeiTimestamp(),
  };
  if (input.apnUrl) payload.apn_url = input.apnUrl;
  if (input.successUrl) payload.success_url = input.successUrl;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/Collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 規格 P9 特別註明 Bearer 與 token 之間要有空格
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { ok: false, reason: `連線失敗：${(error as Error).message}` };
  }

  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: `回應不是 JSON（HTTP ${res.status}）` };
  }

  if (json.status !== "OK") {
    return { ok: false, reason: String(json.msg ?? `HTTP ${res.status}`) };
  }
  const url = typeof json.url === "string" ? json.url : "";
  if (!url) return { ok: false, reason: "回應成功但沒有刷卡網址" };

  return {
    ok: true,
    url,
    custOrderNo: String(json.cust_order_no ?? input.orderNo),
  };
}

// ---------------------------------------------------------------------------
// 訂單查詢
// ---------------------------------------------------------------------------

export type QueryOrderResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reason: string };

/** 訂單查詢（cmd = CocsOrderQuery）。對帳與補救用。 */
export async function queryOrder(orderNo: string): Promise<QueryOrderResult> {
  if (!isBlackcatConfigured()) {
    return { ok: false, reason: "金流未設定" };
  }
  let token: string;
  try {
    token = await getToken();
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }

  try {
    const res = await fetch(`${BASE_URL}/api/Collect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        cmd: "CocsOrderQuery",
        cust_id: CUST_ID,
        cust_order_no: orderNo,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (json.status !== "OK") {
      return { ok: false, reason: String(json.msg ?? `HTTP ${res.status}`) };
    }
    return { ok: true, data: json };
  } catch (error) {
    return { ok: false, reason: (error as Error).message };
  }
}

// ---------------------------------------------------------------------------
// 驗簽
// ---------------------------------------------------------------------------

/**
 * APN 主動通知的 checksum。
 *
 *   MD5(api_id + ':' + trans_id + ':' + amount + ':' + status + ':' + nonce)
 *
 * 冒號分隔、**不含 hash_base**、只有這 5 個欄位。規格範例算出來是小寫十六進位，
 * 但文件沒明寫大小寫，所以比對時兩邊都轉小寫。
 *
 * `amount` 要用原樣的數字字串（不補零、不加千分位）—— 直接把收到的原始值
 * 轉成字串最保險，因為那就是對方拿去算的東西。
 */
export function verifyApnChecksum(input: {
  apiId: unknown;
  transId: unknown;
  amount: unknown;
  status: unknown;
  nonce: unknown;
  checksum: unknown;
}): boolean {
  const raw = [
    input.apiId,
    input.transId,
    input.amount,
    input.status,
    input.nonce,
  ]
    .map((v) => (v === null || v === undefined ? "" : String(v)))
    .join(":");
  const expected = md5(raw);
  const given = String(input.checksum ?? "").trim().toLowerCase();
  return given.length === 32 && expected === given;
}

/**
 * 瀏覽器導回（success_url）的 chk —— 授權**成功**版。
 *
 *   MD5(hash_base $ order_amount $ send_time $ ret $ acquire_time
 *       $ auth_code $ card_no $ notify_time $ cust_order_no)
 *
 * 注意順序不是欄位表的順序：send_time 在 ret 之前，cust_order_no 在最後。
 */
export function verifyReturnChkSuccess(q: {
  order_amount: string;
  send_time: string;
  ret: string;
  acquire_time: string;
  auth_code: string;
  card_no: string;
  notify_time: string;
  cust_order_no: string;
  chk: string;
}): boolean {
  if (!HASH_BASE) return false;
  const raw = [
    HASH_BASE,
    q.order_amount,
    q.send_time,
    q.ret,
    q.acquire_time,
    q.auth_code,
    q.card_no,
    q.notify_time,
    q.cust_order_no,
  ].join("$");
  return md5(raw) === (q.chk ?? "").trim().toLowerCase();
}

/**
 * 瀏覽器導回的 chk —— 授權**失敗**版（欄位比成功版少）。
 *
 *   MD5(hash_base $ order_amount $ send_time $ ret $ notify_time $ cust_order_no)
 *
 * ⚠️ 實務上我們大概收不到這個：規格 P48 明寫失敗轉址「僅玉山銀、中信銀可用，
 *    統一金流授權失敗後不會轉址，會停留在失敗結果頁」，而我們的收單行就是統一金流。
 *    留著是為了完整性，以及日後若換收單行不用重寫。
 */
export function verifyReturnChkFail(q: {
  order_amount: string;
  send_time: string;
  ret: string;
  notify_time: string;
  cust_order_no: string;
  chk: string;
}): boolean {
  if (!HASH_BASE) return false;
  const raw = [
    HASH_BASE,
    q.order_amount,
    q.send_time,
    q.ret,
    q.notify_time,
    q.cust_order_no,
  ].join("$");
  return md5(raw) === (q.chk ?? "").trim().toLowerCase();
}

/** APN 狀態碼（規格 P87-88）。 */
export const APN_STATUS = {
  AUTHORIZED: "B",
  CAPTURING: "O",
  CAPTURED: "E",
  AUTH_FAILED: "F",
  EXPIRED: "D",
  CAPTURE_FAILED: "P",
  REFUNDED: "M",
  REFUND_FAILED: "N",
  AUTH_CANCELLED: "Q",
  AUTH_CANCEL_FAILED: "R",
} as const;

/** 給後台顯示用的中文說明。 */
export const APN_STATUS_LABEL: Record<string, string> = {
  B: "授權完成",
  O: "請款作業中",
  E: "請款完成",
  F: "授權失敗",
  D: "訂單逾期",
  P: "請款失敗",
  M: "取消交易完成",
  N: "取消交易失敗",
  Q: "取消授權完成",
  R: "取消授權失敗",
  I: "開立發票通知",
  J: "開立發票折讓單號通知",
};

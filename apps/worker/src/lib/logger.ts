/**
 * 結構化 log：一行一筆 JSON，直接寫 stdout。
 *
 * Railway 的 log viewer 會把每一行當一筆記錄，JSON 格式方便之後轉去
 * Logtail / Datadog 之類的服務做查詢與告警，不需要改程式。
 *
 * 慣例欄位：
 *   ts        ISO8601 UTC 時間
 *   level     debug | info | warn | error
 *   msg       人看的訊息
 *   job       job 名稱（job 內的 log 一律帶）
 *   duration_ms  job 耗時
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveMinLevel(): LogLevel {
  const raw = (process.env["LOG_LEVEL"] ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

const MIN_LEVEL = resolveMinLevel();

/** log 欄位只允許可安全序列化的值，避免不小心把整個 client 物件塞進 log。 */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly LogValue[]
  | { readonly [key: string]: LogValue };

export type LogFields = Record<string, LogValue>;

/** 把 unknown（通常是 catch 到的東西）轉成可序列化的結構。 */
export function serializeError(err: unknown): LogFields {
  if (err instanceof Error) {
    const out: LogFields = {
      name: err.name,
      message: err.message,
    };
    if (typeof err.stack === "string") {
      // 只留前 12 行，避免單筆 log 過長被截斷
      out["stack"] = err.stack.split("\n").slice(0, 12).join("\n");
    }
    const cause: unknown = (err as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== null) {
      out["cause"] = typeof cause === "string" ? cause : String(cause);
    }
    return out;
  }
  if (typeof err === "string") return { message: err };
  return { message: String(err) };
}

function emit(level: LogLevel, msg: string, fields: LogFields): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[MIN_LEVEL]) return;

  const record: LogFields = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };

  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    // 理論上不會發生（LogValue 已限制型別），保底不讓 log 本身炸掉 process
    line = JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      msg: "logger_serialize_failed",
      original_msg: msg,
    });
  }

  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** 產生一個帶固定欄位的子 logger，例如綁定 job 名稱。 */
  child(bound: LogFields): Logger;
}

function makeLogger(bound: LogFields): Logger {
  return {
    debug: (msg, fields) => emit("debug", msg, { ...bound, ...fields }),
    info: (msg, fields) => emit("info", msg, { ...bound, ...fields }),
    warn: (msg, fields) => emit("warn", msg, { ...bound, ...fields }),
    error: (msg, fields) => emit("error", msg, { ...bound, ...fields }),
    child: (extra) => makeLogger({ ...bound, ...extra }),
  };
}

export const logger: Logger = makeLogger({ service: "happyhands-worker" });

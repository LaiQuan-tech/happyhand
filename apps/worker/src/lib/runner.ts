/**
 * Job 執行器。
 *
 * 職責：
 *   - 每個 job 包 try/catch → 單一 job 失敗不會拖垮整個 process
 *   - 計時並輸出結構化 log（job 名稱 + duration_ms）
 *   - 記錄統計數字供 /healthz 查看
 *   - 追蹤進行中的 job，讓優雅關閉能等它們跑完
 *   - 同名 job 不重疊執行（上一輪還沒跑完就跳過這一輪）
 */

import type { WorkerEnv } from "./env.js";
import type { LogFields, Logger } from "./logger.js";
import { logger, serializeError } from "./logger.js";
import type { Mailer } from "./email.js";
import type { ServiceClient } from "./supabase.js";
import { DbError } from "./db.js";

export interface JobContext {
  readonly log: Logger;
  readonly supabase: ServiceClient;
  readonly env: WorkerEnv;
  readonly mailer: Mailer;
  /** 這一輪的基準時間，job 內一律用它而不是自己呼叫 new Date()，行為才好預測。 */
  readonly now: Date;
}

/** job 回傳想寫進「完成」那筆 log 的欄位；沒有就回傳空物件。 */
export type JobResult = LogFields;

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export interface JobDefinition {
  name: string;
  /** 標準 5 欄位 cron 字串（分 時 日 月 週） */
  schedule: string;
  /** 給 README／log 看的人話說明 */
  description: string;
  handler: JobHandler;
}

export type JobOutcome = "ok" | "failed" | "skipped";

export interface JobStats {
  name: string;
  runs: number;
  failures: number;
  skipped: number;
  lastRunAt: string | null;
  lastOutcome: JobOutcome | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export interface Runner {
  run(definition: JobDefinition, trigger: "schedule" | "manual" | "startup"): Promise<void>;
  /** 目前正在跑的 job 數 */
  inFlightCount(): number;
  /** 等所有進行中的 job 結束；逾時就放棄等待並回傳 false。 */
  waitForIdle(timeoutMs: number): Promise<boolean>;
  snapshot(): JobStats[];
}

export function createRunner(deps: {
  supabase: ServiceClient;
  env: WorkerEnv;
  mailer: Mailer;
}): Runner {
  const stats = new Map<string, JobStats>();
  const inFlight = new Set<string>();

  function statsFor(name: string): JobStats {
    const existing = stats.get(name);
    if (existing !== undefined) return existing;
    const created: JobStats = {
      name,
      runs: 0,
      failures: 0,
      skipped: 0,
      lastRunAt: null,
      lastOutcome: null,
      lastDurationMs: null,
      lastError: null,
    };
    stats.set(name, created);
    return created;
  }

  async function run(
    definition: JobDefinition,
    trigger: "schedule" | "manual" | "startup",
  ): Promise<void> {
    const entry = statsFor(definition.name);
    const log = logger.child({ job: definition.name });

    if (inFlight.has(definition.name)) {
      entry.skipped += 1;
      entry.lastOutcome = "skipped";
      log.warn("job_skipped_still_running", {
        trigger,
        hint: "上一輪尚未結束，這一輪跳過。若持續出現代表 job 執行時間超過排程間隔。",
      });
      return;
    }

    inFlight.add(definition.name);
    const startedAt = Date.now();
    entry.runs += 1;
    entry.lastRunAt = new Date(startedAt).toISOString();

    log.debug("job_started", { trigger });

    try {
      const result = await definition.handler({
        log,
        supabase: deps.supabase,
        env: deps.env,
        mailer: deps.mailer,
        now: new Date(startedAt),
      });

      const durationMs = Date.now() - startedAt;
      entry.lastOutcome = "ok";
      entry.lastDurationMs = durationMs;
      entry.lastError = null;

      log.info("job_completed", { trigger, duration_ms: durationMs, ...result });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      entry.failures += 1;
      entry.lastOutcome = "failed";
      entry.lastDurationMs = durationMs;
      entry.lastError = err instanceof Error ? err.message : String(err);

      // migration 還沒跑（首次部署很常見）不是程式壞掉，降級成 warn 並給明確提示
      if (err instanceof DbError && err.schemaMissing) {
        log.warn("job_skipped_schema_missing", {
          trigger,
          duration_ms: durationMs,
          hint: "資料表或 function 還不存在，請確認 supabase/migrations 已套用到這個專案。",
          ...err.fields,
        });
        return;
      }

      // 關鍵：這裡吞掉例外，讓 process 繼續活著跑其他 job
      log.error("job_failed", {
        trigger,
        duration_ms: durationMs,
        ...serializeError(err),
      });
    } finally {
      inFlight.delete(definition.name);
    }
  }

  async function waitForIdle(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (inFlight.size > 0) {
      if (Date.now() >= deadline) return false;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100);
      });
    }
    return true;
  }

  return {
    run,
    inFlightCount: () => inFlight.size,
    waitForIdle,
    snapshot: () => [...stats.values()].map((entry) => ({ ...entry })),
  };
}

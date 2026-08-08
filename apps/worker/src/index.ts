/**
 * 快樂手 Railway worker — 進入點。
 *
 * 做的事：
 *   1. 驗證環境變數（缺就 exit 1）
 *   2. 起一個極簡 HTTP server 給 Railway health check（/healthz）
 *   3. 用 node-cron 註冊排程（時區固定 Asia/Taipei）
 *   4. SIGTERM/SIGINT 時停排程、等進行中的 job 跑完再退出
 *
 * 本機手動跑單一 job：
 *   pnpm --filter worker dev -- --once reclaim-seat-holds
 */

import { createTask, type ScheduledTask } from "node-cron";

import { createHealthServer, type HealthSnapshot } from "./lib/http.js";
import { createMailer } from "./lib/email.js";
import { createRunner } from "./lib/runner.js";
import { createServiceClient } from "./lib/supabase.js";
import { jobs } from "./jobs/index.js";
import { loadEnv } from "./lib/env.js";
import { logger, serializeError } from "./lib/logger.js";

const VERSION = "0.1.0";
/** 收到 SIGTERM 後最多等多久讓進行中的 job 收尾。Railway 預設約 30s 後才 SIGKILL。 */
const SHUTDOWN_GRACE_MS = 25_000;

const startedAt = new Date();

function parseOnceArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--once") return argv[i + 1] ?? null;
    if (arg.startsWith("--once=")) return arg.slice("--once=".length);
  }
  return null;
}

async function main(): Promise<void> {
  const env = loadEnv();

  // 宣告在最前面：health server 一 listen 就可能被打，
  // snapshot() 讀到還在 TDZ 的變數會直接丟 ReferenceError。
  let shuttingDown = false;

  logger.info("worker_starting", {
    version: VERSION,
    node: process.version,
    node_env: env.nodeEnv,
    timezone: env.timezone,
    port: env.port,
    dry_run: env.dryRun,
    email_enabled: env.resendApiKey !== null && !env.dryRun,
    jobs: jobs.map((job) => job.name),
  });

  const supabase = createServiceClient(env);
  const mailer = createMailer(env, logger.child({ component: "mailer" }));
  const runner = createRunner({ supabase, env, mailer });

  // --- 單次執行模式（本機測試用，不起 server、不排程）---------------------
  const onceName = parseOnceArg(process.argv.slice(2));
  if (onceName !== null) {
    const target = jobs.find((job) => job.name === onceName);
    if (target === undefined) {
      logger.error("unknown_job", {
        requested: onceName,
        available: jobs.map((job) => job.name),
      });
      process.exit(1);
    }
    await runner.run(target, "manual");
    const stats = runner.snapshot().find((entry) => entry.name === onceName);
    // job 內部失敗會被 runner 吞掉，這裡用 exit code 把結果傳回給 shell
    process.exit(stats?.lastOutcome === "failed" ? 1 : 0);
  }

  // --- Health check server ------------------------------------------------
  const snapshot = (): HealthSnapshot => ({
    status: shuttingDown ? "shutting_down" : "ok",
    service: "happyhands-worker",
    version: VERSION,
    started_at: startedAt.toISOString(),
    uptime_sec: Math.round(process.uptime()),
    timezone: env.timezone,
    dry_run: env.dryRun,
    email_enabled: env.resendApiKey !== null && !env.dryRun,
    in_flight_jobs: runner.inFlightCount(),
    jobs: runner.snapshot(),
  });

  const healthServer = createHealthServer(snapshot, logger.child({ component: "http" }));
  // 先讓 health check 可用再排程：Railway 等不到 /healthz 會直接判定部署失敗
  await healthServer.listen(env.port);

  // --- 排程 ---------------------------------------------------------------
  const tasks: ScheduledTask[] = [];

  for (const job of jobs) {
    const task = createTask(
      job.schedule,
      () => {
        // 這裡刻意不 await：node-cron 只要拿到 promise 就好，
        // 而 runner 自己已經包了 try/catch，不會有未處理的 rejection。
        void runner.run(job, "schedule");
      },
      {
        name: job.name,
        timezone: env.timezone,
        // 雙保險：runner 也擋重疊，但讓 cron 層先擋可以少一筆 warn log
        noOverlap: true,
      },
    );
    task.start();
    tasks.push(task);

    logger.info("job_scheduled", {
      job: job.name,
      schedule: job.schedule,
      timezone: env.timezone,
      next_run: task.getNextRun()?.toISOString() ?? null,
      description: job.description,
    });
  }

  logger.info("worker_ready", { jobs: tasks.length, port: env.port });

  // --- 優雅關閉 -----------------------------------------------------------
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) {
      logger.warn("shutdown_already_in_progress", { signal });
      return;
    }
    shuttingDown = true;

    logger.info("shutdown_started", {
      signal,
      in_flight_jobs: runner.inFlightCount(),
      grace_ms: SHUTDOWN_GRACE_MS,
    });

    // 1. health check 開始回 503，Railway 停止把這個 instance 當健康
    healthServer.markShuttingDown();

    // 2. 停掉所有排程，不再觸發新的 job
    for (const task of tasks) {
      try {
        await task.stop();
      } catch (err) {
        logger.warn("task_stop_failed", { job: task.name ?? "(unnamed)", ...serializeError(err) });
      }
    }

    // 3. 等進行中的 job 跑完（最多 SHUTDOWN_GRACE_MS）
    const drained = await runner.waitForIdle(SHUTDOWN_GRACE_MS);
    if (!drained) {
      logger.warn("shutdown_timeout", {
        in_flight_jobs: runner.inFlightCount(),
        hint: "仍有 job 未結束，將強制退出。下次啟動時該 job 會重跑。",
      });
    }

    // 4. 關掉 HTTP server
    await healthServer.close();

    logger.info("shutdown_complete", { signal, drained });
    process.exit(drained ? 0 : 1);
  }

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  // 未預期的錯誤：記下來。rejection 不致命（job 都已包 try/catch），
  // uncaughtException 代表狀態可能已經壞掉 → 退出讓 Railway 重啟。
  process.on("unhandledRejection", (reason: unknown) => {
    logger.error("unhandled_rejection", serializeError(reason));
  });
  process.on("uncaughtException", (err: Error) => {
    logger.error("uncaught_exception", serializeError(err));
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  logger.error("worker_startup_failed", serializeError(err));
  process.exit(1);
});

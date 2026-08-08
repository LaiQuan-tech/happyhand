/**
 * health — 每 15 分鐘一筆心跳。
 *
 * Railway 的 log 若長時間沒有輸出，很難分辨「服務活著但沒事做」與
 * 「服務其實已經卡死」。定期心跳讓兩者一眼可辨，也方便設
 * 「30 分鐘內沒看到 worker_heartbeat 就告警」這類監控規則。
 */

import type { JobContext, JobDefinition, JobResult } from "../lib/runner.js";

function startedAtIso(): string {
  return new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString();
}

async function handler(ctx: JobContext): Promise<JobResult> {
  const memory = process.memoryUsage();

  ctx.log.info("worker_heartbeat", {
    uptime_sec: Math.round(process.uptime()),
    started_at: startedAtIso(),
    rss_mb: Math.round(memory.rss / 1024 / 1024),
    heap_used_mb: Math.round(memory.heapUsed / 1024 / 1024),
    node_env: ctx.env.nodeEnv,
    dry_run: ctx.env.dryRun,
  });

  return { uptime_sec: Math.round(process.uptime()) };
}

export const healthJob: JobDefinition = {
  name: "health",
  schedule: "*/15 * * * *",
  description: "每 15 分鐘輸出一筆心跳 log",
  handler,
};

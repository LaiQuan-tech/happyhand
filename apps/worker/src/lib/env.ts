/**
 * 環境變數載入與驗證。
 *
 * 必要變數缺少時 → 印出清楚的錯誤訊息並 process.exit(1)。
 * 寧可在啟動時大聲失敗，也不要跑到半夜排程才發現連不上 DB。
 */

import { logger } from "./logger.js";

export interface WorkerEnv {
  /** Supabase 專案 URL */
  supabaseUrl: string;
  /** service role key — 繞過 RLS，只在這個背景服務內使用，絕不外流到前端 */
  supabaseServiceRoleKey: string;
  /** Resend API key；沒有設定 = 提醒信只記 log 不寄出（dry run） */
  resendApiKey: string | null;
  /** 寄件人，例如：快樂手 <no-reply@happyhands.tw> */
  mailFrom: string;
  /** 寄信失敗或需要人工處理時的內部通知信箱（目前僅用於信件 reply-to） */
  mailReplyTo: string | null;
  /** HTTP health check port */
  port: number;
  /** 排程時區，固定 Asia/Taipei */
  timezone: string;
  /** true 時所有 job 只讀不寫、信一律不寄（本機開發預設值） */
  dryRun: boolean;
  nodeEnv: string;
}

const TIMEZONE = "Asia/Taipei";

function readString(...names: readonly string[]): string | null {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw === "string" && raw.trim() !== "") {
      return raw.trim();
    }
  }
  return null;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = readString(name);
  if (raw === null) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function readPort(fallback: number): number {
  const raw = readString("PORT");
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
}

/**
 * 讀取並驗證環境變數。缺少必要值時直接結束 process。
 */
export function loadEnv(): WorkerEnv {
  const missing: string[] = [];

  // Railway 用 SUPABASE_URL（STACK.md §5）；順手接受 NEXT_PUBLIC_ 版本，
  // 方便本機直接沿用 apps/web 的 .env.local。
  const supabaseUrl = readString("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  if (supabaseUrl === null) missing.push("SUPABASE_URL");

  const supabaseServiceRoleKey = readString("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseServiceRoleKey === null) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missing.length > 0) {
    logger.error("missing_required_env", {
      missing,
      hint:
        "請在 Railway 專案的 Variables 頁面補上這些變數（本機則寫進 apps/worker/.env）。" +
        "SUPABASE_SERVICE_ROLE_KEY 在 Supabase Dashboard → Project Settings → API → service_role。",
    });
    // 同時寫一份人看得懂的訊息，避免有人只掃 stderr 純文字
    process.stderr.write(
      `\n[happyhands-worker] 啟動失敗：缺少必要環境變數 ${missing.join(", ")}\n\n`,
    );
    process.exit(1);
  }

  // 上面 exit 過了，這裡一定有值；用 non-null 斷言避免 any。
  const url = supabaseUrl as string;
  const key = supabaseServiceRoleKey as string;

  if (!/^https?:\/\//.test(url)) {
    logger.error("invalid_supabase_url", {
      hint: "SUPABASE_URL 必須是完整網址，例如 https://xxxx.supabase.co",
    });
    process.exit(1);
  }

  // service role key 是 JWT，長度遠大於 anon key 的常見誤植情況做個提醒
  if (key.length < 40) {
    logger.warn("supabase_key_looks_short", {
      hint: "SUPABASE_SERVICE_ROLE_KEY 看起來太短，確認沒有貼成別的值。",
    });
  }

  const resendApiKey = readString("RESEND_API_KEY");
  const dryRun = readBool("WORKER_DRY_RUN", false);

  return {
    supabaseUrl: url,
    supabaseServiceRoleKey: key,
    resendApiKey,
    mailFrom: readString("MAIL_FROM") ?? "快樂手 <no-reply@happyhands.tw>",
    mailReplyTo: readString("MAIL_REPLY_TO"),
    port: readPort(3001),
    timezone: TIMEZONE,
    dryRun,
    nodeEnv: readString("NODE_ENV") ?? "development",
  };
}

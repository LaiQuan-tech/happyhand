/**
 * 極簡 HTTP server — 只為了 Railway 的 health check。
 *
 * 用 node:http 而不是 Express：這裡只有兩條路由，不值得多一個相依。
 *
 * GET /healthz  → 200 JSON（關閉中回 503，讓 Railway 停止導流）
 * GET /         → 200 JSON（簡短資訊）
 * 其他          → 404
 */

import { createServer, type Server } from "node:http";
import type { Logger } from "./logger.js";
import type { JobStats } from "./runner.js";

export interface HealthSnapshot {
  status: "ok" | "shutting_down";
  service: string;
  version: string;
  started_at: string;
  uptime_sec: number;
  timezone: string;
  dry_run: boolean;
  email_enabled: boolean;
  in_flight_jobs: number;
  dedupe_entries: number;
  jobs: JobStats[];
}

export interface HealthServer {
  listen(port: number): Promise<void>;
  close(): Promise<void>;
  /** 進入關閉流程：health check 開始回 503。 */
  markShuttingDown(): void;
}

export function createHealthServer(
  getSnapshot: () => HealthSnapshot,
  log: Logger,
): HealthServer {
  let shuttingDown = false;

  const server: Server = createServer((req, res) => {
    const url = req.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    const method = req.method ?? "GET";

    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "method_not_allowed" }));
      return;
    }

    if (path === "/healthz") {
      const snapshot = getSnapshot();
      // 關閉中回 503：Railway 看到之後就不會把新流量或新 health check 當成健康
      const statusCode = shuttingDown ? 503 : 200;
      res.writeHead(statusCode, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(snapshot));
      return;
    }

    if (path === "/") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          service: "happyhands-worker",
          healthcheck: "/healthz",
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  server.on("error", (err: Error) => {
    log.error("http_server_error", { name: err.name, message: err.message });
  });

  return {
    listen(port: number): Promise<void> {
      return new Promise((resolve, reject) => {
        const onError = (err: Error): void => {
          server.off("listening", onListening);
          reject(err);
        };
        const onListening = (): void => {
          server.off("error", onError);
          log.info("http_listening", { port, healthcheck: "/healthz" });
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        // 綁 0.0.0.0：Railway 的 health check 從容器外進來，只聽 localhost 會失敗
        server.listen(port, "0.0.0.0");
      });
    },

    close(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
        // 關掉 keep-alive 連線，否則 server.close() 會等到連線自然結束
        server.closeAllConnections();
      });
    },

    markShuttingDown(): void {
      shuttingDown = true;
    },
  };
}

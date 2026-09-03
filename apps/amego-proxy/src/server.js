/**
 * Amego 固定出口 IP 代理。
 *
 * 為什麼存在：Amego 的發票 API 用來源 IP 白名單，而快樂手跑在 Vercel —— Vercel
 * 的出口 IP 是浮動的（Hobby／Pro 都沒有固定出口 IP，那是 Enterprise 的 Secure
 * Compute），永遠有沒被放行的新 IP，所以開票 100% 失敗（Amego 回 code 14
 * 「IP 錯誤：… 未被允許」）。這支跑在 Railway 並掛 Static Outbound IP，
 * 讓 Amego 看到的來源是固定的那幾個。
 *
 * 🔴 它是一根管子，不是一個開票服務。三個刻意的設計：
 *
 * 1. **不持有 Amego 金鑰。** 簽章 md5(data + time + appKey) 是在 Vercel 端算好
 *    的，送進來的 body 已經簽完。所以 AMEGO_APP_KEY 不需要、也不應該存在這裡。
 *    這台機器就算整個被拿走，也開不出一張發票。
 *
 * 2. **body 原封不動轉發。** 簽章涵蓋 `data` 這個字串本身，任何重新解析再編碼
 *    （form 解析、JSON round-trip、`+` 與 %20 的差異）都會讓簽章對不上。所以
 *    這裡讀的是 raw Buffer，不碰內容。
 *
 * 3. **不記錄 body。** 裡面有買受人姓名、統編、載具、金額。log 只留路徑、
 *    狀態碼與耗時。
 *
 * 沒有依賴是刻意的：整支只用 node 內建，Railway 不需要跑 install，
 * 少一個會壞的環節。
 */

import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";

const PORT = Number(process.env.PORT ?? 8080);
const UPSTREAM = (process.env.AMEGO_UPSTREAM ?? "https://invoice-api.amego.tw")
  .replace(/\/+$/, "");
const TOKEN = process.env.PROXY_TOKEN ?? "";

/** 上游逾時。比 Vercel 端的 20 秒短一點，讓對面先收到明確的錯誤而不是被砍斷。 */
const UPSTREAM_TIMEOUT_MS = 15_000;
/** 請求 body 上限。發票 payload 只有幾 KB，給 1MB 已經很寬。 */
const MAX_BODY_BYTES = 1_000_000;

/**
 * 只放行 Amego 真的有的那幾條路徑。
 *
 * ⚠️ 不要改成「任何 /json/* 都轉」：那會讓這台變成通往 Amego 的開放中繼。
 * 雖然沒有 appKey 就簽不出有效請求，但沒必要把攻擊面留著。
 */
const ALLOWED_PATHS = new Set([
  "/json/c0401", // 開立
  "/json/f0501", // 作廢
  "/json/invoice_query", // 反查
]);

/** 定時比較，避免用回應時間猜 token。 */
function tokenOk(given) {
  if (TOKEN === "" || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const path = (req.url ?? "/").split("?")[0];

  if (req.method === "GET" && path === "/healthz") {
    // 健康檢查刻意不驗 token —— Railway 的 healthcheck 帶不了自訂標頭。
    // 這條不碰上游也不吐任何秘密。
    return send(res, 200, JSON.stringify({ ok: true, upstream: UPSTREAM }), "application/json");
  }

  if (req.method !== "POST" || !ALLOWED_PATHS.has(path)) {
    return send(res, 404, "not found");
  }

  if (!tokenOk(req.headers["x-proxy-token"])) {
    console.warn(JSON.stringify({ evt: "unauthorized", path }));
    return send(res, 401, "unauthorized");
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return send(res, 413, "payload too large");
  }

  try {
    const upstream = await fetch(`${UPSTREAM}${path}`, {
      method: "POST",
      headers: {
        "Content-Type":
          req.headers["content-type"] ?? "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const text = await upstream.text();
    console.info(
      JSON.stringify({
        evt: "forwarded",
        path,
        status: upstream.status,
        ms: Date.now() - started,
        bytes: text.length,
      }),
    );
    // 狀態碼與 body 都照抄。Amego 的成功失敗全部是 HTTP 200，判斷在 body 的
    // code 欄位，呼叫端已經有完整的三態處理，這裡不要越俎代庖去解讀。
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
    });
    return res.end(text);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ evt: "upstream_failed", path, reason }));
    // 🔴 502 而不是編一個 Amego 格式的錯誤回去。呼叫端把「連線失敗」與
    // 「Amego 回了什麼」分得很清楚（見 lib/invoice/amego.ts 的三態說明），
    // 假裝成上游回應會讓它誤判成「這張還沒開過」。
    return send(res, 502, `upstream failed: ${reason}`);
  }
});

if (TOKEN === "") {
  console.error("缺 PROXY_TOKEN，拒絕啟動（沒有 token 等於開放中繼）");
  process.exit(1);
}

server.listen(PORT, () => {
  console.info(JSON.stringify({ evt: "listening", port: PORT, upstream: UPSTREAM }));
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}

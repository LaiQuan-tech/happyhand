import "server-only";

import { createServiceClient } from "@/lib/supabase/server";

/**
 * Gemini 呼叫層。
 *
 * 🔴 MODEL 一定要是 3.5：`gemini-2.5-flash` 對**新申請的 key** 會回 404
 *    「no longer available to new users」，而且它還留在 /v1beta/models 清單裡，
 *    所以不能靠列出模型來判斷能不能用，要實際打一次。
 *
 * 🔴 thinkingBudget: 0 不能拿掉。3.5-flash 預設會思考，而思考的 token
 *    **算在 maxOutputTokens 裡**。實測「用三句話回答一個問題」：
 *      不設 thinkingBudget → 思考吃掉 572 token，回覆被截斷成
 *                            「簡單易懂且非常安全。 (Period/Full stop: 。)
 *                             *   Sentence 3:」這種漏出思考過程的碎片
 *      thinkingBudget: 0   → 思考 0、輸出 90、乾淨完整的三句話
 *    客服對話不需要推理，關掉又快又省又不會吐出英文碎片。
 */
const MODEL = "gemini-3.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** 單一 IP 每天幾次。60–75 歲的客人問十幾題很正常，抓寬一點。 */
const PER_IP_DAILY = 60;
/** 全站每天幾次。這是帳單的最後一道防線。 */
const GLOBAL_DAILY = 1500;

export type ChatTurn = { role: "user" | "model"; text: string };

export class RateLimitError extends Error {
  constructor() {
    super("rate_limited");
  }
}
export class NotConfiguredError extends Error {
  constructor() {
    super("not_configured");
  }
}

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** Vercel 後面一定有 proxy，直接讀 x-forwarded-for 的第一段 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.slice(0, 64) || "unknown";
}

/**
 * 用量閘門。先擋全站再擋單一 IP。
 *
 * ⚠️ 資料庫連不上時**放行**（回 true）：擋人比超支更糟——客人問不到問題
 * 就直接走了，而超支頂多是帳單多幾塊錢，而且還有 GLOBAL_DAILY 兜底。
 */
export async function withinRateLimit(ip: string): Promise<boolean> {
  try {
    const db = createServiceClient();
    if (!db) return true;

    const { data: global } = await db.rpc("ai_rate_check", {
      p_bucket: "__global__",
      p_limit: GLOBAL_DAILY,
    });
    if (global === false) return false;

    const { data: perIp } = await db.rpc("ai_rate_check", {
      p_bucket: ip,
      p_limit: PER_IP_DAILY,
    });
    return perIp !== false;
  } catch (err) {
    console.error("[ai] 用量檢查失敗，放行", err);
    return true;
  }
}

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
};

async function callGemini(
  body: Record<string, unknown>,
  timeoutMs = 20_000,
): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new NotConfiguredError();

  // 沒有 timeout 的話，Gemini 卡住就等於小幫手的轉圈圈永遠不停
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT}?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    const data = (await res.json()) as GeminiResponse;
    if (!res.ok) {
      // 不要把 key 或完整回應寫進 log
      throw new Error(`gemini_${res.status}: ${data.error?.message?.slice(0, 160) ?? ""}`);
    }

    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("gemini_empty");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export async function callGeminiChat(
  turns: ChatTurn[],
  opts: { system: string; maxTokens?: number },
): Promise<string> {
  return callGemini({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: turns.map((t) => ({
      role: t.role === "model" ? "model" : "user",
      parts: [{ text: t.text }],
    })),
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 700,
      temperature: 0.7,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
}

/** 結構化輸出。萃取聯絡資訊用，失敗回 null（絕不讓它影響客服回覆）。 */
export async function callGeminiJSON<T>(
  prompt: string,
  opts: { system: string; schema: Record<string, unknown>; maxTokens?: number },
): Promise<T | null> {
  try {
    const text = await callGemini({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? 500,
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: opts.schema,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    return JSON.parse(text) as T;
  } catch (err) {
    console.error("[ai] JSON 萃取失敗", err instanceof Error ? err.message : err);
    return null;
  }
}

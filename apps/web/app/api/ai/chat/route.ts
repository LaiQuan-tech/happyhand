import { NextResponse } from "next/server";
import {
  callGeminiChat,
  clientIp,
  geminiConfigured,
  withinRateLimit,
  type ChatTurn,
} from "@/lib/ai/gemini";
import { catalogText, chatSystem } from "@/lib/ai/knowledge";
import { logChat } from "@/lib/ai/chat-log";
import { SITE } from "@/lib/site";

export const runtime = "nodejs";
/** 每則訊息都要即時算，不能被快取 */
export const dynamic = "force-dynamic";

type InMsg = { role?: string; text?: string };

/** 單則訊息長度上限。防止有人把整本書貼進來灌爆 token。 */
const MSG_MAX = 800;
/** 帶進上下文的最多幾則。太長會慢也會貴，客服對話用不到那麼久以前的內容。 */
const TURNS_MAX = 20;

/** 任何「這次不能用 AI」的情況，都回同一句話 —— 客人只需要知道還有 LINE 可以問。 */
function fallbackReply(reason: string) {
  return NextResponse.json({
    ok: true,
    reply:
      `不好意思，小幫手現在沒辦法回答（${reason}）。` +
      `你可以用 LINE ${SITE.lineId} 直接問我們，我們會盡快回覆你。`,
    degraded: true,
  });
}

export async function POST(req: Request) {
  let body: { messages?: InMsg[]; sessionId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const turns: ChatTurn[] = raw
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .map((m) => ({
      role: m.role === "model" || m.role === "assistant" ? ("model" as const) : ("user" as const),
      text: String(m.text).trim().slice(0, MSG_MAX),
    }))
    .slice(-TURNS_MAX);

  if (turns.length === 0 || turns[turns.length - 1]!.role !== "user") {
    return NextResponse.json({ ok: false, error: "no_user_message" }, { status: 422 });
  }

  // 沒設 key 也要能用：小幫手照樣開得起來，只是每一句都導去 LINE。
  // 這樣「程式先上、key 之後補」不會讓網站出現壞掉的按鈕。
  if (!geminiConfigured()) return fallbackReply("線上客服還在整備中");

  const ip = clientIp(req);
  if (!(await withinRateLimit(ip))) return fallbackReply("今天的詢問次數已達上限");

  try {
    // 目錄即時從資料庫撈：後台上架新課或開新梯次，小幫手立刻講得出來
    const reply = await callGeminiChat(turns, {
      system: chatSystem(await catalogText()),
      maxTokens: 700,
    });

    // await 而不是 after()：serverless 不保證回應後的工作跑得完，
    // 而後台的諮詢紀錄是這個功能的一半價值。失敗會被 logChat 自己吞掉。
    const sessionId =
      typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : "";
    await logChat(sessionId, turns, reply, ip, req.headers.get("user-agent"));

    return NextResponse.json({ ok: true, reply });
  } catch (err) {
    console.error("[ai/chat] 失敗", err instanceof Error ? err.message : err);
    return fallbackReply("線上客服暫時忙線");
  }
}

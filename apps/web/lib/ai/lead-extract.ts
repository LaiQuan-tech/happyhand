import "server-only";

import { callGeminiJSON, type ChatTurn } from "@/lib/ai/gemini";

export type Lead = {
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_line: string | null;
  summary: string | null;
  intent: string | null;
};

const LEAD_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    name: { type: "STRING", description: "訪客的稱呼或姓名，沒有就空字串" },
    phone: { type: "STRING", description: "訪客留的電話或手機，沒有就空字串" },
    email: { type: "STRING", description: "訪客留的 Email，沒有就空字串" },
    line: { type: "STRING", description: "訪客留的 LINE ID，沒有就空字串" },
    summary: { type: "STRING", description: "一句繁體中文摘要，說明訪客想做什麼" },
    intent: {
      type: "STRING",
      description: "簡短意向：想報名工作坊、想買線上課、課程諮詢、帳號問題、退費改期、其他",
    },
  },
};

const EXTRACT_SYSTEM = `你是快樂手官網小幫手對話的資訊萃取器。從對話中萃取「訪客本人明確提供」的聯絡資訊與需求。

規則：
- 只抓訪客（使用者）真的打出來的資訊。小幫手講的、或訪客沒提供的，一律留空字串，絕不杜撰或臆測。
- name＝稱呼或姓名；phone＝電話；email＝Email；line＝LINE ID。
- summary＝用一句繁體中文描述訪客想做什麼（沒有明確需求就空字串）。
- intent＝簡短意向詞。
- 🔴 不要把訪客提到的身體狀況、病史或症狀寫進 summary。只寫他想做什麼（例如「想報名九月台北的工作坊」），不要寫「因為膝蓋不好想…」。
- 嚴格依 JSON schema 回傳，不要多加說明。`;

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, 200) : null;
}

/**
 * 電話只留數字。抓不到就原樣保留 —— 客人可能寫「市話 02-1234 5678 分機 12」，
 * 硬轉成純數字反而讓客服看不懂。
 */
function normalizePhone(v: string | null): string | null {
  if (!v) return null;
  const d = v.replace(/\D/g, "");
  return d.length >= 8 ? d : v;
}

/**
 * 從整段對話萃取聯絡資訊與需求。抓不到任何東西就回 null。
 *
 * 由 logChat 在偵測到聯絡訊號時才呼叫 —— 每一輪都跑等於每則訊息打兩次
 * Gemini，成本直接翻倍。
 */
export async function extractLead(turns: ChatTurn[]): Promise<Lead | null> {
  const transcript = turns
    .map((t) => `${t.role === "user" ? "訪客" : "小幫手"}：${t.text}`)
    .join("\n")
    .slice(0, 4000);

  const raw = await callGeminiJSON<{
    name?: string;
    phone?: string;
    email?: string;
    line?: string;
    summary?: string;
    intent?: string;
  }>(`對話內容：\n${transcript}`, {
    system: EXTRACT_SYSTEM,
    schema: LEAD_SCHEMA,
    maxTokens: 400,
  });

  if (!raw) return null;

  const lead: Lead = {
    contact_name: clean(raw.name),
    contact_phone: normalizePhone(clean(raw.phone)),
    contact_email: clean(raw.email),
    contact_line: clean(raw.line),
    summary: clean(raw.summary),
    intent: clean(raw.intent),
  };

  if (
    !lead.contact_name &&
    !lead.contact_phone &&
    !lead.contact_email &&
    !lead.contact_line &&
    !lead.summary
  ) {
    return null;
  }
  return lead;
}

/**
 * 最新一則訪客訊息裡有沒有「聯絡訊號」。
 * 這是成本閘門：一般問答不會觸發第二次 Gemini 呼叫。
 */
export function hasContactSignal(text: string): boolean {
  if (!text) return false;
  // Email
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return true;
  // 電話：整句數字加起來 8 碼以上（09xxxxxxxx、02-xxxxxxxx 都會中）
  if (text.replace(/\D/g, "").length >= 8) return true;
  // LINE ID。\b 避免誤中 online / deadline
  if (/\bline\b|賴|@[a-z0-9._-]{2,}/i.test(text)) return true;
  // 「我叫…」「我姓…」這種自報姓名
  if (/我(叫|姓)|敝姓|可以叫我/.test(text)) return true;
  return false;
}

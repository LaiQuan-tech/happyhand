import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import type { ChatTurn } from "@/lib/ai/gemini";
import { extractLead, hasContactSignal } from "@/lib/ai/lead-extract";

export type ChatMsg = { role: "user" | "model"; text: string };

export type ChatLog = {
  id: string;
  session_id: string;
  messages: ChatMsg[];
  message_count: number;
  first_question: string | null;
  last_reply: string | null;
  user_ip: string | null;
  user_agent: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_line: string | null;
  summary: string | null;
  intent: string | null;
  has_contact: boolean;
  handled_at: string | null;
  handled_note: string | null;
  created_at: string;
  updated_at: string;
};

export const CHAT_LOG_COLS =
  "id, session_id, messages, message_count, first_question, last_reply, user_ip, user_agent, " +
  "contact_name, contact_phone, contact_email, contact_line, summary, intent, has_contact, " +
  "handled_at, handled_note, created_at, updated_at";

/**
 * 記錄一段對話（以 session_id upsert，一段對話一列），
 * 並在偵測到聯絡訊號時萃取聯絡資訊。
 *
 * ⚠️ 全程吞錯：記錄失敗絕對不能讓客人收不到回覆。
 *
 * ⚠️ 呼叫端要 await 這支，不要丟進 after()。serverless 對「回應之後才跑的
 *    非同步工作」不保證跑得完，而後台的諮詢紀錄是這個功能的一半價值。
 */
export async function logChat(
  sessionId: string,
  turns: ChatTurn[],
  reply: string,
  ip: string,
  ua: string | null,
): Promise<void> {
  if (!sessionId) return;
  const db = createServiceClient();
  if (!db) return;

  const messages: ChatMsg[] = [
    ...turns.map((t) => ({ role: t.role, text: t.text })),
    { role: "model" as const, text: reply },
  ];

  try {
    await db.from("ai_chat_logs").upsert(
      {
        session_id: sessionId,
        messages,
        message_count: messages.length,
        first_question: turns.find((t) => t.role === "user")?.text?.slice(0, 300) ?? null,
        last_reply: reply.slice(0, 500),
        user_ip: ip,
        user_agent: (ua ?? "").slice(0, 300) || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    );
  } catch (err) {
    console.error("[ai] 對話記錄寫入失敗", err instanceof Error ? err.message : err);
  }

  try {
    const latestUser = [...turns].reverse().find((t) => t.role === "user")?.text ?? "";
    if (!hasContactSignal(latestUser)) return;

    const lead = await extractLead(turns);
    if (!lead) return;

    // 🔴 只寫「有值」的欄位。萃取結果是 null 時不可以蓋掉先前抓到的資訊 ——
    //    客人第三句留了 Email、第八句在聊別的，第八次萃取回 null，
    //    整批覆蓋就會把 Email 洗掉。
    const patch: Record<string, string> = {};
    if (lead.contact_name) patch.contact_name = lead.contact_name;
    if (lead.contact_phone) patch.contact_phone = lead.contact_phone;
    if (lead.contact_email) patch.contact_email = lead.contact_email;
    if (lead.contact_line) patch.contact_line = lead.contact_line;
    if (lead.summary) patch.summary = lead.summary;
    if (lead.intent) patch.intent = lead.intent;

    if (Object.keys(patch).length > 0) {
      await db.from("ai_chat_logs").update(patch).eq("session_id", sessionId);
    }
  } catch (err) {
    console.error("[ai] 聯絡資訊萃取失敗", err instanceof Error ? err.message : err);
  }
}

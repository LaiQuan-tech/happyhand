import type { Metadata } from "next";
import { requireCapability, adminErrorMessage, AdminAuthError } from "@/lib/admin/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { DataList } from "@/components/admin/data-list";
import { formatTaipei } from "@/components/admin/datetime-field";
import { CHAT_LOG_COLS, type ChatLog, type ChatMsg } from "@/lib/ai/chat-log";
import { markHandled, markUnhandled } from "./actions";

/**
 * 小幫手諮詢紀錄。
 *
 * 這一頁要回答兩個問題：
 *   1.「有誰留了聯絡方式在等我們回？」→ 預設篩選就是這個
 *   2.「大家都在問什麼？」→ 切到「全部」看得到每一段對話
 *
 * 走 orders:read 而不是另開一個能力：這裡有姓名、Email、電話，
 * 敏感度跟訂單一樣。editor 拿不到 orders:*，所以也看不到這一頁——
 * 那是 lib/admin/roles.ts 裡刻意的切分，不要為了方便而放寬。
 *
 * ⚠️ 這一頁只有「標記已處理」一個 server action，沒有刪除。
 *    訪客的對話紀錄要刪，走資料庫，不做成一顆隨手可按的按鈕。
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "小幫手諮詢" };

const PAGE_SIZE = 50;

const MESSAGES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  handled: { tone: "ok", text: "已標記為處理完成。" },
  reopened: { tone: "ok", text: "已改回待處理。" },
  bad_id: { tone: "warn", text: "找不到這筆諮詢。" },
  denied: { tone: "warn", text: "你的帳號沒有查看諮詢紀錄的權限。" },
  failed: { tone: "warn", text: "更新失敗，請重試一次。" },
};

function Chip({ label, tone }: { label: string; tone: "ok" | "warn" | "neutral" }) {
  const cls =
    tone === "ok"
      ? "bg-ok-soft text-ok"
      : tone === "warn"
        ? "bg-cream-300 text-caramel-dk"
        : "bg-panel text-ink-soft";
  return (
    <span className={`inline-block rounded-pill px-[10px] py-[2px] text-[13px] ${cls}`}>
      {label}
    </span>
  );
}

/** 聯絡方式整理成一行。都沒有就回 null，讓呼叫端顯示「沒有留」。 */
function contactLine(row: ChatLog): string | null {
  const bits = [
    row.contact_name,
    row.contact_email,
    row.contact_phone,
    row.contact_line ? `LINE ${row.contact_line}` : null,
  ].filter(Boolean);
  return bits.length ? bits.join("・") : null;
}

function Transcript({ messages }: { messages: ChatMsg[] }) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return <p className="text-[14px] text-ink-soft">沒有對話內容。</p>;
  }
  return (
    <ul className="flex flex-col gap-[10px]">
      {messages.map((m, i) => (
        <li key={i} className="text-[14px] leading-[1.7]">
          <span
            className={
              m.role === "user"
                ? "mr-[6px] font-medium text-ink"
                : "mr-[6px] font-medium text-caramel-dk"
            }
          >
            {m.role === "user" ? "訪客" : "小幫手"}
          </span>
          <span className="whitespace-pre-wrap text-ink-soft">{m.text}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function AdminInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; msg?: string }>;
}) {
  try {
    await requireCapability("orders:read");
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return (
        <p className="rounded-card border border-line bg-panel px-4 py-6 text-[14px] text-ink-soft">
          {adminErrorMessage(err)}
        </p>
      );
    }
    throw err;
  }

  const { view = "followup", msg } = await searchParams;
  const message = msg ? MESSAGES[msg] : null;
  const followupOnly = view !== "all";
  const backHref = `/admin/inquiries?view=${followupOnly ? "followup" : "all"}`;

  const db = createServiceClient();
  let rows: ChatLog[] = [];
  let loadError: string | null = null;
  let pendingCount = 0;

  if (!db) {
    loadError = "資料庫沒有設定，讀不到諮詢紀錄。";
  } else {
    let q = db
      .from("ai_chat_logs")
      .select(CHAT_LOG_COLS)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE);
    if (followupOnly) q = q.eq("has_contact", true).is("handled_at", null);

    const [{ data, error }, { data: count }] = await Promise.all([
      q,
      db.rpc("count_pending_inquiries"),
    ]);
    if (error) {
      console.error("[admin/inquiries] 讀取失敗", error.message);
      loadError = "讀取諮詢紀錄失敗，請重新整理。";
    } else {
      rows = (data ?? []) as unknown as ChatLog[];
    }
    pendingCount = typeof count === "number" ? count : 0;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[20px] font-medium text-ink">小幫手諮詢</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          訪客在官網右下角小幫手裡問過的問題。留下聯絡方式的會排在「待跟進」。
        </p>
      </div>

      {message && (
        <p
          role={message.tone === "warn" ? "alert" : "status"}
          className={`rounded-card px-4 py-3 text-[14px] ${
            message.tone === "ok" ? "bg-ok-soft text-ok" : "bg-panel text-danger"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* 篩選走純連結，沒有 JavaScript 也能用，網址可以直接貼給同事 */}
      <nav aria-label="篩選" className="flex gap-[8px]">
        <a
          href="/admin/inquiries?view=followup"
          aria-current={followupOnly ? "page" : undefined}
          className={`min-h-[40px] rounded-pill px-[16px] py-[8px] text-[14px] ${
            followupOnly
              ? "bg-ink text-white"
              : "border border-line bg-paper text-ink-soft hover:border-line-strong"
          }`}
        >
          待跟進{pendingCount > 0 ? `（${pendingCount}）` : ""}
        </a>
        <a
          href="/admin/inquiries?view=all"
          aria-current={!followupOnly ? "page" : undefined}
          className={`min-h-[40px] rounded-pill px-[16px] py-[8px] text-[14px] ${
            !followupOnly
              ? "bg-ink text-white"
              : "border border-line bg-paper text-ink-soft hover:border-line-strong"
          }`}
        >
          全部對話
        </a>
      </nav>

      {loadError ? (
        <p className="rounded-card border border-line bg-panel px-4 py-6 text-[14px] text-danger">
          {loadError}
        </p>
      ) : (
        <DataList
          items={rows}
          keyOf={(r) => r.id}
          caption="小幫手諮詢紀錄"
          empty={
            followupOnly
              ? "目前沒有等著跟進的諮詢。切到「全部對話」可以看大家都在問什麼。"
              : "還沒有人用過小幫手。"
          }
          columns={[
            {
              header: "時間",
              cell: (r) => formatTaipei(r.created_at),
              className: "whitespace-nowrap",
            },
            {
              header: "聯絡方式",
              primary: true,
              cell: (r) => contactLine(r) ?? <span className="text-ink-muted">沒有留</span>,
            },
            {
              header: "狀態",
              trailing: true,
              cell: (r) =>
                r.handled_at ? (
                  <Chip label="已處理" tone="ok" />
                ) : r.has_contact ? (
                  <Chip label="待跟進" tone="warn" />
                ) : (
                  <Chip label="一般詢問" tone="neutral" />
                ),
            },
            {
              header: "想做什麼",
              cell: (r) => (
                <span className="text-ink-soft">
                  {r.summary || r.first_question || "—"}
                  {r.intent ? `（${r.intent}）` : ""}
                </span>
              ),
            },
            {
              header: "對話",
              desktopOnly: true,
              cell: (r) => (
                <details>
                  <summary className="cursor-pointer text-[14px] text-accent-ink">
                    {r.message_count} 則
                  </summary>
                  <div className="mt-[10px] max-w-[520px] rounded-card border border-line bg-panel p-[12px]">
                    <Transcript messages={r.messages} />
                  </div>
                </details>
              ),
            },
          ]}
          actions={(r) => (
            <form action={r.handled_at ? markUnhandled : markHandled}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="back" value={backHref} />
              <button
                type="submit"
                className="min-h-[40px] rounded-input border border-line bg-paper px-[14px] text-[14px] text-ink transition-colors duration-200 hover:border-line-strong"
              >
                {r.handled_at ? "改回待處理" : "標記已處理"}
              </button>
            </form>
          )}
        />
      )}

      {rows.length >= PAGE_SIZE && (
        <p className="text-[13px] text-ink-soft">
          只顯示最近 {PAGE_SIZE} 筆。更早的紀錄還在資料庫裡。
        </p>
      )}
    </div>
  );
}

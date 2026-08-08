/**
 * workshop-reminders — 每天台北時間 09:00 寄開課提醒。
 *
 * 對象：開課前 3 天（stage d3）與前 1 天（stage d1）的場次，
 *       且該場次有「已付款訂單」的報名者。
 *
 * 寄信走 Resend；沒有設定 RESEND_API_KEY 時只記 log 不寄（dry run）。
 *
 * 去重寫在 DB 的 notification_log（寄信前先 insert 佔位，撞到 unique constraint
 * 就代表已經寄過）→ 重啟與多副本都不會重寄。詳見 src/lib/db.ts 的
 * claimNotification() 與 supabase/migrations/..._notification_log.sql。
 */

import {
  claimNotification,
  fetchUserEmails,
  findNotifiedSessionIds,
  findOrderItemsBySessionIds,
  findPaidOrdersByIds,
  findProductsByIds,
  findProfilesByIds,
  findSessionsStartingBetween,
} from "../lib/db.js";
import type { EmailMessage, SendOutcome } from "../lib/email.js";
import { maskEmail } from "../lib/privacy.js";
import {
  formatTaipeiRange,
  taipeiDayRange,
  taipeiDaysUntil,
  type InstantRange,
} from "../lib/time.js";
import type { JobContext, JobDefinition, JobResult } from "../lib/runner.js";
import type {
  Attendee,
  ProductRow,
  ReminderStage,
  WorkshopSessionRow,
} from "../lib/types.js";

/** 客服電話，來源：design_handoff_happyhands/CONTENT.md 的 FAQ。 */
const SUPPORT_PHONE = "02-2833-5820";

const STAGES: ReadonlyArray<{ stage: ReminderStage; daysAhead: number }> = [
  { stage: "d3", daysAhead: 3 },
  { stage: "d1", daysAhead: 1 },
];

interface SessionBundle {
  session: WorkshopSessionRow;
  product: ProductRow | null;
  attendees: Attendee[];
}

// ---------------------------------------------------------------------------
// 掃描視窗
// ---------------------------------------------------------------------------

/**
 * 某個階段這一輪要掃的時間區間。
 *
 * 「開課前 3 天」不是只掃第 3 天那一整天，而是掃**第 2 天到第 3 天**，
 * 多含一天當補寄寬限：若昨天 09:00 那一輪整個失敗（例如 Supabase 剛好在維護），
 * 昨天該收 d3 的場次今天變成「2 天後」，仍然落在區間內 → 今天補寄得掉。
 * 已經寄過的場次由 notification_log 擋住，不會因為區間變寬就重寄。
 *
 * 兩個階段的區間刻意**不重疊**（d3 = 第 2～3 天、d1 = 今天～明天），
 * 否則明天開課又還沒收過 d3 的場次，會在同一個早上一次收到兩封信。
 *
 * 下界不早於 now：已經開始的場次不必再提醒。
 */
function reminderWindow(daysAhead: number, now: Date): InstantRange {
  const nowIso = now.toISOString();
  // 兩者都是 toISOString() 的固定格式（UTC、毫秒補滿），字典序比較 = 時間先後
  const slackStart = taipeiDayRange(daysAhead - 1, now).startIso;

  return {
    startIso: slackStart > nowIso ? slackStart : nowIso,
    endIso: taipeiDayRange(daysAhead, now).endIso,
  };
}

// ---------------------------------------------------------------------------
// 資料組裝
// ---------------------------------------------------------------------------

/**
 * 找出這些場次各自的已付款報名者。
 *
 * 一次把所有場次的資料撈齊再在記憶體 group，避免對每個場次各發一輪查詢。
 *
 * email 來源優先序：
 *   1. `orders.contact_email` —— 結帳時本人填的，也是他預期會收到通知的信箱
 *   2. `auth.users.email` —— 只在 1 沒有值且訂單有綁會員時才查
 *
 * ⚠️ `orders.user_id` 可以是 null（電話／LINE 代訂由客服建單，或會員已刪帳號）。
 * 這類訂單**必須**照樣寄提醒 —— 打電話請客服代訂的多半正是最需要提醒的長輩客人。
 * 所以這裡一律以「訂單」為單位處理，不用 user_id 當必要條件。
 */
async function collectAttendees(
  ctx: JobContext,
  sessions: readonly WorkshopSessionRow[],
): Promise<Map<string, Attendee[]>> {
  const bySession = new Map<string, Attendee[]>();
  if (sessions.length === 0) return bySession;

  const sessionIds = sessions.map((session) => session.id);
  const items = await findOrderItemsBySessionIds(ctx.supabase, sessionIds);
  if (items.length === 0) return bySession;

  const orderIds = [...new Set(items.map((item) => item.order_id))];
  const paidOrders = await findPaidOrdersByIds(ctx.supabase, orderIds);
  const paidById = new Map(paidOrders.map((order) => [order.id, order]));

  // 只有「有綁帳號、但沒填 contact_email」的訂單才需要走 auth admin API
  const needsLookup = [
    ...new Set(
      paidOrders
        .filter((order) => order.contact_email === null || order.contact_email.trim() === "")
        .map((order) => order.user_id)
        .filter((userId): userId is string => typeof userId === "string"),
    ),
  ];
  // profiles 只用來補姓名，同樣只查需要的人
  const [profiles, emails] = await Promise.all([
    findProfilesByIds(ctx.supabase, needsLookup),
    fetchUserEmails(ctx.supabase, needsLookup),
  ]);

  // 同一場次、同一收件信箱只寄一封（同一人可能有兩張已付款訂單）
  const seen = new Set<string>();

  for (const item of items) {
    const sessionId = item.session_id;
    if (sessionId === null) continue;

    const order = paidById.get(item.order_id);
    if (order === undefined) continue; // 未付款／已取消／已退款 → 不寄

    const userId = order.user_id;
    const contactEmail = order.contact_email?.trim() ?? "";
    const fallbackEmail = userId === null ? undefined : emails.get(userId);

    let email: string | null = null;
    let emailSource: Attendee["emailSource"] = "none";
    if (contactEmail !== "") {
      email = contactEmail;
      emailSource = "order_contact";
    } else if (fallbackEmail !== undefined) {
      email = fallbackEmail;
      emailSource = "auth_user";
    }

    // 沒有 email 的用 order id 當去重鍵，才不會讓多筆「無信箱」訂單互相覆蓋
    const dedupeKey =
      email === null ? `${sessionId}:order:${order.id}` : `${sessionId}:${email.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const profileName = userId === null ? null : (profiles.get(userId)?.full_name ?? null);

    const attendee: Attendee = {
      userId,
      orderNo: order.order_no,
      email,
      // 結帳填的姓名優先：代訂訂單只有這個有值
      fullName: order.contact_name?.trim() || profileName,
      emailSource,
    };

    const list = bySession.get(sessionId);
    if (list === undefined) {
      bySession.set(sessionId, [attendee]);
    } else {
      list.push(attendee);
    }
  }

  return bySession;
}

// ---------------------------------------------------------------------------
// 信件內容
// ---------------------------------------------------------------------------

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface ReminderCopy {
  /** 主旨用的稱呼，會接上「見」 */
  label: string;
  /** 內文第一句 */
  opening: string;
}

/**
 * 稱呼依「實際還剩幾天」決定，不是依階段代號。
 *
 * 因為掃描視窗帶了一天補寄寬限（見 reminderWindow），d3 有可能是在開課前
 * 2 天才補寄出去 —— 那時候還寫「三天後見」就是對客人說謊，
 * 長輩客群更可能因此把日期記錯。
 */
const COPY_BY_DAYS: Record<number, ReminderCopy> = {
  0: { label: "今天", opening: "今天就是上課的日子了，這封信提醒您時間和地點。" },
  1: { label: "明天", opening: "明天就是上課的日子了，這封信提醒您時間和地點。" },
  2: { label: "後天", opening: "再過兩天就要上課了，先把時間和地點提醒您一次。" },
  3: { label: "三天後", opening: "再過三天就要上課了，先把時間和地點提醒您一次。" },
};

function copyForDaysUntil(daysUntil: number): ReminderCopy {
  return (
    COPY_BY_DAYS[daysUntil] ?? {
      label: `${daysUntil} 天後`,
      opening: `再過 ${daysUntil} 天就要上課了，先把時間和地點提醒您一次。`,
    }
  );
}

function buildMessage(
  bundle: SessionBundle,
  attendee: Attendee,
  daysUntil: number,
): EmailMessage | null {
  if (attendee.email === null) return null;

  const title = bundle.product?.title ?? "快樂手工作坊";
  const when = formatTaipeiRange(bundle.session.starts_at, bundle.session.ends_at);
  const location = bundle.session.location ?? "好日子・台北教室";
  const address = bundle.session.address ?? "";
  const greeting = attendee.fullName ?? "同學";

  const copy = copyForDaysUntil(daysUntil);
  const subject = `【快樂手】${copy.label}見：${title}`;
  const openingLine = copy.opening;

  const lines: string[] = [
    `${greeting} 您好，`,
    "",
    openingLine,
    "",
    `課程：${title}`,
    `時間：${when}`,
    `地點：${location}`,
  ];
  if (address !== "") lines.push(`地址：${address}`);
  lines.push(
    `訂單編號：${attendee.orderNo}`,
    "",
    "小提醒：",
    "・穿寬鬆一點的衣服，比較好活動。",
    "・提前十分鐘到，可以先坐下來喘口氣。",
    "・膝蓋或腰不舒服都沒關係，現場有替代姿勢，也有助教陪著。",
    "",
    `臨時有狀況不能來，打 ${SUPPORT_PHONE} 跟我們說一聲就好。`,
    "",
    "課堂上見。",
    "快樂手．好日子",
  );
  const text = lines.join("\n");

  // 信件用 inline style：多數郵件客戶端會擋掉 <style> 區塊。
  // 字級刻意放大（17px 內文、行高 1.9），對應長輩為主的客群。
  const html = `<!doctype html>
<html lang="zh-Hant">
<body style="margin:0;padding:24px;background:#FBF5EC;font-family:'Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;color:#2B2B2B;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border-radius:16px;padding:32px 28px;">
    <p style="font-size:17px;line-height:1.9;margin:0 0 20px;">${escapeHtml(greeting)} 您好，</p>
    <p style="font-size:17px;line-height:1.9;margin:0 0 24px;">${escapeHtml(openingLine)}</p>

    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:17px;line-height:1.9;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#7A6A55;width:72px;vertical-align:top;">課程</td><td style="padding:6px 0;">${escapeHtml(title)}</td></tr>
      <tr><td style="padding:6px 0;color:#7A6A55;vertical-align:top;">時間</td><td style="padding:6px 0;">${escapeHtml(when)}</td></tr>
      <tr><td style="padding:6px 0;color:#7A6A55;vertical-align:top;">地點</td><td style="padding:6px 0;">${escapeHtml(location)}</td></tr>
      ${address === "" ? "" : `<tr><td style="padding:6px 0;color:#7A6A55;vertical-align:top;">地址</td><td style="padding:6px 0;">${escapeHtml(address)}</td></tr>`}
      <tr><td style="padding:6px 0;color:#7A6A55;vertical-align:top;">訂單</td><td style="padding:6px 0;">${escapeHtml(attendee.orderNo)}</td></tr>
    </table>

    <p style="font-size:17px;line-height:1.9;margin:24px 0 8px;font-weight:700;">小提醒</p>
    <ul style="font-size:17px;line-height:1.9;margin:0 0 24px;padding-left:20px;">
      <li>穿寬鬆一點的衣服，比較好活動。</li>
      <li>提前十分鐘到，可以先坐下來喘口氣。</li>
      <li>膝蓋或腰不舒服都沒關係，現場有替代姿勢，也有助教陪著。</li>
    </ul>

    <p style="font-size:17px;line-height:1.9;margin:0 0 24px;">臨時有狀況不能來，打 <a href="tel:${SUPPORT_PHONE.replace(/-/g, "")}" style="color:#2B2B2B;">${SUPPORT_PHONE}</a> 跟我們說一聲就好。</p>
    <p style="font-size:17px;line-height:1.9;margin:0;">課堂上見。<br />快樂手．好日子</p>
  </div>
</body>
</html>`;

  return { to: attendee.email, subject, text, html };
}

// ---------------------------------------------------------------------------
// Job
// ---------------------------------------------------------------------------

async function handler(ctx: JobContext): Promise<JobResult> {
  const tally: Record<SendOutcome, number> = { sent: 0, dry_run: 0, failed: 0 };
  let sessionsMatched = 0;
  let sessionsProcessed = 0;
  let sessionsSkippedDuplicate = 0;
  let recipientsWithoutEmail = 0;

  for (const { stage, daysAhead } of STAGES) {
    const range = reminderWindow(daysAhead, ctx.now);
    const sessions = await findSessionsStartingBetween(
      ctx.supabase,
      range.startIso,
      range.endIso,
    );
    sessionsMatched += sessions.length;

    ctx.log.debug("reminder_window_scanned", {
      stage,
      window_start: range.startIso,
      window_end: range.endIso,
      sessions: sessions.length,
    });
    if (sessions.length === 0) continue;

    // 已寄過的場次先剔除，才不用白跑後面的查詢。
    // 真正的互斥在下面的 claimNotification()，這裡純粹是省往返
    // ——視窗帶了一天寬限，每個場次平均會被掃到兩次。
    const alreadySent = await findNotifiedSessionIds(
      ctx.supabase,
      sessions.map((session) => session.id),
      stage,
    );
    const pending = sessions.filter((session) => {
      if (!alreadySent.has(session.id)) return true;
      sessionsSkippedDuplicate += 1;
      ctx.log.debug("reminder_skipped_duplicate", { stage, session_id: session.id });
      return false;
    });
    if (pending.length === 0) continue;

    const productIds = [
      ...new Set(
        pending
          .map((session) => session.product_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    ];
    const [products, attendeesBySession] = await Promise.all([
      findProductsByIds(ctx.supabase, productIds),
      collectAttendees(ctx, pending),
    ]);

    for (const session of pending) {
      // 先宣告再寄。insert 撞到 unique constraint = 別的副本剛接手，
      // 或這個場次在上面的剔除清單算出來之後才被寄掉 → 這一輪不要碰。
      // 反過來「寄完才記錄」會讓兩個副本同時通過檢查、同一封信寄兩次。
      const claimed = await claimNotification(ctx.supabase, session.id, stage);
      if (!claimed) {
        sessionsSkippedDuplicate += 1;
        ctx.log.info("reminder_claim_lost", {
          stage,
          session_id: session.id,
          hint: "notification_log 已有這一列，代表別人已經寄過，這一輪跳過。",
        });
        continue;
      }

      const attendees = attendeesBySession.get(session.id) ?? [];
      const bundle: SessionBundle = {
        session,
        product: session.product_id === null ? null : (products.get(session.product_id) ?? null),
        attendees,
      };

      if (attendees.length === 0) {
        // 沒有已付款報名者：上面的 claim 已經標記過，之後不會再重掃這個場次。
        // （代價是這場次之後才報名的人收不到這一階段的提醒，但下一階段仍會寄。）
        ctx.log.info("reminder_no_attendees", {
          stage,
          session_id: session.id,
          starts_at: session.starts_at,
        });
        continue;
      }

      // 稱呼用實際剩餘天數，補寄時才不會寫成「三天後見」（見 copyForDaysUntil）
      const daysUntil = Math.max(0, taipeiDaysUntil(session.starts_at, ctx.now));

      const messages: EmailMessage[] = [];
      for (const attendee of attendees) {
        const message = buildMessage(bundle, attendee, daysUntil);
        if (message === null) {
          recipientsWithoutEmail += 1;
          ctx.log.warn("reminder_recipient_without_email", {
            stage,
            session_id: session.id,
            user_id: attendee.userId,
            order_no: attendee.orderNo,
            hint:
              "這筆訂單沒有 contact_email，也查不到對應的 auth 帳號 email" +
              "（常見於電話／LINE 代訂）。這位報名者需要人工打電話通知。",
          });
          continue;
        }
        messages.push(message);
      }

      // sendAll 不會拋例外：個別寄信失敗會被它 catch 起來計進 failed，
      // 並各自留一筆 email_send_failed / email_send_error，需要人工補寄。
      const result = await ctx.mailer.sendAll(messages);
      tally.sent += result.sent;
      tally.dry_run += result.dry_run;
      tally.failed += result.failed;
      sessionsProcessed += 1;

      ctx.log.info("reminder_session_processed", {
        stage,
        days_until: daysUntil,
        session_id: session.id,
        starts_at: session.starts_at,
        product_slug: bundle.product?.slug ?? null,
        recipients: messages.length,
        sent: result.sent,
        dry_run: result.dry_run,
        failed: result.failed,
        email_from_order_contact: attendees.filter((a) => a.emailSource === "order_contact").length,
        email_from_auth_user: attendees.filter((a) => a.emailSource === "auth_user").length,
        sample_recipient: maskEmail(messages[0]?.to),
      });
    }
  }

  return {
    sessions_matched: sessionsMatched,
    sessions_processed: sessionsProcessed,
    sessions_skipped_duplicate: sessionsSkippedDuplicate,
    recipients_without_email: recipientsWithoutEmail,
    emails_sent: tally.sent,
    emails_dry_run: tally.dry_run,
    emails_failed: tally.failed,
    mailer_dry_run: ctx.mailer.dryRun,
  };
}

export const workshopRemindersJob: JobDefinition = {
  name: "workshop-reminders",
  schedule: "0 9 * * *",
  description: "每天台北時間 09:00 寄出開課前 3 天與前 1 天的工作坊提醒信（含前一天失敗的補寄）",
  handler,
};

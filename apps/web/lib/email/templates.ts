import "server-only";

import { SITE, formatPrice } from "@/lib/site";
import type { EmailMessage } from "@/lib/email/resend";

/**
 * 交易信版型。
 *
 * 對 60–75 歲客群的三個硬性要求：
 *   1. 字級 ≥ 16px、行高 1.9（信件客戶端不吃我們的 CSS token，只能寫死）
 *   2. 按鈕 ≥ 44px 高、整寬、有文字（不是只有箭頭或圖示）
 *   3. **不用圖片當唯一資訊載體** —— 很多長輩的信箱預設擋圖，
 *      擋掉之後信要照樣讀得懂。所以這裡完全沒有 <img>。
 *
 * 一律 inline style：多數郵件客戶端會擋掉 <style> 區塊
 * （worker 的 workshop-reminders.ts 已經踩過同一個坑）。
 *
 * ⚠️ 法規：不得有醫療宣稱（README §免責）。文案只能寫「練習」「保健」，
 *    不能寫療效。
 */

const INK = "#3A2A1E";
const SOFT = "#7A6552";
const CARAMEL = "#A9702F";
const PAPER = "#FFFDF8";
const LINE_C = "#E6D5BC";

export function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:24px 0;">
  <tr><td align="center" bgcolor="${CARAMEL}" style="border-radius:999px;">
    <a href="${escapeHtml(href)}" style="display:block;padding:15px 32px;font-size:18px;line-height:1.4;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

function paragraph(text: string): string {
  return `<p style="margin:0 0 14px;font-size:17px;line-height:1.9;color:${INK};">${escapeHtml(text)}</p>`;
}

/** key-value 資訊卡。長輩看得懂的排版：標籤在上、值在下，不要並排小字。 */
function infoCard(rows: readonly (readonly [string, string])[]): string {
  const items = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:10px 0;border-bottom:1px solid ${LINE_C};">
          <div style="font-size:15px;line-height:1.6;color:${SOFT};">${escapeHtml(label)}</div>
          <div style="font-size:18px;line-height:1.6;color:${INK};font-weight:bold;">${escapeHtml(value)}</div>
        </td></tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;">${items}</table>`;
}

function layout(bodyHtml: string): string {
  return `<div style="margin:0;padding:24px 12px;background-color:#F4EADB;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background-color:${PAPER};border-radius:16px;">
    <tr><td style="padding:32px 28px;font-family:-apple-system,'PingFang TC','Noto Sans TC','Microsoft JhengHei',sans-serif;">
      <div style="font-size:20px;line-height:1.6;font-weight:bold;color:${CARAMEL};margin-bottom:20px;">${SITE.brandZh}</div>
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid ${LINE_C};margin:28px 0 18px;">
      <p style="margin:0 0 10px;font-size:15px;line-height:1.8;color:${SOFT};">
        有任何問題，<a href="${SITE.lineHref}" style="color:${CARAMEL};font-weight:bold;">用 LINE 問我們</a>就可以，報一下你的名字就好。
      </p>
      <p style="margin:0;font-size:13px;line-height:1.7;color:${SOFT};">
        ${escapeHtml(SITE.company)}・LINE ${escapeHtml(SITE.lineId)}<br>${escapeHtml(SITE.address)}
      </p>
    </td></tr>
  </table>
</div>`;
}

/** 純文字版的頁尾。擋圖或用純文字讀信的人看到的是這個。 */
function textFooter(): string {
  return `

--
有任何問題，用 LINE 問我們就可以，報一下你的名字就好：
${SITE.lineHref}

${SITE.company}
LINE ${SITE.lineId}
${SITE.address}`;
}

/* ------------------------------------------------------------------ 訂單成立 */

const PAYMENT_NEXT_STEP: Record<string, string> = {
  atm: `匯款帳號請用 LINE 跟我們拿，戶名是${SITE.company}。匯款之後我們對帳完成就會開通，大約一個工作天。`,
  credit: "線上刷卡還在開通中，所以我們會用 LINE 跟你確認付款方式。現在還沒有跟你收款，請放心。",
  manual: "這筆是請我們代訂的。我們會用 LINE 跟你確認課程與付款方式，你也可以直接用 LINE 找我們。",
};

/**
 * 一筆工作坊品項的上課資訊。
 *
 * 🔴 一定要由伺服器端從 workshop_sessions 讀，不要用購物車帶上來的
 *    session_label —— 那是客戶端字串，客人改得動，而這封信是客人唯一
 *    會收到的「哪天去哪裡」。
 */
export type EmailSessionInfo = {
  /** 已格式化的台北時間，例如「9月12日（週六）09:30–17:00」 */
  when: string;
  location: string | null;
  address: string | null;
};

export function orderCreatedEmail(input: {
  to: string;
  name: string;
  orderNo: string;
  total: number;
  paymentMethod: string | null;
  items: readonly { title: string; qty: number; session?: EmailSessionInfo | null }[];
}): EmailMessage {
  const nextStep =
    PAYMENT_NEXT_STEP[input.paymentMethod ?? "manual"] ?? PAYMENT_NEXT_STEP["manual"]!;
  const itemLines = input.items.map((i) => `・${i.title}${i.qty > 1 ? ` ×${i.qty}` : ""}`);

  // 實體場次的上課資訊。多堂就逐堂列，標題放前面才分得出是哪一堂。
  const booked = input.items.flatMap((i) =>
    i.session ? [{ title: i.title, session: i.session }] : [],
  );
  const multi = booked.length > 1;
  const sessionRows: [string, string][] = booked.flatMap(({ title, session }) => {
    const prefix = multi ? `${title}・` : "";
    const rows: [string, string][] = [[`${prefix}上課時間`, session.when]];
    if (session.location) rows.push([`${prefix}上課地點`, session.location]);
    if (session.address) rows.push([`${prefix}地址`, session.address]);
    return rows;
  });
  const sessionText =
    sessionRows.length === 0
      ? ""
      : `\n${sessionRows.map(([k, v]) => `${k}：${v}`).join("\n")}\n`;

  const text = `${input.name} 你好，

我們收到你的訂單了。

訂單編號：${input.orderNo}
${itemLines.join("\n")}
金額：${formatPrice(input.total)}
${sessionText}
接下來
${nextStep}

用 LINE 問我們的時候，把訂單編號貼給我們就可以了。${textFooter()}`;

  const html = layout(`
    ${paragraph(`${input.name} 你好，`)}
    ${paragraph("我們收到你的訂單了。")}
    ${infoCard([
      ["訂單編號", input.orderNo],
      ["購買內容", itemLines.join("\n").replaceAll("\n", "、").replaceAll("・", "")],
      ["金額", formatPrice(input.total)],
      ...sessionRows,
    ])}
    <p style="margin:0 0 8px;font-size:18px;line-height:1.6;font-weight:bold;color:${INK};">接下來</p>
    ${paragraph(nextStep)}
    ${paragraph("用 LINE 問我們的時候，把訂單編號貼給我們就可以了。")}
  `);

  return { to: input.to, subject: `我們收到你的訂單了（${input.orderNo}）`, text, html };
}

/* ------------------------------------------------------------ 開課提醒 */

/**
 * 開課提醒信。原型是 apps/worker 的 workshop-reminders job，搬進 web 端時改了兩處：
 *
 * 1. **不放電話。** worker 版寫死 02-2833-5820，但 lib/site.ts 已經明訂
 *    「聯絡方式一律走 LINE 官方帳號，站上不再放電話」。信裡放一支站上都不
 *    公開的號碼，等於用交易信繞過那個決定。改走 layout() 既有的 LINE 出口。
 * 2. 版型改用共用的 layout/infoCard，跟其他交易信長得一樣。
 *
 * ⚠️ 法規：不得有醫療宣稱（README §免責），文案只能寫「練習」「保健」。
 */
export function workshopReminderEmail(input: {
  to: string;
  name: string;
  stage: "d3" | "d1";
  title: string;
  when: string;
  location: string | null;
  address: string | null;
  orderNo: string;
}): EmailMessage {
  const subject =
    input.stage === "d3"
      ? `三天後見：${input.title}`
      : `明天見：${input.title}`;
  const opening =
    input.stage === "d3"
      ? "再過三天就要上課了，先把時間和地點提醒你一次。"
      : "明天就是上課的日子了，這封信提醒你時間和地點。";

  const rows: [string, string][] = [
    ["課程", input.title],
    ["時間", input.when],
  ];
  if (input.location) rows.push(["地點", input.location]);
  if (input.address) rows.push(["地址", input.address]);
  rows.push(["訂單編號", input.orderNo]);

  const tips = [
    "穿寬鬆一點的衣服，比較好活動。",
    "提前十分鐘到，可以先坐下來喘口氣。",
    "膝蓋或腰不舒服都沒關係，現場有替代姿勢，也有助教陪著。",
  ];

  const text = `${input.name} 你好，

${opening}

${rows.map(([k, v]) => `${k}：${v}`).join("\n")}

小提醒
${tips.map((t) => `・${t}`).join("\n")}

臨時有狀況不能來，用 LINE 跟我們說一聲就好。

課堂上見。${textFooter()}`;

  const html = layout(`
    ${paragraph(`${input.name} 你好，`)}
    ${paragraph(opening)}
    ${infoCard(rows)}
    <p style="margin:0 0 8px;font-size:18px;line-height:1.6;font-weight:bold;color:${INK};">小提醒</p>
    <ul style="margin:0 0 18px;padding-left:20px;font-size:17px;line-height:1.9;color:${INK};">
      ${tips.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}
    </ul>
    ${paragraph("臨時有狀況不能來，用 LINE 跟我們說一聲就好。")}
    ${paragraph("課堂上見。")}
  `);

  return { to: input.to, subject, text, html };
}

/* ---------------------------------------------------------------- 設定密碼 */

export function accountSetupEmail(input: {
  to: string;
  name: string;
  link: string;
  orderNo: string;
  orderDate: string;
}): EmailMessage {
  const text = `${input.name} 你好，

因為你在 ${input.orderDate} 訂了課（訂單編號 ${input.orderNo}），我們幫你開了一個帳號。
設定一組密碼之後，就可以登入看你買的課程和訂單。

設定密碼：
${input.link}

・這個連結一個小時內有效，而且只能用一次。
・如果你按了兩次「忘記密碼」，請用最新收到的那一封，舊的會失效。
・如果這不是你本人操作，把這封信忽略掉就好，你的帳號不會有任何變化。${textFooter()}`;

  const html = layout(`
    ${paragraph(`${input.name} 你好，`)}
    ${paragraph(`因為你在 ${input.orderDate} 訂了課（訂單編號 ${input.orderNo}），我們幫你開了一個帳號。設定一組密碼之後，就可以登入看你買的課程和訂單。`)}
    ${button(input.link, "設定我的密碼")}
    <p style="margin:0 0 14px;font-size:15px;line-height:1.9;color:${SOFT};">
      ・這個連結一個小時內有效，而且只能用一次。<br>
      ・如果你按了兩次「忘記密碼」，請用最新收到的那一封，舊的會失效。<br>
      ・如果這不是你本人操作，把這封信忽略掉就好，你的帳號不會有任何變化。
    </p>
  `);

  return { to: input.to, subject: "你的快樂手帳號好了，請設定密碼", text, html };
}

/* ---------------------------------------------------------------- 課程開通 */

export function orderPaidEmail(input: {
  to: string;
  name: string;
  orderNo: string;
  courseTitles: readonly string[];
}): EmailMessage {
  const list = input.courseTitles.map((t) => `・${t}`).join("\n");
  const learnUrl = `${SITE.url}/account`;

  const text = `${input.name} 你好，

我們收到款項了，你的課程已經開通，現在就可以開始上課。

已經開通的課：
${list}

去上課：
${learnUrl}

課程不限觀看次數，也沒有觀看期限，你想看幾次都可以，慢慢來沒關係。

（訂單編號 ${input.orderNo}）${textFooter()}`;

  const html = layout(`
    ${paragraph(`${input.name} 你好，`)}
    ${paragraph("我們收到款項了，你的課程已經開通，現在就可以開始上課。")}
    <p style="margin:0 0 8px;font-size:18px;line-height:1.6;font-weight:bold;color:${INK};">已經開通的課</p>
    <p style="margin:0 0 14px;font-size:17px;line-height:1.9;color:${INK};">
      ${input.courseTitles.map((t) => escapeHtml(t)).join("<br>")}
    </p>
    ${button(learnUrl, "去上課")}
    <p style="margin:0 0 14px;padding:14px 16px;background-color:#F4EADB;border-radius:12px;font-size:17px;line-height:1.8;color:${INK};">
      <strong>課程不限觀看次數，也沒有觀看期限。</strong><br>你想看幾次都可以，慢慢來沒關係。
    </p>
    <p style="margin:0;font-size:15px;line-height:1.8;color:${SOFT};">訂單編號 ${escapeHtml(input.orderNo)}</p>
  `);

  return { to: input.to, subject: "你的課程開通好了，可以開始上課", text, html };
}

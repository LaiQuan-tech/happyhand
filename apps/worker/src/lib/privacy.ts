/**
 * Log 去識別化工具。
 *
 * 原則：Railway 的 log 保留期長、團隊多人可見，也可能轉送第三方 log 服務，
 * 所以 worker 的 log 一律不寫完整 email／電話／姓名。
 * 需要對帳或查人時，log 裡給 order_no 與 user_id（UUID），到後台查即可。
 */

/** a***@example.com — 保留首字與網域，足以辨識但無法直接寄信。 */
export function maskEmail(email: string | null | undefined): string {
  if (typeof email !== "string" || email === "") return "(none)";
  const at = email.lastIndexOf("@");
  if (at <= 0) return "(invalid)";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}***@${domain}`;
}

/** 只留最後 3 碼：****678 */
export function maskPhone(phone: string | null | undefined): string {
  if (typeof phone !== "string" || phone === "") return "(none)";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 3) return "***";
  return `****${digits.slice(-3)}`;
}

/** 姓名只留姓：劉** */
export function maskName(name: string | null | undefined): string {
  if (typeof name !== "string" || name.trim() === "") return "(none)";
  const trimmed = name.trim();
  return `${trimmed.slice(0, 1)}${"*".repeat(Math.max(trimmed.length - 1, 1))}`;
}

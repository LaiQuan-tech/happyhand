/**
 * Email 網域錯字提示。
 *
 * 為什麼值得做：訂單的 contact_email 現在是「這個人是誰」的唯一鍵 ——
 * 帳號用它建、開通信寄到它、之後登入靠它歸戶。打錯一個字，客人就會
 * 收不到設定密碼信、登入後看到空的「我的學習」，然後打 LINE 說「我明明買了」。
 * 對 60–75 歲客群，事前擋下一個錯字的效益遠大於事後補救的三顆按鈕。
 *
 * 刻意**不自動改**使用者輸入的東西（長輩會慌，而且我們可能猜錯），
 * 只顯示一句問句加一顆按鈕，由他自己決定。
 *
 * 也刻意不做 MX 查詢：結帳熱路徑不該加上不可預測的網路延遲，
 * 而且公司自架信箱的誤判率不低。
 *
 * 純函式、零 import —— client 元件直接用。
 */

/** 台灣常見的信箱網域。順序無關，比對是全表掃描（只有十幾筆）。 */
const COMMON_DOMAINS = [
  "gmail.com",
  "yahoo.com.tw",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "livemail.tw",
  "msa.hinet.net",
  "seed.net.tw",
  "so-net.net.tw",
  "pchome.com.tw",
  "ms.hinet.net",
] as const;

/**
 * Levenshtein 距離，但一旦超過 max 就提早收工。
 * 網域字串很短（≤ 16 字），不需要更聰明的做法。
 */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }

  return prev[b.length] ?? max + 1;
}

/**
 * 猜使用者是不是把網域打錯了。
 *
 * 回傳完整的建議 Email（例如 `wang@gmail.com`），沒有可疑之處時回 null。
 * 距離 0（完全相符）也回 null —— 打對了就不要囉唆。
 */
export function suggestEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!domain.includes(".")) return null;

  // 已經是正確網域就不要提示
  if ((COMMON_DOMAINS as readonly string[]).includes(domain)) return null;

  let best: { domain: string; distance: number } | null = null;
  for (const candidate of COMMON_DOMAINS) {
    // 短網域用距離 1，長一點的才容忍 2 ——
    // 不然 me.com 會把幾乎所有三四個字的網域都吸過來。
    const max = candidate.length <= 8 ? 1 : 2;
    const distance = editDistance(domain, candidate, max);
    if (distance <= max && (best === null || distance < best.distance)) {
      best = { domain: candidate, distance };
    }
  }

  return best ? `${local}@${best.domain}` : null;
}

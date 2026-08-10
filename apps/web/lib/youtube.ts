/**
 * YouTube 影片 ID 的解析與組裝。
 *
 * 純函式、零 import —— server action 與後台表單都直接用。
 *
 * 為什麼要解析而不是叫員工貼 ID：好日子的員工不會知道什麼叫「影片 ID」，
 * 他們只會把網址列裡的東西整條複製下來。後台欄位因此叫「YouTube 影片網址」，
 * 五種常見形式都吃。
 *
 * ⚠️ 影片一律設「**不公開**」（unlisted），不是「公開」也不是「私人」。
 *    ・公開 → 任何人搜尋得到，付費內容等於免費
 *    ・私人 → 只有被指定的 Google 帳號看得到、而且無法嵌入，學員沒有 Google 帳號
 *    這件事沒有任何程式碼可以檢查，只能靠上傳的人記得。README 有寫。
 */

/** YouTube 的影片 ID 一律是 11 碼的 base64url 字元。 */
const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * 從使用者貼進來的字串抽出 11 碼影片 ID。
 *
 * 吃得下：
 *   https://www.youtube.com/watch?v=XXXXXXXXXXX&t=30s
 *   https://youtu.be/XXXXXXXXXXX?si=abc
 *   https://www.youtube.com/embed/XXXXXXXXXXX
 *   https://www.youtube.com/shorts/XXXXXXXXXXX
 *   https://www.youtube.com/live/XXXXXXXXXXX
 *   XXXXXXXXXXX（裸 ID）
 *
 * 認不出來就回 null —— 呼叫端要顯示「這看起來不像 YouTube 網址」
 * 而不是默默存一個壞值進去（那會變成播不出來但沒人知道為什麼）。
 */
export function parseYouTubeId(raw: string): string | null {
  const input = raw.trim();
  if (!input) return null;

  // 裸 ID
  if (ID_RE.test(input)) return input;

  // 沒有 protocol 的話補一個，否則 URL 解析不了 "youtu.be/xxx"
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  // youtu.be/<id>
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0] ?? "";
    return ID_RE.test(id) ? id : null;
  }

  if (
    host !== "youtube.com" &&
    host !== "m.youtube.com" &&
    host !== "youtube-nocookie.com"
  ) {
    return null;
  }

  // watch?v=<id>
  const v = url.searchParams.get("v");
  if (v && ID_RE.test(v)) return v;

  // /embed/<id>、/shorts/<id>、/live/<id>、/v/<id>
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2) {
    const [prefix, candidate] = segments;
    if (
      (prefix === "embed" ||
        prefix === "shorts" ||
        prefix === "live" ||
        prefix === "v") &&
      candidate &&
      ID_RE.test(candidate)
    ) {
      return candidate;
    }
  }

  return null;
}

export function isYouTubeId(value: string): boolean {
  return ID_RE.test(value);
}

/**
 * 給後台回填輸入框用的完整網址。
 *
 * 存的是 11 碼 ID，但員工再打開編輯頁時看到一串 `dQw4w9WgXcQ` 會不知道那是什麼，
 * 也沒辦法直接點開確認影片對不對。所以顯示成完整網址。
 */
export function youTubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

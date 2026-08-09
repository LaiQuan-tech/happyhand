import { ROLES, ROLE_LABELS, STAFF_ROLES, type Role, type StaffRole } from "@/lib/admin/roles";

/**
 * 員工管理的規則層：純函式、零 IO、不 import server-only。
 *
 * 為什麼要單獨拉一個檔案而不是寫在 actions.ts 裡：
 * 三道保護（不能改自己、不能移除最後一位負責人、不能邀請已註冊的信箱）
 * 是這一頁唯一會造成不可逆後果的東西，但 server action 需要 cookie 與 Next 的
 * request context，沒辦法在測試腳本裡直接跑。把「判斷」與「IO」拆開之後，
 * 判斷就是可以單獨餵資料驗證的普通函式 —— 驗收時跑的是真的會上線的那份程式碼，
 * 不是另外抄一份長得很像的邏輯。
 *
 * ⚠️ 這裡回的字串會直接顯示給好日子的員工看，都是完整的中文句子，
 *    而且都要說「所以現在該怎麼辦」，不是只說「不行」。
 */

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Veto = { error: string } | null;

/* ------------------------------------------------------------------ 角色 */

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function isStaffInviteRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** 這次變更會不會讓一位負責人不再是負責人 */
export function demotesOwner(current: Role, next: Role): boolean {
  return current === "owner" && next !== "owner";
}

/**
 * 查資料庫**之前**就能判定的否決。
 *
 * 🔴 保護 1（不能改自己）在這裡。放最前面是刻意的：這是最常見、
 *    也是唯一一種按下去就能把自己鎖在後台外面的操作，不值得為它先查一次資料庫。
 */
export function vetoBeforeRead(input: {
  actorId: string;
  targetId: string;
  next: string;
}): Veto {
  if (!UUID_PATTERN.test(input.targetId)) {
    return { error: "帳號代號格式不對，請重新整理後再試。" };
  }
  if (!isRole(input.next)) {
    // 刻意不用 toRole()：它認不得的值一律當 customer，
    // 打錯字的角色名稱會靜默變成「把人降級」。
    return { error: "不認得的角色，請重新整理後再試。" };
  }
  if (input.actorId === input.targetId) {
    return {
      error:
        "不能修改自己的角色。要把自己降級請先請另一位負責人操作，避免把自己鎖在後台外面。",
    };
  }
  return null;
}

/**
 * 讀到目前角色之後的否決。
 *
 * 🔴 保護 2（不能移除最後一位負責人）在這裡。
 *    這條比保護 1 更重要：保護 1 只擋得住「自己降自己」，
 *    但兩位負責人互相降級一樣會讓系統沒有任何人管得了員工，
 *    那時只能請工程師下 SQL 才救得回來。
 *
 * @param ownerCount 目前的負責人數。demotesOwner() 為 false 時可以傳 null
 *                   （呼叫端不需要為了不相干的變更多查一次）；
 *                   要降級負責人卻傳 null，代表「數不出來」，一律否決。
 */
export function vetoAfterRead(input: {
  current: Role;
  next: Role;
  ownerCount: number | null;
}): Veto {
  if (input.current === input.next) {
    return { error: `他已經是「${ROLE_LABELS[input.next]}」了。` };
  }

  if (demotesOwner(input.current, input.next)) {
    if (input.ownerCount === null) {
      // 數不出來就不動。寧可讓人重試，也不要在不知道剩幾位負責人的情況下降級。
      return { error: "無法確認目前的負責人數，為了安全起見這次不做變更，請重試一次。" };
    }
    if (input.ownerCount <= 1) {
      return {
        error:
          "系統至少要保留一位負責人。這是目前唯一的負責人，請先把另一個帳號設成負責人，再回來調整他。",
      };
    }
  }

  return null;
}

/* ------------------------------------------------------------------ 邀請 */

/**
 * 對齊 staff_invites 的 check constraint：`email = lower(trim(email))`。
 *
 * 順序必須是「先 trim 再 lower」，跟 Postgres 的 lower(trim(x)) 一致。
 * JS 的 trim() 比 Postgres 的 trim()（只去空白字元 ' '）更兇，會連 \t \n
 * 一起去掉 —— 這個方向是安全的：JS 產出的字串套進 DB 的 check 仍然成立。
 *
 * 少了這一步，`Big@Case.COM ` 這種輸入會直接撞上 constraint 丟 23514，
 * 使用者看到的是一句英文的 Postgres 錯誤。
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 保守的 Email 格式檢查，刻意只收 ASCII。
 *
 * 不是為了擋人，是為了讓 JS 的 toLowerCase() 與 Postgres 的 lower() 保證一致：
 * 含有 'İ' 這類字元時兩邊的 lower 結果可能不同，那會做出一封
 * handle_new_user() 永遠比對不到的死邀請 —— 而且完全沒有錯誤訊息。
 * 直接在入口把非 ASCII 擋掉，比事後解釋「為什麼他註冊了卻沒變成員工」便宜。
 */
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

export function isValidEmail(normalized: string): boolean {
  // 254 是 RFC 5321 的信封位址長度上限
  return normalized.length > 0 && normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
}

/** inviteStaff() 會用 ?invite=<code> 帶回頁面的結果代碼 */
export type InviteCode =
  | "ok"
  | "exists"
  | "duplicate"
  | "empty"
  | "invalid"
  | "badrole"
  | "unverified"
  | "denied"
  | "failed";

/**
 * 只看使用者輸入就能判定的部分（不需要查資料庫）。
 * 回 code 代表「這裡就結束了」，回 value 代表「可以往下查」。
 */
export function validateInviteInput(
  emailRaw: string,
  roleRaw: string,
): { code: InviteCode } | { email: string; role: StaffRole } {
  const email = normalizeEmail(emailRaw);
  const role = roleRaw.trim();

  if (!email) return { code: "empty" };
  if (!isValidEmail(email)) return { code: "invalid" };
  if (!isStaffInviteRole(role)) return { code: "badrole" };
  return { email, role };
}

export type InviteFeedback = {
  tone: "ok" | "warn" | "danger";
  title: string;
  body?: string;
};

/**
 * 每個結果代碼對應的中文說明。
 *
 * 放在這裡而不是 page.tsx：這些句子是這一頁的行為契約
 * （尤其 exists 那一句是保護 3 唯一看得見的產出），驗收要驗的就是它們。
 * page.tsx 只負責把它們畫出來。
 */
export const INVITE_FEEDBACK: Record<InviteCode, InviteFeedback> = {
  ok: {
    tone: "ok",
    title: "邀請已建立。",
    body:
      "請他用這個信箱到登入頁自行註冊，註冊完成的當下就會自動變成你指定的角色，" +
      "邀請也會同時被消耗掉。你不需要再做任何事。",
  },
  exists: {
    tone: "warn",
    title: "這個信箱已經有帳號了，請直接改他的角色。",
    body:
      "邀請只對「還沒註冊」的信箱有效 —— 已經有帳號的人不會再觸發一次註冊流程，" +
      "那封邀請會永遠躺在名單裡不生效。這個帳號已經列在下面，直接改他的角色就行。",
  },
  duplicate: {
    tone: "warn",
    title: "這個信箱已經在待接受的邀請名單裡了。",
    body: "要換角色的話，請先撤銷原本那封邀請，再重新邀請一次。",
  },
  empty: { tone: "danger", title: "請填寫 Email。" },
  invalid: {
    tone: "danger",
    title: "這不是有效的 Email 格式。",
    body: "只接受一般的英數字信箱（例如 someone@example.com），不支援含中文或全形字元的位址。",
  },
  badrole: { tone: "danger", title: "請選擇一個角色（客服／內容編輯／負責人）。" },
  unverified: {
    tone: "danger",
    title: "沒辦法確認這個信箱是不是已經註冊過，因此沒有建立邀請。",
    body:
      "為了不做出一封永遠不會生效、也不會報錯的死邀請，這次刻意不寫入。" +
      "請稍後重試；若持續失敗請截圖回報。",
  },
  denied: { tone: "danger", title: "你的帳號沒有管理員工的權限。" },
  failed: {
    tone: "danger",
    title: "建立邀請失敗，請重試一次。",
    body: "詳細錯誤已記在伺服器 log。若持續失敗請截圖回報。",
  },
};

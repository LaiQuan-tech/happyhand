"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability, adminErrorMessage, AdminAuthError } from "@/lib/admin/guard";
import { writeAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { ROLE_LABELS, toRole, type Role } from "@/lib/admin/roles";
import { loadUserEmailIndex, type Db } from "./queries";
import {
  demotesOwner,
  validateInviteInput,
  vetoAfterRead,
  vetoBeforeRead,
  UUID_PATTERN,
} from "./rules";

/**
 * 員工管理的寫入動作。
 *
 * ⚠️ 每一支都自己呼叫一次 requireCapability("staff:manage")。
 *    layout 的守衛只在 render 頁面時跑，server action 的 POST 不經過它。
 *    這一頁少寫一行的後果比別頁嚴重：任何登入者都能把自己升成 owner。
 *
 * 🔴 三個必須擋下來的情況（順序就是判斷順序）：
 *    1. 負責人不能改自己的角色 —— 會把自己鎖在後台外面。
 *    2. 不能移除最後一位負責人 —— 比第 1 條更重要：兩位負責人互相降級
 *       也會讓系統沒有任何人能管員工。見 changeRole() 的計數與事後複查。
 *    3. 邀請已註冊的信箱 —— handle_new_user() 只在「註冊當下」消費邀請，
 *       已經有帳號的人不會再觸發，那筆邀請永遠不會生效也不會報錯。
 *
 * ⚠️ `"use server"` 檔案只能 export async function。純函式放在 ./queries.ts。
 */

export type ActionResult = { error?: string | null } | undefined;

const STAFF_PATH = "/admin/staff";

/* -------------------------------------------------------------- 共用檢查 */

/** 目前有幾位負責人。查詢失敗回 null —— 呼叫端必須把 null 當「不確定」而不是 0。 */
async function countOwners(db: Db): Promise<number | null> {
  const { count, error } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "owner");

  if (error) {
    console.error("[admin/staff] 計算負責人數失敗", error.code, error.message);
    return null;
  }
  return count ?? null;
}

/* ------------------------------------------------------------ 改角色核心 */

/**
 * setStaffRole 與 removeStaff 共用的實作。
 *
 * removeStaff 只是 next = "customer" 的特例，刻意不寫成兩套流程：
 * 三道保護只要有一邊漏掉就等於沒有。
 */
async function changeRole(
  userId: string,
  next: Role,
  audit: { action: string; verb: string },
): Promise<ActionResult> {
  try {
    const staff = await requireCapability("staff:manage");

    // 🔴 保護 1（不能改自己）與格式檢查。判斷本體在 ./rules.ts，
    //    連資料庫都不用查 —— 這是最常見也最容易一鍵鎖死自己的操作。
    const earlyVeto = vetoBeforeRead({
      actorId: staff.id,
      targetId: userId,
      next,
    });
    if (earlyVeto) return earlyVeto;

    const db = createServiceClient();

    const { data: before, error: beforeError } = await db
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();

    if (beforeError) {
      console.error("[admin/staff] 讀取帳號失敗", beforeError.code, beforeError.message);
      return { error: "讀取這個帳號失敗，請重試一次。" };
    }
    if (!before) return { error: "找不到這個帳號，可能已經被刪除。" };

    const current = toRole((before as unknown as { role: string | null }).role);

    // 🔴 保護 2：不能移除最後一位負責人。
    // 只有真的要把負責人降級時才多查一次人數，其他變更不必付這個成本。
    const demotingOwner = demotesOwner(current, next);
    const owners = demotingOwner ? await countOwners(db) : null;

    const veto = vetoAfterRead({ current, next, ownerCount: owners });
    if (veto) return veto;

    // 帶上 .eq("role", current)：上面的檢查是拿「幾毫秒前讀到的角色」判的。
    // 沒有這個條件，兩個負責人同時操作時慢的那個會把快的那個蓋掉，
    // 而且稽核會記成一段與事實不符的「從 A 改成 B」。
    const { data: after, error } = await db
      .from("profiles")
      .update({ role: next })
      .eq("id", userId)
      .eq("role", current)
      .select("id, role")
      .maybeSingle();

    if (error) {
      console.error("[admin/staff] 更新角色失敗", error.code, error.message);
      return { error: "更新角色失敗，請重試一次。" };
    }
    if (!after) {
      return { error: "這個帳號剛剛被其他同事改過了，請重新整理後再試。" };
    }

    // 🔴 保護 2 的第二道：事後複查。
    //
    // 上面的計數與這裡的 update 不在同一個 transaction 裡，所以
    // 「A 降 B、B 降 A」同時送出時，兩邊都會讀到 owners = 2 而放行，
    // 結果是零個負責人 —— 沒有人能再進 /admin/staff，只能下 SQL 救。
    // 真正的根治是 DB 端的 constraint / RPC，但那要動 migration（不在這次範圍）。
    // 這裡用「降級後再數一次，變成 0 就還原」把那個窗口關掉：
    // 兩邊同時還原最多是「都沒降成」，方向永遠偏安全。
    if (demotingOwner) {
      const remaining = await countOwners(db);
      if (remaining !== null && remaining < 1) {
        const { error: restoreError } = await db
          .from("profiles")
          .update({ role: "owner" })
          .eq("id", userId);

        if (restoreError) {
          // 還原也失敗 = 系統真的沒有負責人了。這是必須被看見的事故。
          console.error(
            "[admin/staff] 🔴 系統已無任何負責人且自動還原失敗",
            userId,
            restoreError.code,
            restoreError.message,
          );
          await writeAudit(staff, {
            action: "staff.owner_lockout",
            entity: "staff",
            entityId: userId,
            summary: "系統已無任何負責人，自動還原失敗，需要人工以 SQL 修復",
            diff: { attempted: { from: current, to: next } },
          });
          return {
            error:
              "系統目前沒有任何負責人，而且自動還原失敗。請立刻聯絡工程人員，不要再操作這一頁。",
          };
        }

        await writeAudit(staff, {
          action: "staff.role_change_reverted",
          entity: "staff",
          entityId: userId,
          summary: "偵測到會讓系統沒有負責人，已自動還原這次的角色變更",
          diff: { attempted: { from: current, to: next } },
        });
        revalidatePath(STAFF_PATH);
        return {
          error:
            "剛好有另一位負責人同時被降級了。為了不讓系統沒有負責人，這次的變更已經還原，請重新整理確認現況。",
        };
      }
    }

    await writeAudit(staff, {
      action: audit.action,
      entity: "staff",
      entityId: userId,
      // 摘要不放 Email：稽核頁不需要它就看得懂，而 entity_id 已經足以回查是誰。
      summary: `${audit.verb}：${ROLE_LABELS[current]} → ${ROLE_LABELS[next]}`,
      diff: { role: { from: current, to: next } },
    });

    revalidatePath(STAFF_PATH);
    return undefined;
  } catch (err) {
    console.error("[admin/staff] changeRole 例外", err);
    return { error: adminErrorMessage(err) };
  }
}

/* -------------------------------------------------------------- 對外動作 */

/** 改某個帳號的角色（四個值都可以，含降回一般會員）。 */
export async function setStaffRole(userId: string, next: Role): Promise<ActionResult> {
  return changeRole(userId, next, { action: "staff.set_role", verb: "調整角色" });
}

/**
 * 移除員工權限＝把角色降回 customer。
 *
 * 刻意**不**刪 auth 帳號：orders.user_id、audit_log.actor_id、
 * workshop_waitlist.created_by 都指向它，刪掉會讓「這張單是誰處理的」變成一片空白，
 * 而那正是客服糾紛時最需要的資訊。人離職了，紀錄不該跟著消失。
 */
export async function removeStaff(userId: string): Promise<ActionResult> {
  return changeRole(userId, "customer", {
    action: "staff.remove",
    verb: "移除員工權限",
  });
}

/* ------------------------------------------------------------------ 邀請 */

/**
 * 建立一封員工邀請。
 *
 * 這支是 `<form action={...}>` 直接呼叫的，回傳值沒有地方接
 * （要接就得把整個表單變成 client component 走 useActionState，
 * 那會為了一行錯誤訊息把 AdminField / AdminSelect 整組拉進 client bundle）。
 * 沿用 app/admin/sessions/actions.ts 的既有作法：redirect 帶一個短代碼回來，
 * 由頁面翻成中文。**只帶代碼不帶信箱**，網址列不會出現任何人的 Email。
 *
 * 唯一的例外是 `account=<uuid>`：信箱已經有帳號時把那個帳號的 id 帶回去，
 * 頁面才能把「直接改他的角色」變成當場可以按的東西，而不是一句做不到的建議。
 * uuid 是不透明代號，不是 PII。
 */
export async function inviteStaff(formData: FormData): Promise<void> {
  let query = "invite=ok";

  try {
    const staff = await requireCapability("staff:manage");

    // email 在這裡就被 lower(trim()) 正規化了。少了這一步，`Big@Case.COM `
    // 會直接撞上 staff_invites_email_normalized 這條 check constraint（23514），
    // 使用者拿到的是一句英文的 Postgres 錯誤。
    const parsed = validateInviteInput(
      String(formData.get("email") ?? ""),
      String(formData.get("role") ?? ""),
    );

    if ("code" in parsed) {
      query = `invite=${parsed.code}`;
    } else {
      const { email, role } = parsed;
      const db = createServiceClient();

      // 🔴 保護 3：已經註冊的信箱不能用邀請。
      const { index, error: indexError } = await loadUserEmailIndex(db);
      const existingId = index.idByEmail.get(email);

      if (existingId) {
        query = `invite=exists&account=${existingId}`;
      } else if (indexError || !index.complete) {
        // 索引建不起來就不敢說「這個信箱沒註冊過」。
        // 硬做下去可能生出一封永遠不會生效、也不會報錯的死邀請。
        console.error("[admin/staff] 無法確認信箱是否已註冊，略過建立邀請");
        query = "invite=unverified";
      } else {
        const { data: dup, error: dupError } = await db
          .from("staff_invites")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (dupError) {
          console.error("[admin/staff] 檢查既有邀請失敗", dupError.code, dupError.message);
          query = "invite=failed";
        } else if (dup) {
          query = "invite=duplicate";
        } else {
          const { data, error } = await db
            .from("staff_invites")
            .insert({ email, role, invited_by: staff.id })
            .select("id")
            .maybeSingle();

          if (error) {
            // ⚠️ 只記 code 與 message，不整包丟 log：
            //    insert payload 是 Email，Postgres 的違規訊息會帶
            //    `DETAIL: Failing row contains (…)`，整包記下去等於把信箱寫進 Vercel log。
            console.error("[admin/staff] 建立邀請失敗", error.code, error.message);
            if (error.code === "23505") {
              query = "invite=duplicate"; // 兩個人同時邀同一個信箱
            } else if (error.code === "23514") {
              // email 正規化沒做好才會撞到 staff_invites_email_normalized。
              // 上面已經 normalizeEmail() 過，走到這裡代表 constraint 的定義變了。
              query = "invite=invalid";
            } else {
              query = "invite=failed";
            }
          } else {
            await writeAudit(staff, {
              action: "staff.invite",
              entity: "staff_invite",
              entityId: (data as unknown as { id: string } | null)?.id ?? null,
              // 邀請的 Email 就是這筆稽核的重點，這裡刻意記下來：
              // 「誰在什麼時候把後台權限發給了哪個信箱」是稽核最該回答的問題。
              summary: `邀請 ${email} 成為「${ROLE_LABELS[role]}」`,
              diff: { email, role },
            });
            revalidatePath(STAFF_PATH);
          }
        }
      }
    }
  } catch (err) {
    console.error("[admin/staff] inviteStaff 例外", err);
    // 只有真的是權限問題才說「你沒有權限」。createServiceClient() 在環境變數
    // 沒設時也會 throw 到這裡，一律回 denied 的話負責人會去查自己的角色，
    // 但真正壞掉的是伺服器設定。
    query = err instanceof AdminAuthError ? "invite=denied" : "invite=failed";
  }

  // redirect() 靠丟例外實作，必須在 try/catch 外面呼叫，
  // 否則會被上面的 catch 吃掉變成 failed。
  redirect(`${STAFF_PATH}?${query}#invite`);
}

/** 撤銷一封還沒被接受的邀請。 */
export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  try {
    const staff = await requireCapability("staff:manage");

    if (!UUID_PATTERN.test(inviteId)) {
      return { error: "邀請代號格式不對，請重新整理後再試。" };
    }

    const db = createServiceClient();

    // 先 delete 再看回傳，而不是先 select 再 delete：
    // 中間被其他同事撤銷掉的話，returning 會是空的，直接就知道。
    const { data, error } = await db
      .from("staff_invites")
      .delete()
      .eq("id", inviteId)
      .select("id, email, role")
      .maybeSingle();

    if (error) {
      console.error("[admin/staff] 撤銷邀請失敗", error.code, error.message);
      return { error: "撤銷邀請失敗，請重試一次。" };
    }
    if (!data) {
      return { error: "找不到這封邀請，可能已經被撤銷或已經有人用它註冊了。" };
    }

    const row = data as unknown as { id: string; email: string; role: string | null };

    await writeAudit(staff, {
      action: "staff.revoke_invite",
      entity: "staff_invite",
      entityId: row.id,
      summary: `撤銷對 ${row.email} 的「${ROLE_LABELS[toRole(row.role)]}」邀請`,
      diff: { email: row.email, role: toRole(row.role) },
    });

    revalidatePath(STAFF_PATH);
    return undefined;
  } catch (err) {
    console.error("[admin/staff] revokeInvite 例外", err);
    return { error: adminErrorMessage(err) };
  }
}

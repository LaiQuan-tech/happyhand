"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireMember, memberErrorMessage } from "@/lib/account/guard";

export type ProfileFormState = { error?: string | null; ok?: string | null } | null;

/**
 * 學員自己改資料。
 *
 * 🔒 只寫三個欄位。這不是「小心一點」而已 ——
 *    20260810000001 的欄位級 grant 只給 authenticated
 *    update (full_name, phone, birth_year, line_user_id)，
 *    role 不在裡面。就算有人用 DevTools 塞一個 role=owner 進表單，
 *    這裡沒有讀它、DB 也拒絕寫它，兩層都擋。
 *
 * 用使用者自己的 session client 而不是 service role：
 * profiles_update_own 保證他只改得到自己那一列，不需要我們在 TS 層再比對 id。
 * 用 service role 反而要自己記得加 .eq("id", member.id)，少寫一次就是全表可寫。
 */
export async function updateProfile(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  let member;
  try {
    member = await requireMember();
  } catch (err) {
    return { error: memberErrorMessage(err) };
  }

  const fullName = String(formData.get("full_name") ?? "").trim().slice(0, 80);
  const phoneRaw = String(formData.get("phone") ?? "").replace(/\D/g, "");
  const birthYearRaw = String(formData.get("birth_year") ?? "").trim();

  if (!fullName) {
    return { error: "請填姓名，我們寄信與稱呼你的時候會用到。" };
  }
  if (phoneRaw && !/^09\d{8}$/.test(phoneRaw)) {
    return { error: "手機號碼是 09 開頭、總共 10 個數字。不想留可以整欄空白。" };
  }

  let birthYear: number | null = null;
  if (birthYearRaw) {
    const parsed = Number(birthYearRaw);
    // DB 有 profiles_birth_year_range (1900..2100)，這裡先擋掉才有中文訊息可看
    if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 2100) {
      return { error: "出生年請填四位數的西元年，例如 1958。不想填可以留空白。" };
    }
    birthYear = parsed;
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: fullName,
        phone: phoneRaw || null,
        birth_year: birthYear,
      })
      .eq("id", member.id);

    if (error) {
      console.error("[account/settings] 更新失敗", error.message);
      return { error: "資料沒有存起來。請重試一次；還是不行的話用 LINE 跟我們說。" };
    }
  } catch (err) {
    console.error("[account/settings] 更新例外", err);
    return { error: "資料沒有存起來。請重試一次；還是不行的話用 LINE 跟我們說。" };
  }

  revalidatePath("/account/settings");
  revalidatePath("/account");
  return { ok: "資料存好了。" };
}

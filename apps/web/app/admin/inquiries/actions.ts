"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/admin/guard";
import { writeAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * 小幫手諮詢紀錄的跟進狀態。
 *
 * ⚠️ 跟其他 actions.ts 一樣：每一支都自己呼叫 requireCapability。
 *    app/admin/layout.tsx 的守衛只在 render 頁面時跑，server action 的 POST
 *    不經過它 —— 少寫一行，任何登入會員都能改客人的跟進狀態。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function setHandled(formData: FormData, handled: boolean): Promise<void> {
  let destination = "/admin/inquiries";
  try {
    const staff = await requireCapability("orders:read");

    const id = String(formData.get("id") ?? "").trim();
    if (!UUID_RE.test(id)) {
      destination = "/admin/inquiries?msg=bad_id";
      return;
    }
    // 從哪一頁按的就回哪一頁，篩選條件不會被洗掉
    const back = String(formData.get("back") ?? "").trim();

    const db = createServiceClient();
    if (!db) {
      destination = "/admin/inquiries?msg=failed";
      return;
    }

    const { data, error } = await db
      .from("ai_chat_logs")
      .update({
        handled_at: handled ? new Date().toISOString() : null,
        handled_by: handled ? staff.id : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, contact_name, contact_email, session_id")
      .maybeSingle();

    if (error || !data) {
      console.error("[admin/inquiries] 更新失敗", error?.message);
      destination = "/admin/inquiries?msg=failed";
      return;
    }

    await writeAudit(staff, {
      action: handled ? "inquiry.handled" : "inquiry.reopened",
      entity: "ai_chat_logs",
      entityId: data.id,
      // 🔴 摘要不寫 Email／電話：稽核紀錄的可見範圍跟諮詢紀錄不一樣
      //    （audit:read 是負責人、orders:read 是客服），
      //    把個資抄進稽核摘要等於繞過那道切分。
      summary: handled ? "標記諮詢已處理" : "把諮詢改回待處理",
    });

    revalidatePath("/admin/inquiries");
    revalidatePath("/admin");
    destination = `${back.startsWith("/admin/inquiries") ? back : "/admin/inquiries"}${
      back.includes("?") ? "&" : "?"
    }msg=${handled ? "handled" : "reopened"}`;
  } catch (err) {
    console.error("[admin/inquiries] 例外", err);
    destination = "/admin/inquiries?msg=denied";
  } finally {
    redirect(destination);
  }
}

export async function markHandled(formData: FormData): Promise<void> {
  return setHandled(formData, true);
}

export async function markUnhandled(formData: FormData): Promise<void> {
  return setHandled(formData, false);
}

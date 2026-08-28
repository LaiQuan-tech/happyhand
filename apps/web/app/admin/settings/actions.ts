"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCapability } from "@/lib/admin/guard";
import { writeAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * 站台共用內容的寫入（site_settings）。
 *
 * ⚠️ 跟 products/actions.ts 一樣：每一支都自己呼叫 requireCapability。
 *    app/admin/layout.tsx 的守衛只在 render 頁面時跑，server action 的
 *    POST 不經過它。
 *
 * 這裡的內容會出現在每一個報名頁，所以改動一律 revalidate 前台全部路徑。
 */

function revalidateStorefront() {
  revalidatePath("/");
  revalidatePath("/courses");
  revalidatePath("/courses/[slug]", "page");
  revalidatePath("/workshops");
  revalidatePath("/workshops/[slug]", "page");
  // 講師照片也出現在這兩頁。漏掉的話後台換了照片，這裡要等 300 秒才變。
  revalidatePath("/teachers");
  revalidatePath("/about");
}

/** 一行一項的 textarea → 陣列 */
function lines(raw: string, max = 30, itemMax = 300): string[] {
  return String(raw ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max)
    .map((l) => l.slice(0, itemMax));
}

/**
 * 連結清單。輸入格式是每行「標籤|網址」。
 *
 * 用 | 當分隔而不是空白：標籤裡本來就常常有空白
 *（「MOMOTV《今天大小事》居家保健分享」）。
 * 認不出格式的行**直接跳過而不是報錯** —— 這一欄是選填的補充資料，
 * 為了一行打錯就擋下整次儲存並不划算，但也不能把整行當標籤存進去。
 */
function parseLinks(raw: string): { label: string; href: string }[] {
  return lines(raw, 20, 500)
    .map((line) => {
      const i = line.indexOf("|");
      if (i <= 0) return null;
      const label = line.slice(0, i).trim();
      const href = line.slice(i + 1).trim();
      if (!label || !/^https?:\/\//i.test(href)) return null;
      return { label: label.slice(0, 120), href: href.slice(0, 500) };
    })
    .filter((v): v is { label: string; href: string } => v !== null);
}

export async function saveTeacher(formData: FormData): Promise<void> {
  let destination = "/admin/settings";
  try {
    const staff = await requireCapability("catalog:write");

    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      destination = "/admin/settings?msg=teacher_name_required";
      return;
    }

    const value = {
      name: name.slice(0, 120),
      title: String(formData.get("title") ?? "").trim().slice(0, 200),
      // 段落用空行分段：一般人打字就是這樣分段的
      paragraphs: String(formData.get("paragraphs") ?? "")
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .slice(0, 20)
        .map((p) => p.slice(0, 2000)),
      credentials: lines(String(formData.get("credentials") ?? "")),
      links: parseLinks(String(formData.get("links") ?? "")),
      photo_url: String(formData.get("photo_url") ?? "").trim() || null,
    };

    const db = createServiceClient();
    const { error } = await db
      .from("site_settings")
      .upsert({ key: "teacher", value }, { onConflict: "key" });

    if (error) {
      console.error("[admin/settings] 儲存講師失敗", error.message);
      destination = "/admin/settings?msg=failed";
      return;
    }

    await writeAudit(staff, {
      action: "settings.teacher",
      entity: "site_settings",
      entityId: "teacher",
      summary: `更新講師介紹（${value.name}）`,
      diff: { teacher: value },
    });

    revalidatePath("/admin/settings");
    revalidateStorefront();
    destination = "/admin/settings?msg=teacher_saved";
  } catch (err) {
    console.error("[admin/settings] saveTeacher 例外", err);
    destination = "/admin/settings?msg=denied";
  } finally {
    redirect(destination);
  }
}

export async function saveHealthNotice(formData: FormData): Promise<void> {
  let destination = "/admin/settings";
  try {
    const staff = await requireCapability("catalog:write");

    const value = {
      title: String(formData.get("title") ?? "").trim().slice(0, 120) || "健康聲明",
      body: String(formData.get("body") ?? "").trim().slice(0, 4000),
    };

    const db = createServiceClient();
    const { error } = await db
      .from("site_settings")
      .upsert({ key: "health_notice", value }, { onConflict: "key" });

    if (error) {
      console.error("[admin/settings] 儲存健康聲明失敗", error.message);
      destination = "/admin/settings?msg=failed";
      return;
    }

    await writeAudit(staff, {
      action: "settings.health_notice",
      entity: "site_settings",
      entityId: "health_notice",
      summary: "更新健康聲明",
      diff: { health_notice: value },
    });

    revalidatePath("/admin/settings");
    revalidateStorefront();
    destination = "/admin/settings?msg=health_saved";
  } catch (err) {
    console.error("[admin/settings] saveHealthNotice 例外", err);
    destination = "/admin/settings?msg=denied";
  } finally {
    redirect(destination);
  }
}

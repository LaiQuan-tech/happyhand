import type { Metadata } from "next";
import { requireCapability, adminErrorMessage } from "@/lib/admin/guard";
import { createServiceClient } from "@/lib/supabase/server";
import { AdminField, AdminTextarea } from "@/components/admin/admin-field";
import { adminPrimaryButton } from "@/app/admin/products/ui";
import { SingleImageField } from "@/components/admin/image-uploader";
import { saveHealthNotice, saveTeacher } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "網站設定" };

/**
 * /admin/settings — 所有課共用的內容。
 *
 * 講師介紹與健康聲明每門課都一樣，不該在每個商品重填一次，
 * 所以放在 site_settings 而不是 products。
 */

type Teacher = {
  name?: string;
  title?: string;
  paragraphs?: string[];
  credentials?: string[];
  links?: { label: string; href: string }[];
  photo_url?: string | null;
};

type HealthNotice = { title?: string; body?: string };

const MESSAGES: Record<string, { tone: "ok" | "warn"; text: string }> = {
  teacher_saved: { tone: "ok", text: "講師介紹已更新，前台立刻生效。" },
  health_saved: { tone: "ok", text: "健康聲明已更新，前台立刻生效。" },
  teacher_name_required: { tone: "warn", text: "請填講師姓名。" },
  denied: { tone: "warn", text: "你的帳號沒有編輯網站內容的權限。" },
  failed: { tone: "warn", text: "儲存失敗，請重試一次。" },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  try {
    await requireCapability("catalog:write");
  } catch (err) {
    return (
      <p className="rounded-card border border-line bg-panel px-4 py-6 text-[14px] text-ink-soft">
        {adminErrorMessage(err)}
      </p>
    );
  }

  const { msg } = await searchParams;
  const message = msg ? MESSAGES[msg] : null;

  const db = createServiceClient();
  const { data } = await db
    .from("site_settings")
    .select("key, value")
    .in("key", ["teacher", "health_notice"]);

  const byKey = new Map(
    ((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
  );
  const teacher = (byKey.get("teacher") ?? {}) as Teacher;
  const health = (byKey.get("health_notice") ?? {}) as HealthNotice;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[20px] font-medium text-ink">網站設定</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          這裡的內容會出現在每一個課程與工作坊的報名頁上，改一次全部生效。
        </p>
      </div>

      {message && (
        <p
          role={message.tone === "warn" ? "alert" : "status"}
          className={`rounded-card px-4 py-3 text-[14px] ${
            message.tone === "ok"
              ? "bg-ok-soft text-ok"
              : "bg-panel text-danger"
          }`}
        >
          {message.text}
        </p>
      )}

      <section className="flex flex-col gap-4 border-t border-line pt-6">
        <div>
          <h2 className="text-[16px] font-medium text-ink">講師介紹</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            留空的欄位在前台不會顯示。姓名空白時整個講師區塊都不會出現。
          </p>
        </div>

        <form action={saveTeacher} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 admin:grid-cols-2">
            <AdminField
              name="name"
              label="姓名"
              required
              maxLength={120}
              defaultValue={teacher.name ?? ""}
              hint="例如「Alice 劉柳樺」"
            />
            <AdminField
              name="title"
              label="頭銜"
              maxLength={200}
              defaultValue={teacher.title ?? ""}
              hint="例如「快樂手 JSJ 講師」"
            />
          </div>

          <SingleImageField
            name="photo_url"
            label="講師照片"
            kind="teachers"
            defaultUrl={teacher.photo_url ?? ""}
          />

          <AdminTextarea
            name="paragraphs"
            label="介紹文字"
            rows={7}
            maxLength={4000}
            defaultValue={(teacher.paragraphs ?? []).join("\n\n")}
            hint="用空一行來分段。前台會照分段顯示。"
          />

          <AdminTextarea
            name="credentials"
            label="經歷與資格"
            rows={6}
            defaultValue={(teacher.credentials ?? []).join("\n")}
            hint="一行一項，例如「仁神術合格講師」。"
          />

          <AdminTextarea
            name="links"
            label="媒體報導與連結"
            rows={4}
            defaultValue={(teacher.links ?? [])
              .map((l) => `${l.label}|${l.href}`)
              .join("\n")}
            hint="一行一個，格式是「標籤|網址」，例如「人間通訊社報導|https://...」。格式不對的那一行會被略過。"
          />

          <div>
            <button type="submit" className={adminPrimaryButton}>
              儲存講師介紹
            </button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-4 border-t border-line pt-6">
        <div>
          <h2 className="text-[16px] font-medium text-ink">健康聲明</h2>
          <p className="mt-1 text-[13px] text-ink-soft">
            法規要求的告知內容。會顯示在報名頁最下方，客人結帳時也要勾選同意。
          </p>
        </div>

        <form action={saveHealthNotice} className="flex flex-col gap-4">
          <AdminField
            name="title"
            label="標題"
            maxLength={120}
            defaultValue={health.title ?? "健康聲明"}
          />
          <AdminTextarea
            name="body"
            label="內容"
            rows={8}
            maxLength={4000}
            defaultValue={health.body ?? ""}
            hint="換行會保留。"
          />
          <div>
            <button type="submit" className={adminPrimaryButton}>
              儲存健康聲明
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

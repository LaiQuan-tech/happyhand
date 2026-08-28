import { Accordion } from "@/components/ui/accordion";
import { formatPrice } from "@/lib/site";
import { Figure } from "@/components/ui/placeholder";
import type {
  HealthNoticeSetting,
  ProductBlock,
  TeacherSetting,
} from "@/lib/data";

/**
 * 報名頁的內容區塊。
 *
 * 每一個都遵守同一條規則：**資料為空就回 null，整塊不渲染**。
 * 這是「後台留空的欄位不顯示」能成立的關鍵 —— 呼叫端不必寫一堆
 * `{arr.length > 0 && <Section .../>}`，也不會出現空標題配空清單。
 *
 * 刻意放在 workshops/_components 而不是 components/ui：
 * 這些是報名頁專用的排版，不是通用元件（account/_components/shell.tsx
 * 的檔頭也有同樣的取捨說明——免得 components/ui 變成雜物間）。
 */

function isEmpty(list: readonly string[] | null | undefined): boolean {
  return !list || list.length === 0;
}

/** 區塊外框：統一小標與間距 */
function Section({
  title,
  eyebrow,
  children,
  tone = "plain",
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
  tone?: "plain" | "cream";
}) {
  return (
    <section
      className={
        tone === "cream"
          ? "rounded-card bg-cream-100 px-[20px] py-[28px] md:px-[36px] md:py-[40px]"
          : ""
      }
    >
      {eyebrow && (
        <p className="t-eyebrow text-brown-300">{eyebrow}</p>
      )}
      <h2 className="t-h2 mt-[6px] text-brown-900">{title}</h2>
      <div className="mt-[18px] md:mt-[24px]">{children}</div>
    </section>
  );
}

/** 多段引言。後台的換行要保留，所以用 whitespace-pre-line。 */
export function LeadText({ text }: { text: string | null | undefined }) {
  if (!text?.trim()) return null;
  return (
    <p className="t-body-lg whitespace-pre-line text-pretty text-brown-700">
      {text}
    </p>
  );
}

/** 標題 + 條列。 */
export function BulletSection({
  title,
  eyebrow,
  items,
  tone,
}: {
  title: string;
  eyebrow?: string;
  items: readonly string[] | null | undefined;
  tone?: "plain" | "cream";
}) {
  if (isEmpty(items)) return null;
  return (
    <Section title={title} eyebrow={eyebrow} tone={tone}>
      <ul className="flex flex-col gap-[12px]">
        {items!.map((item, i) => (
          <li key={i} className="t-body flex gap-[10px] text-brown-700">
            <span aria-hidden className="shrink-0 text-caramel-dk">
              ・
            </span>
            <span className="text-pretty">{item}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * 兩欄對比（適合／不適合、線上／實體）。
 * 只有一邊有內容時就只顯示那一欄，不會留一個空框。
 */
export function CompareSection({
  title,
  eyebrow,
  leftTitle,
  leftItems,
  rightTitle,
  rightItems,
}: {
  title: string;
  eyebrow?: string;
  leftTitle: string;
  leftItems: readonly string[] | null | undefined;
  rightTitle: string;
  rightItems: readonly string[] | null | undefined;
}) {
  const hasLeft = !isEmpty(leftItems);
  const hasRight = !isEmpty(rightItems);
  if (!hasLeft && !hasRight) return null;

  return (
    <Section title={title} eyebrow={eyebrow}>
      <div
        className={
          hasLeft && hasRight
            ? "grid gap-[16px] md:grid-cols-2 md:gap-[24px]"
            : "grid gap-[16px]"
        }
      >
        {hasLeft && (
          <Column title={leftTitle} items={leftItems!} tone="ok" />
        )}
        {hasRight && (
          <Column title={rightTitle} items={rightItems!} tone="muted" />
        )}
      </div>
    </Section>
  );
}

function Column({
  title,
  items,
  tone,
}: {
  title: string;
  items: readonly string[];
  tone: "ok" | "muted";
}) {
  return (
    <div
      className={`rounded-card border px-[20px] py-[22px] md:px-[26px] md:py-[26px] ${
        tone === "ok"
          ? "border-sand-400 bg-white"
          : "border-sand-300 bg-cream-100"
      }`}
    >
      <h3 className="t-h3 text-brown-900">{title}</h3>
      <ul className="mt-[14px] flex flex-col gap-[10px]">
        {items.map((item, i) => (
          <li key={i} className="t-body flex gap-[10px] text-brown-700">
            <span aria-hidden className="shrink-0 text-caramel-dk">
              {tone === "ok" ? "✓" : "・"}
            </span>
            <span className="text-pretty">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 標籤雲（「一次報名，全部帶走」）。 */
export function TagCloud({
  title,
  eyebrow,
  items,
}: {
  title: string;
  eyebrow?: string;
  items: readonly string[] | null | undefined;
}) {
  if (isEmpty(items)) return null;
  return (
    <Section title={title} eyebrow={eyebrow} tone="cream">
      <ul className="flex flex-wrap gap-[10px]">
        {items!.map((item, i) => (
          <li
            key={i}
            className="rounded-pill border border-sand-500 bg-white px-[18px] py-[9px] text-[17px] text-brown-700"
          >
            {item}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ------------------------------------------------- product_blocks 的區塊 */


/** 常見問題。直接用站上既有的 Accordion（它的型別就是 {q, a}）。 */
export function FaqSection({ blocks }: { blocks: ProductBlock[] }) {
  const items = blocks
    .filter((b) => b.title?.trim())
    .map((b) => ({ q: b.title!.trim(), a: (b.body ?? "").trim() }));
  if (items.length === 0) return null;
  return (
    <Section eyebrow="常見問題" title="您想知道的，我們先回答">
      <Accordion items={items} />
    </Section>
  );
}

/** 學習路徑。前台自動編號，後台不用自己打 01、02。 */
export function StepSection({ blocks }: { blocks: ProductBlock[] }) {
  const steps = blocks.filter((b) => b.title?.trim());
  if (steps.length === 0) return null;
  return (
    <Section eyebrow="學習路徑" title="從理解、練習，到真正融入生活">
      <ol className="grid gap-[16px] md:grid-cols-2 lg:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className="rounded-card border border-sand-300 bg-white px-[20px] py-[22px]"
          >
            <span className="font-serif text-[26px] leading-none text-caramel-ink">
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="t-h3 mt-[10px] text-brown-900">{s.title}</h3>
            {s.body?.trim() && (
              <p className="t-body-sm mt-[8px] whitespace-pre-line text-pretty text-brown-500">
                {s.body}
              </p>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** 報名資訊對照表（項目：內容）。 */
export function InfoTableSection({ blocks }: { blocks: ProductBlock[] }) {
  const rows = blocks.filter((b) => b.title?.trim());
  if (rows.length === 0) return null;
  return (
    <Section eyebrow="梯次、費用與報名" title="報名前，先確認這些資訊" tone="cream">
      <dl className="flex flex-col">
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid gap-[4px] border-b border-sand-300 py-[14px] last:border-b-0 md:grid-cols-[200px_1fr] md:gap-[16px]"
          >
            <dt className="t-body font-medium text-brown-900">{r.title}</dt>
            <dd className="t-body whitespace-pre-line text-pretty text-brown-700">
              {r.body}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** 費用方案卡。meta.amount 有值才顯示金額。 */
export function PricingSection({ blocks }: { blocks: ProductBlock[] }) {
  const plans = blocks.filter((b) => b.title?.trim());
  if (plans.length === 0) return null;
  return (
    <Section eyebrow="費用" title="費用方案">
      <div className="grid gap-[16px] md:grid-cols-2">
        {plans.map((p) => {
          const amount = p.meta?.amount;
          const note = p.meta?.note;
          return (
            <div
              key={p.id}
              className="flex flex-col rounded-card border-2 border-sand-400 bg-white px-[22px] py-[24px]"
            >
              <h3 className="t-h3 text-brown-900">{p.title}</h3>
              {typeof amount === "number" && (
                <p className="mt-[8px] font-serif text-[28px] font-semibold text-caramel-ink">
                  {formatPrice(amount)}
                </p>
              )}
              {p.body?.trim() && (
                <p className="t-body-sm mt-[10px] whitespace-pre-line text-pretty text-brown-700">
                  {p.body}
                </p>
              )}
              {typeof note === "string" && note.trim() && (
                <p className="t-caption mt-[12px] border-t border-sand-300 pt-[10px] text-brown-500">
                  {note}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** 特色說明（陪伴機制那種三欄卡片）。 */
export function FeatureSection({ blocks }: { blocks: ProductBlock[] }) {
  const items = blocks.filter((b) => b.title?.trim());
  if (items.length === 0) return null;
  return (
    <Section eyebrow="陪伴機制" title="讓您不會學完就一個人">
      <div className="grid gap-[16px] md:grid-cols-3">
        {items.map((f) => (
          <div
            key={f.id}
            className="rounded-card bg-cream-100 px-[20px] py-[22px]"
          >
            <h3 className="t-h3 text-brown-900">{f.title}</h3>
            {f.body?.trim() && (
              <p className="t-body-sm mt-[8px] whitespace-pre-line text-pretty text-brown-500">
                {f.body}
              </p>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}


/** 講師介紹。資料來自 site_settings 的 teacher，所有課共用。 */
export function TeacherSection({
  teacher,
}: {
  teacher: TeacherSetting | null;
}) {
  if (!teacher?.name?.trim()) return null;
  const paragraphs = (teacher.paragraphs ?? []).filter((p) => p?.trim());
  const credentials = (teacher.credentials ?? []).filter((c) => c?.trim());
  const links = (teacher.links ?? []).filter((l) => l?.href?.trim());

  return (
    <Section eyebrow="認識您的學習引路人" title={`${teacher.name}｜${teacher.title}`}>
      <div className="flex flex-col gap-[20px] md:flex-row md:gap-[32px]">
        {teacher.photo_url && (
          <Figure
            src={teacher.photo_url}
            alt={teacher.name}
            rounded="rounded-card"
            sizes="220px"
            className="h-[220px] w-full shrink-0 md:w-[220px]"
            // 講師照是 4:5 直式，放進 220px 方框時置中裁切會切掉頭頂
            objectPosition="object-top"
          />
        )}
        <div className="min-w-0 flex-1">
          {paragraphs.map((p, i) => (
            <p key={i} className="t-body mt-[10px] text-pretty text-brown-700 first:mt-0">
              {p}
            </p>
          ))}

          {credentials.length > 0 && (
            <ul className="mt-[18px] flex flex-col gap-[8px] border-t border-sand-300 pt-[16px]">
              {credentials.map((c, i) => (
                <li key={i} className="t-body-sm flex gap-[10px] text-brown-500">
                  <span aria-hidden className="shrink-0 text-caramel-dk">・</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          )}

          {links.length > 0 && (
            <ul className="mt-[16px] flex flex-wrap gap-[10px]">
              {links.map((l, i) => (
                <li key={i}>
                  {/* 站外連結要自己帶 target/rel */}
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center rounded-pill border border-sand-400 px-[16px] text-[16px] text-brown-700 transition-colors hover:bg-cream-100"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

/**
 * 健康聲明。
 * ⚠️ 這是法規要求的內容，字級不可以縮小、也不該塞進摺疊區藏起來。
 */
export function HealthNoticeSection({
  notice,
}: {
  notice: HealthNoticeSetting | null;
}) {
  if (!notice?.body?.trim()) return null;
  return (
    <section className="rounded-card border-2 border-sand-400 px-[20px] py-[24px] md:px-[30px] md:py-[28px]">
      <h2 className="t-h3 text-brown-900">{notice.title || "健康聲明"}</h2>
      <p className="t-body mt-[12px] whitespace-pre-line text-pretty text-brown-700">
        {notice.body}
      </p>
    </section>
  );
}

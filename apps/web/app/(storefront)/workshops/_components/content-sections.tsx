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

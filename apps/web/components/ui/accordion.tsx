"use client";

import { useId, useState } from "react";

export type AccordionItem = {
  q: string;
  a: string;
};

export function Accordion({
  items,
  className = "",
}: {
  items: AccordionItem[];
  className?: string;
}) {
  return (
    <div className={`border-t border-sand-300 ${className}`}>
      {items.map((item, i) => (
        <AccordionRow key={i} item={item} />
      ))}
    </div>
  );
}

function AccordionRow({ item }: { item: AccordionItem }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <div className="border-b border-sand-300">
      <h3>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-h-[56px] w-full items-center justify-between gap-4 py-[18px] text-left"
        >
          <span className="text-[17.5px] leading-[1.7] text-brown-900 md:text-[18.5px]">
            {item.q}
          </span>
          <span
            aria-hidden
            className="shrink-0 text-[24px] leading-none text-caramel-ink transition-transform duration-200"
            style={{ transform: open ? "rotate(45deg)" : "rotate(0deg)" }}
          >
            ＋
          </span>
        </button>
      </h3>
      <div id={id} hidden={!open} className="pb-[20px]">
        <p className="t-body-sm whitespace-pre-line text-brown-500">{item.a}</p>
      </div>
    </div>
  );
}

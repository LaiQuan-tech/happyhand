"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCart } from "@/components/cart-provider";
import { Button, LinkButton, buttonClass } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Figure } from "@/components/ui/placeholder";
import { findProduct } from "@/lib/content";
import { SITE, formatPrice } from "@/lib/site";
import { CheckoutSteps } from "./checkout-steps";
import { PaymentOptions, type PaymentMethod } from "./payment-options";

type FieldKey = "name" | "phone" | "email" | "address";
type Errors = Partial<Record<FieldKey, string>>;

/** 錯誤要 focus 的順序＝畫面上的順序 */
const FIELD_ORDER: FieldKey[] = ["name", "phone", "email", "address"];

const PHONE_RE = /^09\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CheckoutView() {
  const router = useRouter();
  const { items, total, ready, clear } = useCart();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("credit");

  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);

  /** 有實體課本的商品才需要地址 */
  const needsAddress = useMemo(
    () =>
      items.some((i) => {
        const p = findProduct(i.slug);
        return [i.title, p?.title, ...(p?.tags ?? []), ...(p?.benefits ?? [])]
          .filter(Boolean)
          .join(" ")
          .includes("課本");
      }),
    [items],
  );

  const errors = useMemo<Errors>(() => {
    const e: Errors = {};
    if (!name.trim()) e.name = "請填你的名字，我們才知道怎麼稱呼你。";
    if (!phone.trim()) e.phone = "請填手機號碼，開課前我們會用簡訊提醒你。";
    else if (!PHONE_RE.test(phone))
      e.phone = "手機號碼是 09 開頭、總共 10 個數字。";
    if (!email.trim()) e.email = "這一欄還沒填，我們需要它才能寄開通信給你。";
    else if (!EMAIL_RE.test(email))
      e.email = "Email 看起來還少了什麼，請再檢查一次。";
    if (needsAddress && !address.trim())
      e.address = "這筆訂單有紙本課本要寄，請填收件地址。";
    return e;
  }, [name, phone, email, address, needsAddress]);

  /**
   * 即時驗證：欄位有填了才提示格式問題，不要一進頁面就整排紅字；
   * 按過送出之後才把「還沒填」也一起顯示出來。
   */
  const shown = useCallback(
    (key: FieldKey, filled: string) =>
      submitted || filled.trim().length > 0 ? errors[key] : undefined,
    [submitted, errors],
  );

  const focusFirstError = useCallback((errs: Errors) => {
    const first = FIELD_ORDER.find((k) => errs[k]);
    if (!first) return;
    formRef.current
      ?.querySelector<HTMLElement>(`[name="${first}"]`)
      ?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);

    if (Object.keys(errors).length > 0) {
      setFormError("有幾個地方還要再確認一下，下面標紅色的欄位請再看一次。");
      focusFirstError(errors);
      return;
    }

    setFormError(null);
    setBusy(true);

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          address: address.trim(),
          note: note.trim(),
          payment,
          items: items.map((i) => ({
            productId: i.productId,
            slug: i.slug,
            title: i.title,
            type: i.type,
            qty: i.qty,
            priceSnapshot: i.priceSnapshot,
            sessionId: i.sessionId ?? null,
            sessionLabel: i.sessionLabel ?? null,
          })),
        }),
      });

      const data = (await res.json().catch(() => null)) as {
        order_no?: string;
        message?: string;
      } | null;

      if (!res.ok || !data?.order_no) {
        throw new Error(data?.message ?? "訂單沒有建立成功");
      }

      // 先擋掉「購物車是空的」那段，再清空，避免導頁途中閃出提示
      setLeaving(true);
      clear();
      router.push(
        `/checkout/success?order=${encodeURIComponent(data.order_no)}&pay=${payment}`,
      );
    } catch (err) {
      console.error("[checkout] 建立訂單失敗", err);
      setBusy(false);
      setFormError(
        "訂單沒有送出去。請再按一次「確認送出訂單」，或直接用 LINE 問我們，我們幫你完成報名。",
      );
      window.requestAnimationFrame(() => alertRef.current?.focus());
    }
  }

  return (
    <div>
      <CheckoutSteps current={2} />

      <div className="mx-auto max-w-maxw px-[20px] pb-[64px] md:px-[40px] md:pb-[80px]">
        <h1 className="t-h2 text-brown-900">填寫資料與付款</h1>

        {!ready && <CheckoutSkeleton />}

        {ready && items.length === 0 && !leaving && <EmptyCartNotice />}

        {ready && (items.length > 0 || leaving) && (
          <form
            ref={formRef}
            onSubmit={handleSubmit}
            noValidate
            aria-busy={busy}
            className="mt-[24px] grid gap-[32px] md:mt-[32px] md:grid-cols-[1.2fr_0.8fr] md:gap-[40px]"
          >
            <div>
              {formError && (
                <div
                  ref={alertRef}
                  role="alert"
                  tabIndex={-1}
                  className="mb-[24px] rounded-sm border-2 border-error bg-cream-100 px-[20px] py-[18px] text-[17px] leading-[1.9] text-error md:px-[24px]"
                >
                  {formError}
                </div>
              )}

              <h2 className="font-serif text-[22px] font-semibold text-brown-900 md:text-[28px]">
                你的資料
              </h2>

              <div className="mt-[20px] grid gap-[16px] lg:grid-cols-2 lg:gap-[20px]">
                <Field
                  label="姓名"
                  name="name"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={setName}
                  error={shown("name", name)}
                />
                <Field
                  label="手機"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  required
                  autoComplete="tel"
                  value={phone}
                  // 直接吃掉空白與符號，長輩貼「0912-345-678」也不會被擋
                  onChange={(v) => setPhone(v.replace(/\D/g, "").slice(0, 10))}
                  error={shown("phone", phone)}
                  hint="09 開頭，總共 10 個數字"
                />
                <div className="lg:col-span-2">
                  <Field
                    label="Email"
                    name="email"
                    type="email"
                    inputMode="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={setEmail}
                    error={shown("email", email)}
                    hint="課程開通通知會寄到這裡"
                  />
                </div>
                <div className="lg:col-span-2">
                  <Field
                    label="地址"
                    name="address"
                    required={needsAddress}
                    autoComplete="street-address"
                    value={address}
                    onChange={setAddress}
                    error={shown("address", address)}
                    hint={
                      needsAddress
                        ? "課本會寄到這裡"
                        : "課本會寄到這裡。這次訂單沒有紙本課本，可以不用填。"
                    }
                  />
                </div>
                <div className="lg:col-span-2">
                  <Field
                    label="備註"
                    name="note"
                    as="textarea"
                    value={note}
                    onChange={setNote}
                    hint="想先跟我們說什麼都可以，沒有也沒關係。"
                  />
                </div>
              </div>

              <PaymentOptions value={payment} onChange={setPayment} />
            </div>

            {/* 訂單摘要：桌機 sticky 在右側，手機排在表單下方，
                送出鍵就是表單最後一顆滿版按鈕（表單頁不放固定底部列，免得擋住鍵盤） */}
            <aside className="h-fit rounded-card border border-sand-500 bg-white p-[24px] md:sticky md:top-[24px] md:p-[28px]">
              <h2 className="font-serif text-[22px] font-semibold text-brown-900">
                訂單內容
              </h2>

              <ul className="mt-[18px]">
                {items.map((i) => (
                  <li
                    key={`${i.productId}::${i.sessionId ?? ""}`}
                    className="flex gap-[14px] border-b border-sand-300 py-[16px] first:pt-0"
                  >
                    <Figure
                      alt={i.title}
                      rounded="rounded-input"
                      className="h-[72px] w-[72px] shrink-0"
                      sizes="72px"
                    />
                    <div className="min-w-0">
                      <p className="text-[17px] leading-[1.6] text-brown-900">
                        {i.title}
                      </p>
                      {i.sessionLabel && (
                        <p className="mt-[4px] text-[16px] text-brown-500">
                          {i.sessionLabel}
                        </p>
                      )}
                      <p className="mt-[6px] text-[16px] text-caramel-ink">
                        {formatPrice(i.priceSnapshot)}
                        {i.qty > 1 && (
                          <span className="text-brown-500">　×{i.qty}</span>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-[18px] flex justify-between text-[17px] text-brown-700">
                <span>小計</span>
                <span>{formatPrice(total)}</span>
              </div>
              <div className="mt-[10px] flex justify-between text-[17px] text-brown-700">
                <span>課本運費</span>
                <span>{formatPrice(0)}</span>
              </div>
              <div className="mt-[16px] flex items-baseline justify-between border-t border-sand-300 pt-[16px]">
                <span className="text-[18.5px] text-brown-900">總計</span>
                <span className="font-serif text-[30px] font-semibold text-caramel-ink">
                  {formatPrice(total)}
                </span>
              </div>

              <Button
                type="submit"
                variant={busy ? "disabled" : "primary"}
                fullWidth
                disabled={busy}
                className="mt-[20px]"
              >
                {busy ? "處理中…" : "確認送出訂單"}
              </Button>

              <p className="mt-[14px] text-center text-[16px] leading-[1.8] text-brown-300">
                送出即表示同意服務條款與退費規定
              </p>

              <div className="mt-[16px] border-t border-sand-300 pt-[16px]">
                <p className="text-[16px] leading-[1.8] text-brown-500">
                  填到一半卡住了？用 LINE 問我們，我們陪你一起填。
                </p>
                <a
                  href={SITE.lineHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass({
                    variant: "outline",
                    fullWidth: true,
                    className: "mt-[12px]",
                  })}
                >
                  加我們的 LINE
                  <span className="sr-only">（會開啟 LINE）</span>
                </a>
              </div>
            </aside>
          </form>
        )}
      </div>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="mt-[24px] md:mt-[32px]">
      <p role="status" className="sr-only">
        訂單資料載入中
      </p>
      <div
        aria-hidden
        className="grid gap-[32px] md:grid-cols-[1.2fr_0.8fr] md:gap-[40px]"
      >
        <div className="flex flex-col gap-[20px]">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <div className="h-[20px] w-[96px] rounded-input bg-skeleton" />
              <div className="mt-[8px] h-[56px] w-full rounded-input bg-skeleton" />
            </div>
          ))}
        </div>
        <div className="h-[360px] rounded-card bg-skeleton" />
      </div>
    </div>
  );
}

function EmptyCartNotice() {
  return (
    <div className="mt-[24px] rounded-card border border-sand-500 bg-cream-100 px-[24px] py-[48px] text-center md:mt-[32px] md:px-[40px] md:py-[64px]">
      <p className="font-serif text-[24px] font-semibold text-brown-900 md:text-[28px]">
        購物車還是空的
      </p>
      <p className="t-body mx-auto mt-[12px] max-w-[520px] text-brown-500">
        還沒有要報名的課程，先回課程列表挑一門，再回來填資料就可以了。
      </p>
      <div className="mt-[28px] flex flex-col items-center justify-center gap-[12px] sm:flex-row">
        <LinkButton
          href="/courses"
          variant="primary"
          size="lg"
          className="w-full sm:w-auto"
        >
          回課程列表
        </LinkButton>
        <a
          href={SITE.lineHref}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass({
            variant: "outline",
            size: "lg",
            className: "w-full sm:w-auto",
          })}
        >
          加我們的 LINE
          <span className="sr-only">（會開啟 LINE）</span>
        </a>
      </div>
    </div>
  );
}

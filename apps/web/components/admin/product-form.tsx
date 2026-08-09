import Link from "next/link";
import {
  AdminCheckbox,
  AdminField,
  AdminSelect,
  AdminTextarea,
} from "@/components/admin/admin-field";
import { SingleImageField } from "@/components/admin/image-uploader";
import { upsertProduct } from "@/app/admin/products/actions";
import {
  PRODUCT_TYPES,
  PRODUCT_TYPE_LABEL,
  SLUG_MAX,
  SLUG_PATTERN,
  arrayToLines,
  type ProductRow,
} from "@/app/admin/products/shared";
import { adminPrimaryButton, adminSecondaryButton } from "@/app/admin/products/ui";

/**
 * 課程基本資料表單。
 *
 * 刻意是 server component、完全非受控、零 state：
 * 所有欄位只給 defaultValue，值在送出時經 FormData 一次讀完。
 * 這樣整張表單（含十幾個欄位）不需要送任何 JavaScript 到瀏覽器。
 *
 * 驗證分兩層，兩層都要有：
 *   瀏覽器原生 —— required / pattern / min / maxLength，送出前就擋下來
 *   server 端  —— upsertProduct() 再驗一次（表單可以繞過，action 也接受直接 POST）
 *
 * ⚠️ 取捨：server 端驗證失敗時是 redirect 回來的，使用者剛打的字會不見。
 *    所以格式類的規則盡量掛在原生屬性上，讓「真的送到 server 才失敗」
 *    只剩下代稱重複這種瀏覽器不可能知道的情況。
 */

export function ProductForm({ product }: { product: ProductRow | null }) {
  const isNew = product === null;

  return (
    <form action={upsertProduct} className="flex flex-col gap-5">
      {/* 編輯既有課程時把 id 帶回去。新增時不放這個欄位，action 就走 insert。 */}
      {product && <input type="hidden" name="id" value={product.id} />}

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 admin:grid-cols-2">
        <AdminSelect
          name="type"
          label="類型"
          required
          defaultValue={product?.type ?? "course"}
          options={PRODUCT_TYPES.map((value) => ({
            value,
            label: PRODUCT_TYPE_LABEL[value],
          }))}
          hint="線上課程有單元、實體工作坊有場次。存檔後可以再改。"
        />

        <AdminField
          name="sort_order"
          label="排序"
          type="number"
          step={1}
          required
          defaultValue={product?.sort_order ?? 0}
          hint="數字小的排前面。前台列表依這個值由小到大排。"
        />

        <AdminField
          name="title"
          label="課程名稱"
          required
          maxLength={200}
          defaultValue={product?.title ?? ""}
          wrapperClassName="admin:col-span-2"
        />

        <AdminField
          name="subtitle"
          label="副標題"
          maxLength={200}
          defaultValue={product?.subtitle ?? ""}
          wrapperClassName="admin:col-span-2"
          hint="卡片標題下面那一行，例如「終生回放，另有台北實體班」。"
        />

        <AdminField
          name="slug"
          label="網址代稱"
          required
          pattern={SLUG_PATTERN}
          maxLength={SLUG_MAX}
          defaultValue={product?.slug ?? ""}
          wrapperClassName="admin:col-span-2"
          // title 是瀏覽器擋下來時顯示的那句話，內容要和 hint 一致，
          // 不然使用者會看到兩套說法。
          title="只能用小寫英文、數字與連字號（-）"
          hint="只能用小寫英文、數字與連字號，例如 jsj-beginner。會變成前台網址 /courses/jsj-beginner。"
        />

        {/*
          代稱是網址的一部分，改掉＝舊連結全部 404。
          只在編輯既有課程時警告：新增的時候還沒有人拿到連結，講了只是雜訊。
        */}
        {product && (
          <p className="text-[13px] leading-relaxed text-danger admin:col-span-2">
            ⚠️ 這門課已經存在。修改網址代稱會讓
            <span className="font-medium">舊網址失效（404）</span>
            —— 已經發出去的 LINE 連結、電子報、名片上的 QR code 都會連不到。
            非改不可時，請一併通知有發過連結的同事。
          </p>
        )}

        <AdminTextarea
          name="description"
          label="課程介紹"
          rows={5}
          maxLength={4000}
          defaultValue={product?.description ?? ""}
          wrapperClassName="admin:col-span-2"
        />

        <AdminField
          name="price"
          label="售價"
          type="number"
          min={0}
          step={1}
          required
          defaultValue={product?.price ?? 0}
          hint="新台幣，整數。免費課程填 0。"
        />

        <AdminField
          name="compare_at_price"
          label="原價（劃線顯示）"
          type="number"
          min={0}
          step={1}
          defaultValue={product?.compare_at_price ?? ""}
          hint="留空就不顯示。有填的話必須大於或等於售價。"
        />

        <SingleImageField
          name="cover_url"
          label="課程封面"
          kind="covers"
          defaultUrl={product?.cover_url ?? undefined}
        />

        <div className="flex flex-col justify-end gap-1">
          <AdminCheckbox
            name="is_published"
            label="發布到前台"
            defaultChecked={product?.is_published ?? false}
          />
          <AdminCheckbox
            name="is_featured"
            label="首頁主推"
            defaultChecked={product?.is_featured ?? false}
          />
        </div>

        {/*
          tags 與 benefits 是 text[]。用「一行一項」的 textarea 而不是
          逗號分隔：課程效益本來就常常包含頓號與逗號
          （「可問老師，不限次數」），用逗號當分隔會把一項切成兩項。
        */}
        <AdminTextarea
          name="tags"
          label="標籤"
          rows={4}
          defaultValue={arrayToLines(product?.tags)}
          hint="一行一個。顯示在課程卡片上，例如「線上課程」「進階」。"
        />

        <AdminTextarea
          name="benefits"
          label="課程效益"
          rows={4}
          defaultValue={arrayToLines(product?.benefits)}
          hint="一行一個，例如「終生回放」「含紙本課本」。"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <button type="submit" className={adminPrimaryButton}>
          {isNew ? "建立課程" : "儲存變更"}
        </button>
        <Link href="/admin/products" className={adminSecondaryButton}>
          取消
        </Link>
        {isNew && (
          <p className="text-[13px] text-ink-soft">
            建立之後才能編輯單元與場次（它們需要先有課程才掛得上去）。
          </p>
        )}
      </div>
    </form>
  );
}

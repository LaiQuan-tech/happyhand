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
  type ProductType,
} from "@/app/admin/products/shared";
import {
  SectionHeader,
  adminPrimaryButton,
  adminSecondaryButton,
} from "@/app/admin/products/ui";

/**
 * 課程／工作坊的內容欄位，**拆成一段一段的區段元件**。
 *
 * 🔑 為什麼不是一個 <ProductForm>：
 *    編輯頁的區段順序刻意等同前台頁面由上到下的順序，而前台順序是
 *      大圖 → 標題簡介 → 場次 → 適合誰 → 學習路徑 → 課程內容 → …
 *    其中「場次」「學習路徑」等等是各自獨立的 <form>（SessionEditor /
 *    BlockEditor 走 useActionState）。要把商品欄位排在它們之間，
 *    商品欄位就不可能全部包在同一個 <form> 元素裡 —— form 不能巢狀。
 *
 * 🔑 解法是原生 HTML 的表單關聯：頁面上放一個空的
 *    <form id={PRODUCT_FORM_ID} action={upsertProduct} />（ProductFormAnchor），
 *    每個欄位帶 form={PRODUCT_FORM_ID} 歸隊。new FormData(form) 依規範會
 *    收錄所有關聯欄位，不管它們在 DOM 的哪裡。已實測 React 19 + Next 15.5
 *    的 server action 收得到（form 元素前面的、後面的、隔著另一張 form 的都可以）。
 *
 * 🔴 upsertProduct 寫的是**完整 payload**：沒出現在 FormData 裡的欄位會被
 *    寫成 null／false。所以所有欄位一定要屬於同一張表單、一次送出。
 *    不可以為了「分段儲存」把它拆成好幾個 action={upsertProduct} 的表單，
 *    那會靜默清掉沒送出的那些欄位。is_published 也因此保留成 hidden。
 *
 * 這些元件全部是 server component、非受控、零 state：
 * 只給 defaultValue，值在送出時經 FormData 一次讀完。
 *
 * ⚠️ 取捨：server 端驗證失敗時是 redirect 回來的，使用者剛打的字會不見
 *    （actions.ts 的註解有寫）。所以會擋下來的必填欄位（類型／代稱／售價／
 *    排序）全部集中在「設定」那一段並掛上原生 required/pattern，
 *    內容欄位剩下的都是選填 textarea，幾乎走不到 server 端失敗。
 */

export const PRODUCT_FORM_ID = "product-content";

type SectionProps = {
  product: ProductRow | null;
  /** 前台由上到下的第幾段，由頁面連號產生。新增課程時不編號。 */
  step?: string;
  /**
   * 新增時的類型預選。
   * 工作坊清單頁的「新增工作坊」會帶 ?type=workshop 進來，
   * 不然每次從那一頁新增都要手動把「線上課程」改成「實體工作坊」。
   * 編輯既有商品時忽略（用商品自己的 type）。
   */
  defaultType?: ProductType;
};

/**
 * 承接 action 的空表單。
 *
 * ⚠️ 一定要跟欄位放在同一頁，而且 id 不能改 —— 欄位是靠 form={PRODUCT_FORM_ID}
 *    找它的。這個元素本身不放任何欄位（React 會在裡面塞 server action 的
 *    hidden $ACTION_ID，那是它自己的事）。
 */
export function ProductFormAnchor({ product }: { product: ProductRow | null }) {
  return (
    <>
      <form id={PRODUCT_FORM_ID} action={upsertProduct} className="hidden" />

      {/* 編輯既有課程時把 id 帶回去。新增時不放這個欄位，action 就走 insert。 */}
      {product && (
        <input type="hidden" name="id" value={product.id} form={PRODUCT_FORM_ID} />
      )}

      {/*
        🔴 is_published 必須跟著送，而且值要是現況。
           upsertProduct 讀的是 formData.get("is_published") === "on"，
           欄位不存在就是 false —— 少了這一行，任何一次「儲存」都會把
           已上架的課程靜默下架。
           上架／下架的操作在頁首那顆按鈕（togglePublish），不在這張表單裡，
           所以這裡只是把現值原封不動帶回去。
      */}
      <input
        type="hidden"
        name="is_published"
        value={product?.is_published ? "on" : ""}
        form={PRODUCT_FORM_ID}
      />
    </>
  );
}

/* ------------------------------------------------------- ① 最上面的大圖 */

export function ProductCoverSection({ product, step }: SectionProps) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        step={step}
        title="最上面的大圖"
        description="前台頁面打開來的第一眼。留空的話那個位置就整塊不出現，頁面會直接從標題開始。"
      />
      <SingleImageField
        form={PRODUCT_FORM_ID}
        name="cover_url"
        label="封面圖片"
        kind="covers"
        defaultUrl={product?.cover_url ?? undefined}
        hint="下方預覽框就是前台的比例（16:9）。框裡看得到的才會出現在網站上，重要的字不要壓在邊邊。"
      />
    </section>
  );
}

/* ------------------------------------------------------- ② 標題與簡介 */

export function ProductIntroSection({ product, step }: SectionProps) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <SectionHeader
        step={step}
        title="標題與簡介"
        description="大圖底下那一整區，由上到下就是這裡的順序：標題、副標、簡介、引言、賣點標籤。"
      />

      <AdminField
        form={PRODUCT_FORM_ID}
        name="title"
        label="標題"
        required
        maxLength={200}
        defaultValue={product?.title ?? ""}
        hint="前台頁面最大的那行字。"
      />

      <AdminField
        form={PRODUCT_FORM_ID}
        name="subtitle"
        label="副標"
        maxLength={200}
        defaultValue={product?.subtitle ?? ""}
        hint="標題底下小一號的那行，例如「台北實體工作坊」。留空就不顯示。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="description"
        label="簡介"
        rows={4}
        maxLength={4000}
        defaultValue={product?.description ?? ""}
        hint="兩三句話說明這堂課是什麼。課程卡片上也會用到這段。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="hero_lead"
        label="引言"
        rows={4}
        maxLength={2000}
        defaultValue={product?.hero_lead ?? ""}
        hint="簡介下面再一段，可以分段（換行會保留）。用來說這堂課想幫學員解決什麼。留空就不顯示。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="benefits"
        label="賣點標籤"
        rows={4}
        defaultValue={arrayToLines(product?.benefits)}
        hint="一行一個，前台排成一列小藥丸，例如「含茶點」「可改期一次」。"
      />
    </section>
  );
}

/* --------------------------------------------- ④ 適合誰・學完之後 */

export function ProductAudienceSection({ product, step }: SectionProps) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <SectionHeader
        step={step}
        title="適合誰・學完之後"
        description="前台排成左右對照的兩欄，下面接一張「學完之後」的卡片。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="suitable_for"
        label="這堂課適合誰"
        rows={5}
        defaultValue={arrayToLines(product?.suitable_for)}
        hint="一行一項。例如「想以簡單、安全的方式照顧自己與家人」。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="not_suitable_for"
        label="目前可能不適合"
        rows={5}
        defaultValue={arrayToLines(product?.not_suitable_for)}
        hint="一行一項。跟上一欄併成左右兩欄；兩欄都留空的話整塊不顯示。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="outcomes"
        label="學完之後可以做到什麼"
        rows={5}
        defaultValue={arrayToLines(product?.outcomes)}
        hint="一行一項。例如「認識 26 個安全能量鎖及其基本位置」。"
      />
    </section>
  );
}

/* ------------------------------------------------- ⑥ 課程內容（線上／實體） */

export function ProductCurriculumSection({ product, step }: SectionProps) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <SectionHeader
        step={step}
        title="課程內容（線上／實體）"
        description="文字版的課程大綱，前台排成左右兩欄。這跟上面實際的單元／場次是兩回事，這裡只是給人看的說明。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="curriculum_online"
        label="課程內容（線上）"
        rows={5}
        defaultValue={arrayToLines(product?.curriculum_online)}
        hint="一行一項。純實體課程留空即可。"
      />

      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="curriculum_onsite"
        label="課程內容（實體）"
        rows={5}
        defaultValue={arrayToLines(product?.curriculum_onsite)}
        hint="一行一項。純線上課程留空即可。只有一邊有內容就只顯示一欄。"
      />
    </section>
  );
}

/* --------------------------------------------- ⑧ 一次報名，全部帶走 */

export function ProductIncludesSection({ product, step }: SectionProps) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <SectionHeader
        step={step}
        title="一次報名，全部帶走"
        description="前台顯示成一片標籤雲，讓人一眼看到報名之後拿得到什麼。"
      />
      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="includes"
        label="報名包含哪些東西"
        rows={4}
        defaultValue={arrayToLines(product?.includes)}
        hint="一行一項，例如「15 小時線上預錄」「6 個月班級群組」。"
      />
    </section>
  );
}

/* ------------------------------------------------- ⑫ 來之前先知道 */

export function ProductNotesSection({ product, step }: SectionProps) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <SectionHeader
        step={step}
        title="來之前先知道"
        description="前台頁面最後一段的注意事項。留空的話會顯示系統內建的預設幾條。"
      />
      <AdminTextarea
        form={PRODUCT_FORM_ID}
        name="notes"
        label="注意事項"
        rows={5}
        defaultValue={arrayToLines(product?.notes)}
        hint="一行一項，例如「工具與講義我們準備，帶一顆放鬆的心來就好」。"
      />
    </section>
  );
}

/* ------------------------------------------------------------ 設定 */

/**
 * 不會直接變成前台版面的欄位：類型、網址、排序、價格、上架設定。
 *
 * 刻意跟內容欄位分開，也刻意**不放進 <details> 收合**：
 * 這一段裡有 required 欄位，收合起來（display:none）時若驗證失敗，
 * 瀏覽器沒辦法把焦點移到看不見的欄位，會直接靜默拒絕送出 ——
 * 使用者按了儲存但什麼都沒發生，也沒有任何錯誤訊息。
 */
export function ProductSettingsSection({ product, step, defaultType }: SectionProps) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <SectionHeader
        step={step}
        title="設定"
        description="這一段不會直接變成前台的版面，是這門課的基本設定與價格。"
      />

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 admin:grid-cols-2">
        <AdminSelect
          form={PRODUCT_FORM_ID}
          name="type"
          label="類型"
          required
          defaultValue={product?.type ?? defaultType ?? "course"}
          options={PRODUCT_TYPES.map((value) => ({
            value,
            label: PRODUCT_TYPE_LABEL[value],
          }))}
          hint="線上課程有單元、實體工作坊有場次。存檔後可以再改。"
        />

        <AdminField
          form={PRODUCT_FORM_ID}
          name="sort_order"
          label="排序"
          type="number"
          step={1}
          required
          defaultValue={product?.sort_order ?? 0}
          hint="數字小的排前面。前台列表依這個值由小到大排。"
        />

        <AdminField
          form={PRODUCT_FORM_ID}
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

        <AdminField
          form={PRODUCT_FORM_ID}
          name="price"
          label="售價"
          type="number"
          min={0}
          step={1}
          required
          defaultValue={product?.price ?? 0}
          hint="新台幣，整數。免費課程填 0。工作坊的每一場可以另外設價，會蓋過這裡。"
        />

        <AdminField
          form={PRODUCT_FORM_ID}
          name="compare_at_price"
          label="原價（劃線顯示）"
          type="number"
          min={0}
          step={1}
          defaultValue={product?.compare_at_price ?? ""}
          hint="留空就不顯示。有填的話必須大於或等於售價。"
        />

        {/*
          tags 與 benefits 都是 text[]。用「一行一項」的 textarea 而不是
          逗號分隔：課程效益本來就常常包含頓號與逗號
          （「可問老師，不限次數」），用逗號當分隔會把一項切成兩項。
        */}
        <AdminTextarea
          form={PRODUCT_FORM_ID}
          name="tags"
          label="標籤"
          rows={4}
          defaultValue={arrayToLines(product?.tags)}
          hint="一行一個。顯示在課程列表的卡片上，例如「線上課程」「進階」。"
          wrapperClassName="admin:col-span-2"
        />

        <div className="flex flex-col gap-1 admin:col-span-2">
          <AdminCheckbox
            form={PRODUCT_FORM_ID}
            name="is_featured"
            label="首頁主推"
            defaultChecked={product?.is_featured ?? false}
          />
          <AdminCheckbox
            form={PRODUCT_FORM_ID}
            name="asks_intake"
            label="結帳時詢問報名問題"
            defaultChecked={product?.asks_intake ?? false}
            hint="勾選後，客人結帳時要多回答學習經驗、想改善什麼、從哪得知，並勾選健康聲明。"
          />
        </div>
      </div>

      <p className="text-[13px] leading-relaxed text-ink-soft">
        {product
          ? "上架／下架請用頁面最上面那顆按鈕，按下去立刻生效，不用再按儲存。"
          : "新建立的課程一律是未上架狀態。內容填好之後，用頁面最上面的「發布」按鈕才會出現在前台。"}
      </p>
    </section>
  );
}

/* ------------------------------------------------------------ 儲存列 */

/**
 * 整頁商品欄位共用的送出鈕。
 *
 * sticky 是因為這一頁很長 —— 欄位照前台順序攤開之後，從最上面的大圖捲到
 * 最後的注意事項有好幾個螢幕高，儲存鈕只放在最底下的話，改完中間某一欄
 * 的人得先捲到底才存得到。
 *
 * ⚠️ 手機上底部有 AdminBottomNav（fixed、約 55px + 安全區），
 *    sticky bottom-0 會被它蓋住，所以要往上讓開；admin: 以上那個列不存在，
 *    貼齊底部即可。
 *
 * 🔴 它只送 product-content 這一張表單。因為現在它常駐在畫面底部、
 *    等於貼在每一個區段旁邊，按下去會 redirect —— 場次／單元／區塊
 *    編輯器裡還沒按過自己那顆儲存鈕的輸入會全部消失（BlockEditor 的
 *    新增與排序只活在 client state，一次 redirect 就歸零）。
 *    標籤與說明因此刻意寫成「課程資料」而不是「這一頁」。
 */
export function ProductSaveBar({
  isNew,
  backTo = "course",
}: {
  isNew: boolean;
  /** 「取消」要回哪一張清單。跟頁首麵包屑同一個判斷。 */
  backTo?: "course" | "workshop";
}) {
  return (
    <div className="sticky bottom-[calc(58px+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-paper px-4 py-3 admin:bottom-0 admin:-mx-6 admin:px-6">
      <button type="submit" form={PRODUCT_FORM_ID} className={adminPrimaryButton}>
        {isNew ? "建立課程" : "儲存課程資料"}
      </button>
      <Link
        href={backTo === "workshop" ? "/admin/workshops" : "/admin/courses"}
        className={adminSecondaryButton}
      >
        取消
      </Link>
      <p className="text-[13px] text-ink-soft">
        {isNew
          ? "建立之後才能編輯單元與場次（它們需要先有課程才掛得上去）。"
          : "不含場次、單元與報名頁區塊 —— 那些各自有自己的儲存鈕，請先按完再按這一顆。"}
      </p>
    </div>
  );
}

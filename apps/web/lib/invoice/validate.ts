/**
 * 發票欄位的驗證。
 *
 * 這一支刻意不 import 任何 server-only 的東西 —— 結帳頁的 client 元件要用
 * 同一組規則做即時提示，server 端再驗一次。兩邊共用一份，規則才不會漂掉。
 *
 * ⚠️ 為什麼值得自己驗而不是丟給 Amego 回錯：
 *    開票是**付款成功之後**才發生的事。這時候客人已經離開網站了，Amego 打回來
 *    「載具格式錯誤」只會變成一列 retry_count 爬到上限的失敗紀錄，然後要客服
 *    打電話去問客人載具到底是什麼。錯的資料要在結帳當下就擋下來。
 */

export const CARRIER_TYPES = [
  "cloud",
  "phone",
  "natural_person",
  "love_code",
  "b2b",
] as const;

export type CarrierType = (typeof CARRIER_TYPES)[number];

export function isCarrierType(v: unknown): v is CarrierType {
  return typeof v === "string" && (CARRIER_TYPES as readonly string[]).includes(v);
}

/**
 * 手機條碼載具：斜線開頭，後面 7 碼。
 * 允許的字元是財政部規定的 0-9 A-Z 加上 . + -（共 39 個字元的編碼表）。
 */
const PHONE_CARRIER_RE = /^\/[0-9A-Z.+-]{7}$/;

/** 自然人憑證：2 個大寫英文 + 14 個數字。 */
const NATURAL_PERSON_RE = /^[A-Z]{2}[0-9]{14}$/;

/** 愛心碼：3 到 7 碼數字。 */
const LOVE_CODE_RE = /^[0-9]{3,7}$/;

const TAX_ID_RE = /^[0-9]{8}$/;

/**
 * 統一編號的檢查碼。
 *
 * 演算法（財政部）：權數 [1,2,1,2,1,2,4,1]，每一位數乘上權數之後**把乘積的
 * 每一位數字相加**（例如 8×2=16 要算成 1+6=7），全部加總能被 5 整除就合格。
 *
 * 🔴 第 7 位（index 6）是 7 的時候有例外：總和加 1 之後能被 5 整除也算合格。
 *    這一條常常被漏掉，會把合法統編判成錯的 —— 而且錯誤方向是「擋下真實客人」，
 *    比放行一個錯統編更難被發現（客人只會覺得網站壞了然後離開）。
 */
export function isValidTaxId(v: string): boolean {
  if (!TAX_ID_RE.test(v)) return false;

  // 00000000 的加權總和是 0，能被 5 整除，所以檢查碼演算法會判它合格。
  // 但那顯然不是真的統編（我們送給 Amego 的 B2C 買方代號是 10 個 0，不是這個）。
  if (v === "00000000") return false;

  const weights = [1, 2, 1, 2, 1, 2, 4, 1];
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const product = Number(v[i]) * weights[i];
    // 乘積可能是兩位數，要拆開相加
    sum += Math.floor(product / 10) + (product % 10);
  }

  if (sum % 5 === 0) return true;
  return v[6] === "7" && (sum + 1) % 5 === 0;
}

export type InvoiceInput = {
  carrierType: CarrierType;
  /** 載具號碼或愛心碼 */
  carrierId: string;
  taxId: string;
  title: string;
};

export type InvoiceFieldError = {
  field: "carrierId" | "taxId" | "title";
  message: string;
};

/**
 * 驗證一組發票輸入，回傳第一個錯誤（沒有錯就回 null）。
 *
 * 訊息一律寫成完整的中文句子並說明「應該長什麼樣」，跟結帳頁其他欄位同一個
 * 風格（見 checkout-view.tsx 的 errors useMemo）。客群偏長輩，只寫「格式錯誤」
 * 他們不知道要改什麼。
 */
export function validateInvoice(input: InvoiceInput): InvoiceFieldError | null {
  const carrierId = input.carrierId.trim();
  const taxId = input.taxId.trim();

  switch (input.carrierType) {
    case "cloud":
      // 不需要任何欄位。發票會存在 Amego 的雲端，客人用會員載具查。
      return null;

    case "phone":
      if (!carrierId) {
        return { field: "carrierId", message: "請填手機條碼，格式是斜線開頭共 8 個字，例如 /ABC+123。" };
      }
      if (!PHONE_CARRIER_RE.test(carrierId.toUpperCase())) {
        return {
          field: "carrierId",
          message: "手機條碼格式不對。它是斜線開頭、後面 7 個字（大寫英文、數字或 . + -），例如 /ABC+123。",
        };
      }
      return null;

    case "natural_person":
      if (!carrierId) {
        return { field: "carrierId", message: "請填自然人憑證條碼，格式是 2 個大寫英文加 14 個數字。" };
      }
      if (!NATURAL_PERSON_RE.test(carrierId.toUpperCase())) {
        return {
          field: "carrierId",
          message: "自然人憑證條碼格式不對。它是 2 個大寫英文加 14 個數字，共 16 個字。",
        };
      }
      return null;

    case "love_code":
      if (!carrierId) {
        return { field: "carrierId", message: "請填愛心碼（3 到 7 位數字）。不知道的話可以問要捐贈的單位。" };
      }
      if (!LOVE_CODE_RE.test(carrierId)) {
        return { field: "carrierId", message: "愛心碼是 3 到 7 位數字。" };
      }
      return null;

    case "b2b":
      if (!taxId) {
        return { field: "taxId", message: "請填公司的統一編號（8 位數字）。" };
      }
      if (!TAX_ID_RE.test(taxId)) {
        return { field: "taxId", message: "統一編號是 8 位數字。" };
      }
      if (!isValidTaxId(taxId)) {
        return { field: "taxId", message: "這組統一編號的檢查碼不對，請再確認一次。" };
      }
      if (!input.title.trim()) {
        return { field: "title", message: "請填公司抬頭，這會印在發票上。" };
      }
      return null;

    default:
      return null;
  }
}

/**
 * 把輸入正規化成要存進 DB 的形狀。
 *
 * ⚠️ 載具號碼一律轉大寫：財政部的編碼表只有大寫，客人打小寫送到 Amego 會被
 *    當成不同的載具（或直接被打回來）。
 */
export function normalizeInvoice(input: InvoiceInput): {
  carrierType: CarrierType;
  carrierId: string | null;
  taxId: string | null;
  title: string | null;
} {
  const t = input.carrierType;

  if (t === "b2b") {
    return {
      carrierType: "b2b",
      carrierId: null,
      taxId: input.taxId.trim() || null,
      title: input.title.trim().slice(0, 60) || null,
    };
  }

  if (t === "cloud") {
    return { carrierType: "cloud", carrierId: null, taxId: null, title: null };
  }

  const id = input.carrierId.trim();
  return {
    carrierType: t,
    // 愛心碼是純數字，轉大寫沒有副作用；載具則一定要轉。
    carrierId: (t === "love_code" ? id : id.toUpperCase()) || null,
    taxId: null,
    title: null,
  };
}

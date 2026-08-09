# 快樂手 Happy Healing Hands

好日子股份有限公司（GOOD DAY LOVE INC.）「快樂手」品牌的課程電商網站 —
仁神術（Jin Shin Jyutsu, JSJ）線上課程與實體工作坊。

主要客群是退休樂齡族（60–75 歲），**可及性是硬性需求不是加分項**：
內文最小 17px、按鈕高度 ≥ 56px、每頁都要有 LINE 聯絡出口、支援放大到 200% 不破版。

---

## 架構

```
GitHub（原始碼）
  ├── Vercel   → apps/web   前端 + Route Handlers（push main 自動部署 production，PR 產生 Preview）
  ├── Railway  → apps/worker 排程與背景工作
  └── Supabase → DB / Auth / Storage（migration 由 GitHub Actions 在 merge 後 db push）
```

| 層 | 選擇 |
|---|---|
| Framework | Next.js 15 App Router + TypeScript |
| 樣式 | Tailwind CSS v4（token 寫在 `apps/web/app/globals.css` 的 `@theme`） |
| UI | 自建元件（`apps/web/components/ui/`），沒有用任何 UI kit |
| DB / Auth / Storage | Supabase（Postgres + RLS） |
| 背景服務 | Railway（node-cron） |

## 目錄

```
happyhand/
├── apps/web/                  # Next.js（Vercel）
│   ├── app/                   # App Router 頁面
│   ├── components/            # 共用元件（ui/ 為基礎元件）
│   ├── lib/                   # site.ts 品牌資訊、content.ts 真實內容、data.ts 資料層、supabase/
│   └── .env.local             # 本機環境變數（不進版控）
├── apps/worker/               # Railway 排程服務
├── supabase/migrations/       # SQL migration（CI 自動 db push）
├── design_handoff_happyhands/ # 設計交付包：規格、文案、設計稿 HTML（視覺真相）
└── .github/workflows/ci.yml   # lint / typecheck / build / db push
```

## 本機開發

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

`apps/web/.env.local` 需要：

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # 只在 server 使用，勿加 NEXT_PUBLIC_
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

> 資料層（`apps/web/lib/data.ts`）**以資料庫為唯一真相，沒有靜態 fallback**。
> 查得到但零筆 → 顯示誠實的空狀態；連不上 → 記 log 後回空，靠 ISR 的舊快取撐著。
> 曾經有過「查不到就退回 `lib/content.ts`」的設計，但有了後台之後那會變成 bug：
> 把課程全部下架反而會讓前台冒出舊資料，而且不會有任何錯誤。

## 部署

### Vercel（前端）

- Project：`happyhands`，Root Directory 設 `apps/web`，Framework 選 Next.js。
- 已連 GitHub `LaiQuan-tech/happyhand`：**push 到 `main` 自動部署 production，PR 自動產生 Preview**。
- 環境變數在 Vercel 專案設定裡，四個都要有（見上）。

### Supabase（資料庫）

- Migration 放 `supabase/migrations/`，檔名 `YYYYMMDDHHMMSS_name.sql`。
- CI 在 push 到 `main` 且 web/worker 都通過後，自動執行 `supabase db push`。
- 手動執行：

```bash
supabase link --project-ref <PROJECT_REF>
supabase db push
```

### Railway（背景服務）

- Root Directory 用 **repo 根目錄**（不是 `apps/worker`），設定在 `railway.json`。
- Watch Paths 設 `apps/worker/**` 與 `railway.json`，避免改前端也重新部署 worker。
- 環境變數：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`RESEND_API_KEY`（選用）、`LINE_CHANNEL_ACCESS_TOKEN`（選用）。
- 詳見 `apps/worker/README.md`。

## CI

`.github/workflows/ci.yml`：

| Job | 觸發 | 內容 |
|---|---|---|
| `web` | push / PR | lint、typecheck、build |
| `worker` | push / PR | typecheck、build |
| `migrate` | 只在 push 到 `main` 且前兩者成功 | `supabase db push` |

需要的 repository secrets：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、
`NEXT_PUBLIC_SITE_URL`、`SUPABASE_ACCESS_TOKEN`、`SUPABASE_PROJECT_ID`、`SUPABASE_DB_PASSWORD`。

## 管理員後台 `/admin`

### 角色

| role | 中文 | 能做什麼 |
|---|---|---|
| `customer` | 一般會員（預設） | 只有前台，進不了 `/admin` |
| `support` | 客服 | 訂單、標記收款、取消退款、報名名單匯出、候補、開關場次報名 |
| `editor` | 內容編輯 | 課程與工作坊 CRUD、單元、場次、圖片上傳 |
| `owner` | 負責人 | 以上全部 ＋ 員工帳號管理 ＋ 稽核紀錄 |

`editor` **看不到訂單**是刻意的：訂單含姓名、電話、Email、寄送地址，
內容編輯的工作不需要這些。能力表的唯一真相在 `apps/web/lib/admin/roles.ts`。

### 第一位 owner 怎麼產生

到 Supabase Dashboard 的 SQL editor 執行一次（email 是 PII，刻意不寫進 migration）：

```sql
insert into public.staff_invites (email, role)
values (lower(trim('負責人的信箱')), 'owner');
```

然後該信箱到 `/login` 註冊，`handle_new_user()` trigger 會自動套用角色並刪掉那筆邀請。
之後所有員工都由 owner 在 `/admin/staff` 邀請，不需要再下 SQL。
owner 不需要、也不可以替員工設密碼。

### 為什麼授權不走 RLS

後台寫入一律經 service role，授權擋在 TypeScript 層（`lib/admin/guard.ts`），
**沒有寫任何 admin RLS policy**。這不是偷懶：

`supabase/migrations/20260808000002_rls.sql` 開頭 `revoke all ... from anon, authenticated`，
讓「沒有 GRANT」本身就是最強的一道防線。走真 RLS 的話得
`grant insert/update/delete on products… to authenticated`、
`grant update on orders to authenticated` —— 後者那個檔案的註解正好寫著為什麼不行
（「orders.status 若使用者可改，任何人都能把自己的訂單改成 paid」）。
為了後台去拆掉這道保護不划算。

代價：對 service role key 外洩沒有第二道防線。緩解是 key 只存在 Vercel 環境變數
（不進 client bundle）＋ `audit_log` 留下每一筆寫入的痕跡。

四層守衛：

| 層 | 位置 | 擋什麼 |
|---|---|---|
| 1 | `middleware.ts` | 只看有無 session cookie，**不查 DB**。`/api/admin/*` 回 401 不導轉 |
| 2 | `app/admin/layout.tsx` | 查 role，非員工導回首頁。**保護不了 server action** |
| 3 | 每支 server action / route handler 的 `requireCapability()` | **唯一不能少的一層** |
| 4 | DB | 維持 revoke-all |

### 圖片素材

public bucket **`media`**，bucket 名的唯一真相在 `apps/web/lib/admin/media.ts`。

⚠️ **bucket 名一旦有圖就不能改** —— `products.cover_url` 存的是完整 public URL，
改名會讓所有既有圖片 404。

⚠️ 該 bucket **刻意沒有任何 `storage.objects` policy**。讀走 public endpoint 不經 RLS，
寫因為沒有 insert policy 而全擋，上傳只能經 `/api/admin/uploads`。
**不要「順手補齊 RLS」加 select policy** —— 加了之後匿名就能用 `storage.list()`
列出整個 bucket 的檔名。

圖片刪除只從欄位移除，**不刪 storage 檔案**（誤刪線上圖的代價高於孤兒檔）。
bucket 會單向長大，長期需要清理腳本。以目前規模一年不到 50MB。

### 報名名單與 `seats_taken`

報名名單是從 `order_items` join `orders(status='paid')` **即時算出來的**，
不是讀 `seats_taken`。

`seats_taken` 是場次建立時寫入的初始值，全站沒有任何程式碼寫過它
（`reserve_seat()` 那套 15 分鐘暫扣沒有接上結帳流程）。所以它與實際報名數
**目前對不起來**，後台兩個數字都會顯示並標註原因。
校正手段只有 `/admin/sessions/[id]` 的名額微調（走 `admin_adjust_seats` RPC）。

`seats_taken` 仍然有作用：結帳時的可用名額 = `capacity − seats_taken − 未付款但已下單`。

### 聯絡方式：LINE 官方帳號

站上**不再放電話**，所有聯絡出口都指向 LINE 官方帳號 `@hao2082l`
（`https://page.line.me/hao2082l`）。唯一真相在 `apps/web/lib/site.ts` 的
`lineId` / `lineLabel` / `lineHref`。

⚠️ 那是**外部連結**，不是 `tel:`。手寫 `<a>` 要自己帶 `target="_blank"` 與
`rel="noopener noreferrer"`；`LinkButton` 現在會在 `href` 以 `http` 開頭時
自動帶上（呼叫端仍可覆寫）。純圖示或短標籤的連結要補
`<span className="sr-only">（會開啟 LINE）</span>`，讓螢幕閱讀器知道會開新分頁。

後台的 `tel:` 連結是**刻意保留**的：客人結帳時仍會留電話，客服在手機後台
點一下就能撥出去，那是他們最常做的下一步。

### 報名名單 CSV 是個資出口

姓名＋電話＋Email＋地址會一次打包離開系統。每次匯出都會寫進 `audit_log`
（誰、何時、哪一場、幾筆幾人）。**流程上要跟好日子講清楚誰能匯、匯出後存哪。**

`lib/admin/csv.ts` 處理了三個不做就會出事的問題：formula injection
（姓名是使用者輸入，`=HYPERLINK(...)` 會在員工開檔時真的執行）、
Excel 吃掉電話開頭的 0、UTF-8 中文亂碼（Excel 只看 BOM）。

## 設計規範

視覺真相是 `design_handoff_happyhands/design/happyhands-B-all-pages.dc.html`（7 頁 × 桌機＋手機）。
改 UI 之前先讀 `design_handoff_happyhands/README.md`：

- 顏色一律用 `globals.css` `@theme` 裡的 token，**不可出現 token 以外的色碼**，不可用 Inter 或預設藍色連結。
- 字級用 `t-h1` / `t-h2` / `t-body` 等 utility，已內建 390px→1280px 流體內插（390px 等於手機稿、≥1280px 等於桌機稿）。
- 斷點：`< 768px` 手機單欄＋底部固定行動列 / `768–1279px` 平板兩欄 / `≥ 1280px` 桌機。
- 動畫只做淡入與位移、≤300ms，遵守 `prefers-reduced-motion`，禁止視差與自動輪播。

## 文案規範

見 `design_handoff_happyhands/CONTENT.md`。重點：

- 對象是長輩，短句、口語、稱呼用「你」。
- **禁止醫療宣稱**（治療／療效／根治／痊癒／取代醫療），這是法規風險。可用「練習」「調理」「照顧自己」「放鬆」。
- 不要英文術語、行銷腔、emoji。
- 頁尾需有免責聲明：本課程為自我保健練習，非醫療行為，不能取代專業醫療診斷與治療。

## 尚未完成

- **金流**：綠界 ECPay 尚未串接（缺商店代號／HashKey／HashIV）。目前結帳會建立 `pending` 訂單，由客服用 LINE 確認。
- **會員功能**：Supabase Auth 已接上（員工登入與後台可用），但 `/account` 的會員中心仍是骨架頁 —— `orders.user_id` 目前永遠是 null（全站訪客結帳），所以會員查不到自己的訂單。要做得先設計「訪客訂單如何綁到後來註冊的帳號」。
- **影片**：Storage 私有 bucket 與簽名 URL 尚未建立。
- **素材**：設計稿中的斜紋色塊都是圖片佔位，等客戶提供照片（清單見 `design_handoff_happyhands/README.md` §8）。
- **網域**：目前是 Vercel 預設網域，`happyhands.tw` 尚未掛上。
- **字型未自架 subset**：目前用 `next/font/google` 載 Noto Sans TC / Noto Serif TC，
  兩個 CJK family 會展開 800+ 條 `@font-face`，約 **70 KB（brotli）的 render-blocking CSS**
  （全站 CSS 合計 79 KB，其中應用程式本身只有 8 KB）。已砍掉未使用的字重 300。
  要再降低就得照 `design_handoff_happyhands/README.md` §8 的建議自架 subset：
  用 `pyftsubset` 依實際用字產生 woff2，再自己寫 `@font-face`。對長輩的慢速網路值得做。

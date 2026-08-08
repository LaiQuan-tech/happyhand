# 快樂手 Happy Healing Hands

好日子股份有限公司（GOOD DAY LOVE INC.）「快樂手」品牌的課程電商網站 —
仁神術（Jin Shin Jyutsu, JSJ）線上課程與實體工作坊。

主要客群是退休樂齡族（60–75 歲），**可及性是硬性需求不是加分項**：
內文最小 17px、按鈕高度 ≥ 56px、每頁都要有打電話出口、支援放大到 200% 不破版。

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

> 資料層（`apps/web/lib/data.ts`）在讀不到 Supabase 時會 fallback 回 `apps/web/lib/content.ts`
> 的靜態資料，所以沒有設環境變數網站也跑得起來，只是不會有即時名額。

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

- **金流**：綠界 ECPay 尚未串接（缺商店代號／HashKey／HashIV）。目前結帳會建立 `pending` 訂單，由人工電話確認。
- **Auth**：Supabase Auth 尚未接上，`/account` 為骨架頁。
- **影片**：Storage 私有 bucket 與簽名 URL 尚未建立。
- **素材**：設計稿中的斜紋色塊都是圖片佔位，等客戶提供照片（清單見 `design_handoff_happyhands/README.md` §8）。
- **網域**：目前是 Vercel 預設網域，`happyhands.tw` 尚未掛上。

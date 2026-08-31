# STACK.md — 技術架構與部署

指定環境：**GitHub（原始碼）→ Vercel（前端）＋ Railway（背景服務）＋ Supabase（DB／Auth／Storage）**

---

## 1. 建議技術選型

| 層 | 選擇 | 理由 |
|---|---|---|
| Framework | **Next.js 15 App Router + TypeScript** | Vercel 一等公民；SSR 對 SEO 與長輩慢速網路友善 |
| 樣式 | **Tailwind CSS v4**，token 寫進 `@theme` | 設計稿是純 inline style，轉成 token 後最好維護 |
| UI | 自建元件（Button / Card / Accordion / Field） | 設計稿有明確視覺，套現成 UI kit 反而要覆寫；**不要用 shadcn 預設灰藍色階** |
| DB / Auth / Storage | **Supabase**（Postgres + Row Level Security + Auth + Storage） | 會員、訂單、影片權限一次到位 |
| 影片 | Supabase Storage 私有 bucket + 簽名 URL（或 Mux／Cloudflare Stream） | 需擋未購買者；簽名 URL 有效期 2 小時 |
| 背景服務 | **Railway** | 見 §4 |
| 金流 | ~~台灣建議綠界 ECPay 或藍新 NewebPay~~ → **實際採用黑貓 PAY**（統一客樂得多元支付平台） | 客群習慣 ATM 匯款。⚠️ 這一列是設計階段的建議，實作時改用黑貓 PAY，見根 README「尚未完成」 |
| 通知 | Email（Resend）＋ LINE Notify／LINE OA | 長輩多用 LINE |

## 2. Repo 結構

```
happyhands/
├── apps/web/                 # Next.js（部署到 Vercel）
│   ├── app/
│   │   ├── (marketing)/page.tsx          # 首頁
│   │   ├── courses/page.tsx
│   │   ├── courses/[slug]/page.tsx
│   │   ├── workshops/page.tsx
│   │   ├── workshops/[slug]/page.tsx
│   │   ├── cart/ checkout/ checkout/success/
│   │   ├── account/(courses|orders|workshops|settings)/
│   │   ├── about/ teachers/ faq/
│   │   └── api/webhooks/payment/route.ts
│   ├── components/ui/        # Button, Card, Pill, Field, Accordion, SeatBadge…
│   ├── lib/supabase/         # server / client / middleware
│   └── styles/theme.css      # README §6 的 token
├── apps/worker/              # Railway：排程與佇列
├── supabase/migrations/      # SQL migration
└── .github/workflows/ci.yml
```

## 3. Supabase 資料模型（起手式）

```sql
-- 使用者延伸資料
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text, phone text, birth_year int,
  line_user_id text, created_at timestamptz default now()
);

-- 商品（線上課 + 工作坊共用）
create type product_type as enum ('course','workshop');
create table products (
  id uuid primary key default gen_random_uuid(),
  type product_type not null,
  slug text unique not null,
  title text not null, subtitle text, description text,
  price int not null,              -- TWD，整數
  compare_at_price int,            -- 原價（劃線）
  cover_url text, is_published boolean default false,
  sort_order int default 0, created_at timestamptz default now()
);

-- 線上課單元
create table course_lessons (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products on delete cascade,
  title text not null, duration_sec int,
  video_path text,                 -- Storage 私有路徑
  free_preview boolean default false, sort_order int
);

-- 工作坊場次
create table workshop_sessions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products on delete cascade,
  starts_at timestamptz not null, ends_at timestamptz not null,
  location text, address text,
  capacity int not null, seats_taken int default 0,
  status text default 'open'       -- open | full | closed | cancelled
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users,
  order_no text unique not null,   -- HH-YYYYMMDD-XXXX
  status text default 'pending',   -- pending | paid | cancelled | refunded
  payment_method text,             -- credit | atm | manual
  total int not null,
  created_at timestamptz default now(), paid_at timestamptz
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders on delete cascade,
  product_id uuid references products,
  session_id uuid references workshop_sessions,  -- 工作坊才有
  unit_price int not null, qty int default 1
);

-- 觀看權限（付款成功後由 webhook 寫入）
create table entitlements (
  user_id uuid references auth.users,
  product_id uuid references products,
  granted_at timestamptz default now(),
  expires_at timestamptz,          -- null = 永久回放
  primary key (user_id, product_id)
);

create table lesson_progress (
  user_id uuid references auth.users,
  lesson_id uuid references course_lessons on delete cascade,
  position_sec int default 0, completed boolean default false,
  updated_at timestamptz default now(),
  primary key (user_id, lesson_id)
);

-- 名額暫扣（15 分鐘）
create table seat_holds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references workshop_sessions on delete cascade,
  user_id uuid references auth.users,
  expires_at timestamptz not null
);
```

**RLS 要點**

- `products` / `workshop_sessions` / `course_lessons`：公開可讀（`is_published = true`），寫入僅 service role。
- `orders` / `order_items` / `entitlements` / `lesson_progress`：`auth.uid() = user_id` 才可讀寫。
- 影片：**不要**把 bucket 設公開。播放時由 server action 先查 `entitlements` 再發 2 小時簽名 URL。
- 付款 webhook 一律用 service role key，且只在 Route Handler（server）使用。

## 4. Railway 負責什麼

Vercel 是 serverless、不適合長時間與排程工作，以下放 Railway（`apps/worker`，Node + BullMQ + Railway Redis）：

1. **名額暫扣回收**：每分鐘清掉過期 `seat_holds` 並還原 `seats_taken`。
2. **工作坊提醒信／LINE**：開課前 3 天、前 1 天推播。
3. **ATM 匯款對帳**：定時比對銀行匯入明細，自動把 `orders.status` 改為 `paid` 並發放 `entitlements`。
4. **影片轉檔／字幕**（若不用 Mux）：上傳後轉 HLS、產生逐字稿。
5. **電子報寄送**（24 節氣陪伴計畫需按節氣排程寄出）。

Railway 與 Vercel 共用同一個 Supabase 專案，用 `SUPABASE_SERVICE_ROLE_KEY` 直連。

## 5. 環境變數

```
# Vercel（前端 + Route Handlers）
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=          # 僅 server 使用，勿加 NEXT_PUBLIC_
NEXT_PUBLIC_SITE_URL=https://happyhands.tw
ECPAY_MERCHANT_ID= ECPAY_HASH_KEY= ECPAY_HASH_IV=
RESEND_API_KEY=
# Railway（worker）
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= REDIS_URL=
LINE_CHANNEL_ACCESS_TOKEN=
```

## 6. 部署流程

1. `main` 推上 GitHub → Vercel 自動部署 production；PR 產生 Preview。
2. Supabase migration 用 `supabase db push`，接到 GitHub Actions（`.github/workflows/ci.yml`）在 merge 後執行。
3. Railway 連同一個 repo，root directory 指到 `apps/worker`，watch path 只設 `apps/worker/**`。
4. 網域：Vercel 掛 `happyhands.tw`；舊站 `happyhands.qdm.tw` 保留一段時間，首頁加轉址提示。

## 7. 交付驗收標準（Definition of Done）

- [ ] 七個頁面桌機 1440px 與手機 390px 皆與 `design/happyhands-B-all-pages.dc.html` 逐像素比對一致（顏色、字級、間距誤差 ≤1px）
- [ ] 背景為純白 #FFFFFF，次級區塊為 #FBF5EC；未使用舊版奶油底色
- [ ] 全站無任何非 token 顏色；不出現 Inter／預設藍色連結
- [ ] Lighthouse Accessibility ≥ 95；所有文字對比 ≥ 4.5:1；點擊區 ≥ 56px
- [ ] 鍵盤可完成「瀏覽課程 → 加入購物車 → 結帳」全流程，focus ring 清楚可見
- [ ] 未購買者無法取得影片 URL（用另一組帳號實測）
- [ ] 工作坊同時報名時不會超賣（併發測試）
- [ ] 手機底部固定行動列不遮擋內容，且在鍵盤開啟時不擋輸入框

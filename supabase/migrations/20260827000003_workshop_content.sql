-- 工作坊報名頁的可上架內容
--
-- 目標：客戶每次開新工作坊時，從後台填內容就有一個完整的報名頁，
-- 不用再另外做一個頁面。參考的是客戶現有的 jsjselfhelp.mygoodday.com.tw。
--
-- 分兩種存法，理由是編輯體驗不同：
--   ・純條列（適合對象、學習成果、課程大綱…）→ products 的 text[] 欄位，
--     後台沿用既有「一行一項 textarea」，最好填
--   ・有結構又會增減的（FAQ、步驟、費用表列、價格方案）→ product_blocks 子表，
--     因為 FAQ 答案動輒兩三百字，text[] 放不下；步驟與費用列是 key-value

-- ---------------------------------------------------------------------------
-- 1. products：固定內容欄位（留空前台就整塊不顯示）
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists hero_lead          text,
  add column if not exists suitable_for       text[] not null default '{}',
  add column if not exists not_suitable_for   text[] not null default '{}',
  add column if not exists outcomes           text[] not null default '{}',
  add column if not exists curriculum_online  text[] not null default '{}',
  add column if not exists curriculum_onsite  text[] not null default '{}',
  add column if not exists includes           text[] not null default '{}',
  add column if not exists notes              text[] not null default '{}',
  add column if not exists asks_intake        boolean not null default false;

comment on column public.products.hero_lead is
  '標題下方的引言，可多段（前台用 whitespace-pre-line 保留換行）。'
  '⚠️ 既有的 description 是塞進單一 <p> 的純文字，後台打的換行會被 HTML 折疊掉。';
comment on column public.products.suitable_for is '「這堂課適合誰」條列。';
comment on column public.products.not_suitable_for is
  '「目前可能不適合」條列。與 suitable_for 併成兩欄對比區塊；兩邊都空就整塊不顯示。';
comment on column public.products.outcomes is '「學完之後可以做到什麼」條列。';
comment on column public.products.curriculum_online is '線上課程內容大綱。';
comment on column public.products.curriculum_onsite is
  '實體課程內容大綱。與 curriculum_online 併成兩欄；只有一邊有內容就顯示一欄。';
comment on column public.products.includes is '「一次報名，全部帶走」的配套清單，前台渲染成標籤雲。';
comment on column public.products.notes is
  '「來之前先知道」注意事項。原本寫死在 workshops/[slug]/page.tsx 的 JSX 字串陣列裡。';
comment on column public.products.asks_intake is
  '結帳時是否要多問報名問題（學習經驗、想改善什麼、從哪得知）並要求勾選健康聲明。';

-- ---------------------------------------------------------------------------
-- 2. workshop_sessions：梯次自己的名稱、摘要與價格
-- ---------------------------------------------------------------------------

alter table public.workshop_sessions
  add column if not exists title    text,
  add column if not exists summary  text,
  add column if not exists format   text,
  add column if not exists price    int,
  add column if not exists notes    text;

alter table public.workshop_sessions
  drop constraint if exists workshop_sessions_price_nonneg;
alter table public.workshop_sessions
  add constraint workshop_sessions_price_nonneg
    check (price is null or price >= 0);

alter table public.workshop_sessions
  drop constraint if exists workshop_sessions_format_valid;
alter table public.workshop_sessions
  add constraint workshop_sessions_format_valid
    check (format is null or format in ('onsite', 'online', 'hybrid'));

comment on column public.workshop_sessions.title is
  '梯次名稱，例如「2026 年 9 月假日班」。留空時前台用日期組一個。';
comment on column public.workshop_sessions.summary is
  '梯次一句話摘要，例如「9/12（六）、9/13（日）／每天 7.5 小時，共 15 小時實體練習」。';
comment on column public.workshop_sessions.format is '上課形式 onsite/online/hybrid。';
comment on column public.workshop_sessions.price is
  '🔴 這一梯的價格。null = 用 products.price。'
  '同一門課的不同梯次價格可以差很多（客戶現有站從 1,200 到 12,800 都有）。'
  '⚠️ 伺服器端重算訂單金額時必須優先讀這一欄 —— 見 apps/web/app/api/orders/route.ts '
  '的 loadPriceBook()。漏掉就是收錯錢。';
comment on column public.workshop_sessions.notes is
  '梯次補充說明，例如「直播連結於開課前發送」。';

-- ---------------------------------------------------------------------------
-- 3. product_blocks：有結構、會增減、需要排序的內容
-- ---------------------------------------------------------------------------

create table if not exists public.product_blocks (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid        not null references public.products(id) on delete cascade,
  kind        text        not null,
  sort_order  int         not null,
  title       text,
  body        text,
  meta        jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint product_blocks_kind_valid
    check (kind in ('faq', 'step', 'info_row', 'pricing', 'feature')),
  constraint product_blocks_sort_nonneg check (sort_order >= 0),
  -- 每種 kind 各自排序。排序更新要用 PARK→FINAL 兩階段（見
  -- apps/web/app/admin/products/lesson-plan.ts）：逐筆改成目標值一定會撞這個約束。
  constraint product_blocks_kind_sort_key unique (product_id, kind, sort_order)
);

create index if not exists idx_product_blocks_product_kind
  on public.product_blocks (product_id, kind, sort_order);

comment on table public.product_blocks is
  '課程／工作坊頁面上「有結構又會增減」的內容區塊。kind 決定前台怎麼渲染。';
comment on column public.product_blocks.kind is
  'faq: title=問題 body=答案／step: title=階段名 body=說明（前台自動編號）／'
  'info_row: title=欄位名 body=內容（費用資訊表的一列）／'
  'pricing: title=方案名 body=說明，meta.amount 金額、meta.note 附註／'
  'feature: title=標題 body=說明（陪伴機制那種三欄卡片）';
comment on column public.product_blocks.meta is
  '各 kind 專屬的額外欄位。刻意用 jsonb 而不是再開一堆稀疏欄位。';

drop trigger if exists trg_product_blocks_updated_at on public.product_blocks;
create trigger trg_product_blocks_updated_at
  before update on public.product_blocks
  for each row execute function public.set_updated_at();

-- RLS：比照 course_lessons —— 只看得到已發布商品的區塊
alter table public.product_blocks enable row level security;

revoke all on public.product_blocks from anon, authenticated;
grant select on public.product_blocks to anon, authenticated;

drop policy if exists product_blocks_select_published on public.product_blocks;
create policy product_blocks_select_published on public.product_blocks
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.products p
      where p.id = product_blocks.product_id
        and p.is_published = true
    )
  );

-- 已購買者看得到未發布商品的內容（比照 20260810000007 的 owns_product 放寬）
drop policy if exists product_blocks_select_owned on public.product_blocks;
create policy product_blocks_select_owned on public.product_blocks
  for select
  to authenticated
  using (public.owns_product(product_id));

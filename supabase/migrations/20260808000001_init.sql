-- =============================================================================
-- 快樂手 HAPPY HEALING HANDS — 初始 schema
-- 來源規格：design_handoff_happyhands/STACK.md §3、apps/web/lib/content.ts、
--            apps/web/lib/data.ts（查詢層欄位需求）
--
-- 設計原則
--   1. 全部物件建在 public schema，PostgREST 才讀得到。
--   2. 所有語句都寫成可重複執行（if not exists / or replace），
--      方便在 shadow DB 或重跑 migration 時不會爆。
--   3. 金額一律 int（新台幣元，不用小數）。
--   4. RLS 與授權集中在下一個 migration（..._rls.sql），本檔只管結構。
-- =============================================================================

-- gen_random_uuid() 在 PG 13+ 已內建於 core；此處只是保險，
-- Supabase 專案本來就把 pgcrypto 裝在 extensions schema。
do $$
begin
  create extension if not exists pgcrypto with schema extensions;
exception when others then
  raise notice '略過 pgcrypto 安裝：%', sqlerrm;
end $$;


-- -----------------------------------------------------------------------------
-- 0. 型別
-- -----------------------------------------------------------------------------

-- STACK.md 原本只寫 course / workshop，但 CONTENT.md 有「24 節氣年度陪伴計畫」
-- 這種訂閱制商品，lib/content.ts 的 ProductType 也是三種，因此 enum 補上 subscription。
do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'product_type' and n.nspname = 'public'
  ) then
    create type public.product_type as enum ('course', 'workshop', 'subscription');
  end if;
end $$;

-- 若這個 DB 之前已經照 STACK.md 建過只有兩個值的 enum，補進第三個值。
-- （同一個 transaction 內剛建立的 enum 不能 add value，所以要吃掉例外。）
do $$
begin
  alter type public.product_type add value if not exists 'subscription';
exception when others then
  raise notice '略過 product_type 補值：%', sqlerrm;
end $$;


-- -----------------------------------------------------------------------------
-- 1. 共用 trigger function
-- -----------------------------------------------------------------------------

-- updated_at 自動維護。刻意自寫而不依賴 moddatetime extension，
-- 免得不同 Supabase 專案的 extensions schema search_path 不一致。
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  '每張表的 before update trigger，統一維護 updated_at。';


-- -----------------------------------------------------------------------------
-- 2. profiles — auth.users 的延伸資料
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  birth_year  int,
  line_user_id text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_birth_year_range
    check (birth_year is null or birth_year between 1900 and 2100)
);

comment on table public.profiles is
  '會員延伸資料。主鍵即 auth.users.id，RLS 用 auth.uid() = id 判斷。';


-- -----------------------------------------------------------------------------
-- 3. products — 線上課 / 工作坊 / 訂閱 共用
-- -----------------------------------------------------------------------------

create table if not exists public.products (
  id               uuid primary key default gen_random_uuid(),
  type             public.product_type not null,
  slug             text not null,
  title            text not null,
  subtitle         text,
  description      text,
  price            int not null,
  compare_at_price int,                      -- 原價（劃線顯示），null = 不顯示
  cover_url        text,
  is_published     boolean not null default false,
  is_featured      boolean not null default false,  -- 首頁主推卡片
  tags             text[] not null default '{}',    -- 例：{線上課程,含課本}
  benefits         text[] not null default '{}',    -- 例：{永久回放,含紙本課本}
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- slug 唯一，同時提供 products(slug) 的 btree 索引（見 §11 索引說明）
  constraint products_slug_key unique (slug),
  constraint products_price_nonneg check (price >= 0),
  constraint products_compare_at_price_sane
    check (compare_at_price is null or compare_at_price >= price)
);

comment on table public.products is
  '商品主檔。type 涵蓋線上課 / 實體工作坊 / 訂閱制；未發布（is_published = false）者 anon 讀不到。';
comment on column public.products.is_featured is
  'lib/data.ts mapProduct() 讀這欄餵給前端的 featured。';
comment on column public.products.tags is
  '前端 Pill 標籤，內容需與 lib/content.ts 的 tags 一致。';
comment on column public.products.compare_at_price is
  '劃線原價，語意上必須 >= price，因此加了 check 防止填反。';


-- -----------------------------------------------------------------------------
-- 4. course_lessons — 線上課單元
-- -----------------------------------------------------------------------------

create table if not exists public.course_lessons (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  title        text not null,
  duration_sec int,
  video_path   text,                        -- Supabase Storage 私有路徑，不是可直接播放的 URL
  free_preview boolean not null default false,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- 同一門課裡 sort_order 唯一：seed 靠這組當 on conflict 目標，
  -- 同時提供 course_lessons(product_id, sort_order) 的複合索引。
  constraint course_lessons_product_sort_key unique (product_id, sort_order),
  constraint course_lessons_duration_nonneg
    check (duration_sec is null or duration_sec >= 0)
);

comment on table public.course_lessons is
  '線上課單元。lib/data.ts 用 products.select("*, course_lessons(*)") 內嵌讀取，並依 sort_order 排序。';
comment on column public.course_lessons.video_path is
  '私有 bucket 內的物件路徑。取得路徑本身不等於可播放，播放一律由 server 查 entitlements 後簽 2 小時 URL。';


-- -----------------------------------------------------------------------------
-- 5. workshop_sessions — 工作坊場次
-- -----------------------------------------------------------------------------

create table if not exists public.workshop_sessions (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  location    text,
  address     text,
  capacity    int not null,
  seats_taken int not null default 0,
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- 同一商品同一開始時間只會有一場：seed 的 on conflict 目標，
  -- 同時提供 workshop_sessions(product_id, starts_at) 的複合索引。
  constraint workshop_sessions_product_starts_key unique (product_id, starts_at),
  constraint workshop_sessions_status_valid
    check (status in ('open', 'full', 'closed', 'cancelled')),
  constraint workshop_sessions_time_valid check (ends_at > starts_at),
  constraint workshop_sessions_capacity_nonneg check (capacity >= 0),
  constraint workshop_sessions_seats_nonneg check (seats_taken >= 0),
  -- 最後一道防超賣：就算應用層寫錯，DB 也不允許 seats_taken 超過 capacity。
  constraint workshop_sessions_not_oversold check (seats_taken <= capacity)
);

comment on table public.workshop_sessions is
  '工作坊場次。注意 product_id 沒有限定 type = workshop：「讀脈入門課」是線上課但另開台北實體班，CONTENT.md 明列此情形。';
comment on column public.workshop_sessions.status is
  'open | full | closed | cancelled。open/full 由 trigger 依 seats_taken 自動維護；closed/cancelled 是人工狀態，trigger 不會覆蓋。';
comment on column public.workshop_sessions.seats_taken is
  '含 15 分鐘暫扣（seat_holds）在內的已佔用名額。只能透過 reserve_seat() / release_expired_seat_holds() 等函式異動。';

-- status 自動維護：seats_taken >= capacity 時為 full，否則 open。
create or replace function public.sync_workshop_session_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- closed / cancelled 是營運人員手動下的決定，不自動改回 open。
  if new.status in ('open', 'full') then
    if new.seats_taken >= new.capacity then
      new.status := 'full';
    else
      new.status := 'open';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.sync_workshop_session_status() is
  '依 seats_taken / capacity 自動維護 workshop_sessions.status 的 open/full 切換。';


-- -----------------------------------------------------------------------------
-- 6. orders / order_items
-- -----------------------------------------------------------------------------

create table if not exists public.orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users (id) on delete set null,
  order_no         text not null,             -- HH-YYYYMMDD-XXXX
  status           text not null default 'pending',
  payment_method   text,                      -- credit | atm | manual
  total            int not null,

  -- 結帳表單欄位（結帳 API 寫入）
  contact_name     text,
  contact_phone    text,
  contact_email    text,
  shipping_address text,                      -- 含紙本課本的商品要寄送
  note             text,

  -- 結帳當下無法用 server 端商品定價核對總額時標記為 true，
  -- 出貨 / 開通前必須人工複核，避免前端傳來的金額被信任。
  price_unverified boolean not null default false,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  paid_at          timestamptz,

  constraint orders_order_no_key unique (order_no),
  constraint orders_status_valid
    check (status in ('pending', 'paid', 'cancelled', 'refunded')),
  constraint orders_payment_method_valid
    check (payment_method is null or payment_method in ('credit', 'atm', 'manual')),
  constraint orders_total_nonneg check (total >= 0),
  -- 只強制「已付款必須有付款時間」。cancelled / refunded 的訂單可能保留 paid_at
  -- （曾經付過再退），所以不做雙向等價檢查。
  constraint orders_paid_at_required_when_paid
    check (status <> 'paid' or paid_at is not null)
);

comment on table public.orders is
  '訂單。user_id 可為 null，用於電話 / LINE 代訂（由客服以 service role 建立）。';
comment on column public.orders.price_unverified is
  '金額未經 server 端定價核對的旗標。true 代表需人工複核後才能開通 entitlements。';
comment on column public.orders.user_id is
  '會員刪除帳號時設為 null 而非連帶刪除訂單，保留帳務紀錄；null 的訂單只有 service role 讀得到。';

create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete restrict,
  session_id uuid references public.workshop_sessions (id) on delete set null,
  unit_price int not null,
  qty        int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint order_items_unit_price_nonneg check (unit_price >= 0),
  constraint order_items_qty_positive check (qty > 0)
);

comment on table public.order_items is
  '訂單明細。session_id 只有工作坊才有值。product_id 用 on delete restrict，避免刪商品把歷史訂單洗掉。';


-- -----------------------------------------------------------------------------
-- 7. entitlements — 觀看權限
-- -----------------------------------------------------------------------------

create table if not exists public.entitlements (
  user_id    uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  order_id   uuid references public.orders (id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz,                    -- null = 永久回放
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

comment on table public.entitlements is
  '觀看權限。只能由付款 webhook / 客服以 service role 寫入；使用者本人僅可讀取（可寫 = 可以免費開通自己）。';
comment on column public.entitlements.order_id is
  '來源訂單，退款時方便反查要撤銷哪一筆權限。';


-- -----------------------------------------------------------------------------
-- 8. lesson_progress — 觀看進度
-- -----------------------------------------------------------------------------

create table if not exists public.lesson_progress (
  user_id      uuid not null references auth.users (id) on delete cascade,
  lesson_id    uuid not null references public.course_lessons (id) on delete cascade,
  position_sec int not null default 0,
  completed    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, lesson_id),
  constraint lesson_progress_position_nonneg check (position_sec >= 0)
);

comment on table public.lesson_progress is
  '影片觀看進度，「我的課程」頁面用。使用者只能讀寫自己的列。';


-- -----------------------------------------------------------------------------
-- 9. seat_holds — 名額暫扣 15 分鐘
-- -----------------------------------------------------------------------------

create table if not exists public.seat_holds (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.workshop_sessions (id) on delete cascade,
  user_id    uuid references auth.users (id) on delete cascade,
  order_id   uuid references public.orders (id) on delete set null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.seat_holds is
  '下單即暫扣 15 分鐘的名額。一律透過 reserve_seat() 建立，不開放直接 insert（直接 insert 會繞過容量檢查）。';


-- -----------------------------------------------------------------------------
-- 10. Triggers
-- -----------------------------------------------------------------------------

-- updated_at
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop trigger if exists trg_course_lessons_updated_at on public.course_lessons;
create trigger trg_course_lessons_updated_at
  before update on public.course_lessons
  for each row execute function public.set_updated_at();

drop trigger if exists trg_workshop_sessions_updated_at on public.workshop_sessions;
create trigger trg_workshop_sessions_updated_at
  before update on public.workshop_sessions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

drop trigger if exists trg_order_items_updated_at on public.order_items;
create trigger trg_order_items_updated_at
  before update on public.order_items
  for each row execute function public.set_updated_at();

drop trigger if exists trg_entitlements_updated_at on public.entitlements;
create trigger trg_entitlements_updated_at
  before update on public.entitlements
  for each row execute function public.set_updated_at();

drop trigger if exists trg_lesson_progress_updated_at on public.lesson_progress;
create trigger trg_lesson_progress_updated_at
  before update on public.lesson_progress
  for each row execute function public.set_updated_at();

drop trigger if exists trg_seat_holds_updated_at on public.seat_holds;
create trigger trg_seat_holds_updated_at
  before update on public.seat_holds
  for each row execute function public.set_updated_at();

-- workshop_sessions.status 自動維護（insert 與 update 都要，seed 進來就會直接算好）
drop trigger if exists trg_workshop_sessions_status on public.workshop_sessions;
create trigger trg_workshop_sessions_status
  before insert or update on public.workshop_sessions
  for each row execute function public.sync_workshop_session_status();


-- -----------------------------------------------------------------------------
-- 11. 索引
--
-- 說明：規格要求的 products(slug)、workshop_sessions(product_id, starts_at)、
-- entitlements(user_id) 這三個索引，已經分別由 unique constraint
-- products_slug_key、workshop_sessions_product_starts_key 以及
-- entitlements 的 primary key (user_id, product_id)（前導欄位就是 user_id）提供。
-- 重複建立同鍵索引只會增加寫入放大與 bloat，不會加快查詢，因此這裡不重複建，
-- 改為補上實際查詢真正需要、而 constraint 沒有覆蓋到的索引。
-- -----------------------------------------------------------------------------

-- 規格指定的複合索引（type + is_published + sort_order）
create index if not exists idx_products_type_published_sort
  on public.products (type, is_published, sort_order);

-- lib/data.ts getProducts()：where is_published order by sort_order（沒有 type 條件），
-- 用 partial index 直接命中，且只索引已發布的列。
create index if not exists idx_products_published_sort
  on public.products (sort_order, id)
  where is_published;

-- lib/data.ts getWorkshopSessions()：status in ('open','full') order by starts_at
create index if not exists idx_workshop_sessions_open_starts_at
  on public.workshop_sessions (starts_at)
  where status in ('open', 'full');

create index if not exists idx_orders_user_created_at
  on public.orders (user_id, created_at desc);

create index if not exists idx_order_items_order_id
  on public.order_items (order_id);

-- FK 反查用（刪除商品 / 場次時避免全表掃描）
create index if not exists idx_order_items_product_id
  on public.order_items (product_id);

create index if not exists idx_order_items_session_id
  on public.order_items (session_id)
  where session_id is not null;

create index if not exists idx_entitlements_product_id
  on public.entitlements (product_id);

create index if not exists idx_entitlements_order_id
  on public.entitlements (order_id)
  where order_id is not null;

-- lesson_progress 主鍵前導欄是 user_id，lesson_id 需要自己的索引供 FK cascade 使用
create index if not exists idx_lesson_progress_lesson_id
  on public.lesson_progress (lesson_id);

-- Railway worker 每分鐘掃過期暫扣
create index if not exists idx_seat_holds_expires_at
  on public.seat_holds (expires_at);

create index if not exists idx_seat_holds_session_id
  on public.seat_holds (session_id);

create index if not exists idx_seat_holds_user_id
  on public.seat_holds (user_id)
  where user_id is not null;

create index if not exists idx_seat_holds_order_id
  on public.seat_holds (order_id)
  where order_id is not null;


-- =============================================================================
-- 12. 名額管理函式（防超賣）
--
-- 鎖定策略（兩個函式必須一致，否則會 deadlock）：
--   永遠先 `select ... for update` 鎖住 workshop_sessions 那一列，
--   再去動同一場次的 seat_holds。
--   reserve_seat() 一次只鎖一場；release_expired_seat_holds() 依 session_id 排序
--   逐場鎖定，兩者取鎖順序相同，不會互相等待。
--
-- 錯誤碼採 PostgREST 的 PTxxx 慣例（最後三碼即 HTTP status）；
-- 若 PostgREST 版本不支援則退化為 500，但訊息仍會原樣回傳。
-- =============================================================================

create or replace function public.reserve_seat(p_session_id uuid, p_user_id uuid)
returns public.seat_holds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   public.workshop_sessions;
  v_hold      public.seat_holds;
  v_reclaimed int;
begin
  -- 不允許替別人保留名額。service role 呼叫時 auth.uid() 為 null，
  -- 所以客服代訂（帶任意 user_id）仍然可行。
  if auth.uid() is not null and p_user_id is distinct from auth.uid() then
    raise exception '不可替其他使用者保留名額' using errcode = 'PT403';
  end if;

  -- (1) 先鎖住場次列。同場次的併發報名到這裡就被序列化了。
  select * into v_session
  from public.workshop_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception '找不到這個場次' using errcode = 'PT404';
  end if;

  -- (2) 鎖到之後才回收這一場的過期暫扣，避免 worker 還沒跑到就誤判額滿。
  --     順序（先鎖 session 再動 seat_holds）與 release_expired_seat_holds() 一致。
  with expired as (
    delete from public.seat_holds
    where session_id = p_session_id
      and expires_at <= now()
    returning 1
  )
  select count(*)::int into v_reclaimed from expired;

  if v_reclaimed > 0 then
    update public.workshop_sessions
    set seats_taken = greatest(seats_taken - v_reclaimed, 0)
    where id = p_session_id
    returning * into v_session;   -- 讓本地變數跟上最新值
  end if;

  -- (3) 狀態與容量檢查
  if v_session.status in ('closed', 'cancelled') then
    raise exception '這個場次已經停止報名' using errcode = 'PT409';
  end if;

  if v_session.seats_taken >= v_session.capacity then
    raise exception '這個場次已經額滿' using errcode = 'PT409';
  end if;

  -- (4) 建立 15 分鐘暫扣並佔用名額
  insert into public.seat_holds (session_id, user_id, expires_at)
  values (p_session_id, p_user_id, now() + interval '15 minutes')
  returning * into v_hold;

  update public.workshop_sessions
  set seats_taken = seats_taken + 1
  where id = p_session_id;
  -- status 由 trg_workshop_sessions_status 自動轉成 full

  return v_hold;
end;
$$;

comment on function public.reserve_seat(uuid, uuid) is
  '工作坊名額暫扣 15 分鐘。以 select ... for update 鎖住場次列序列化併發報名，額滿丟 PT409 例外。';


create or replace function public.release_expired_seat_holds()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_released   int;
  v_total      int := 0;
begin
  -- 依 session_id 排序逐場處理，並維持「先鎖 session 再動 seat_holds」的取鎖順序，
  -- 與 reserve_seat() 一致，避免 deadlock。整個迴圈在同一個 transaction 內完成。
  for v_session_id in
    select distinct session_id
    from public.seat_holds
    where expires_at <= now()
    order by session_id
  loop
    perform 1 from public.workshop_sessions where id = v_session_id for update;

    with expired as (
      delete from public.seat_holds
      where session_id = v_session_id
        and expires_at <= now()
      returning 1
    )
    select count(*)::int into v_released from expired;

    if v_released > 0 then
      update public.workshop_sessions
      set seats_taken = greatest(seats_taken - v_released, 0)
      where id = v_session_id;
      v_total := v_total + v_released;
    end if;
  end loop;

  return v_total;
end;
$$;

comment on function public.release_expired_seat_holds() is
  'Railway worker 每分鐘呼叫：刪除過期 seat_holds 並把 seats_taken 減回去，回傳釋放的名額數。';


-- --- 以下兩個是把名額生命週期補完整的小工具（規格未列，但結帳流程需要）-------
-- 沒有它們的話，寫結帳 API 的人只能自己下 update，很容易把 seats_taken 算錯。

-- 付款成功：暫扣轉為正式佔位。刪掉 hold 但「不」把 seats_taken 減回去。
create or replace function public.commit_seat_hold(p_hold_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  select session_id into v_session_id from public.seat_holds where id = p_hold_id;
  if not found then
    return false;   -- 已經被回收或已 commit，視為 no-op
  end if;

  perform 1 from public.workshop_sessions where id = v_session_id for update;
  delete from public.seat_holds where id = p_hold_id;
  return true;
end;
$$;

comment on function public.commit_seat_hold(uuid) is
  '付款成功後把暫扣轉為正式佔位：刪除 seat_holds 但保留 seats_taken。';

-- 主動取消：刪掉 hold 並把 seats_taken 減回去。
create or replace function public.release_seat_hold(p_hold_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
  v_deleted    int;
begin
  select session_id into v_session_id from public.seat_holds where id = p_hold_id;
  if not found then
    return false;
  end if;

  perform 1 from public.workshop_sessions where id = v_session_id for update;

  delete from public.seat_holds where id = p_hold_id;
  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    update public.workshop_sessions
    set seats_taken = greatest(seats_taken - v_deleted, 0)
    where id = v_session_id;
  end if;

  return v_deleted > 0;
end;
$$;

comment on function public.release_seat_hold(uuid) is
  '使用者放棄結帳時主動釋放暫扣：刪除 seat_holds 並把 seats_taken 減回去。';

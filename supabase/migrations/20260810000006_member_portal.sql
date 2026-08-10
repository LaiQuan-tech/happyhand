-- =============================================================================
-- 學員會員中心：訂單歸戶、課程開通、寄信 outbox、YouTube 影片
-- =============================================================================
--
-- 這支解決的是一個結構性缺口：`orders.user_id` 從來沒有被寫過（全站訪客結帳），
-- 而 `entitlements.user_id` 是 NOT NULL 的主鍵前導欄 —— 也就是說在今天的資料
-- 模型下，「開通線上課程」這件事**物理上做不到**。按下「標記已收款」時，
-- 線上課程什麼都沒發生。
--
-- 補法是三段：
--   1. 下單時就用客人填的 Email 建帳號並綁 user_id（訪客結帳流程不變，不擋單）
--   2. 標記收款時由 grant_entitlements_for_order() 發放權限
--   3. 歷史訂單用 backfill / claim 兩支回填
--
-- 授權模型沿用 20260808000002_rls.sql 的 revoke-all：
-- 這裡新增的表**刻意不寫任何 grant**，預設就是 service-role-only。
-- 新增的函式一律先 `revoke all from public`（Postgres 對函式的預設是 grant
-- EXECUTE 給 PUBLIC，20260810000001 的 alter default privileges 只涵蓋
-- anon/authenticated，涵蓋不到 PUBLIC）。
-- =============================================================================


-- =============================================================================
-- 1. products.access_days —— 訂閱制的觀看期限
-- =============================================================================
--
-- 沒有這一欄的話，type = 'subscription' 的商品只有兩種下場：
-- 跳過不發 entitlement（客人買了年度計畫但「我的學習」是空的），
-- 或用 expires_at = null 發（把年度商品永久送出去）。兩個都不對。

alter table public.products
  add column if not exists access_days int;

alter table public.products
  drop constraint if exists products_access_days_positive;
alter table public.products
  add constraint products_access_days_positive
  check (access_days is null or access_days > 0);

comment on column public.products.access_days is
  '觀看天數。null = 永久回放（線上課的預設）。訂閱制填 365。'
  '開通時換算成 entitlements.expires_at。';


-- =============================================================================
-- 2. course_lessons.youtube_id —— 影片改放 YouTube（非公開）
-- =============================================================================
--
-- ⚠️ 為什麼不沿用既有的 video_path：
--    video_path 的語意是「Supabase Storage 私有 bucket 內的物件路徑」，
--    外洩只是一個沒用的字串（沒有簽名 URL 播不了）。
--    YouTube ID 外洩就是整支影片 —— 任何人 yt-dlp 一行就下載得到。
--    同一個欄位語意，風險等級完全不同，所以分開存、分開 grant。

alter table public.course_lessons
  add column if not exists youtube_id text;

alter table public.course_lessons
  drop constraint if exists course_lessons_youtube_id_format;
alter table public.course_lessons
  add constraint course_lessons_youtube_id_format
  check (youtube_id is null or youtube_id ~ '^[A-Za-z0-9_-]{11}$');

comment on column public.course_lessons.youtube_id is
  'YouTube 影片 ID（11 碼，非公開 unlisted）。'
  '⚠️ 這一欄沒有 grant 給 anon/authenticated，只有 service role 讀得到。'
  '播放一律由 POST /api/lessons/[id]/video 驗證 entitlements 後才回傳。';

comment on column public.course_lessons.video_path is
  '⛔ 已停用。影片改放 YouTube（見 youtube_id），不再使用 Supabase Storage。'
  '保留欄位是為了不破壞 lesson-plan.ts 既有的兩階段搬移邏輯。';

-- --- table 層 grant 換成欄位級 -----------------------------------------------
--
-- 20260808000002_rls.sql:74-79 的註解說「因為 lib/data.ts 用
-- products.select("*, course_lessons(*)") 所以只能 table 層 grant」——
-- 那段註解**已經過期**。lib/data.ts:45,69 現在都是明列欄位：
--   course_lessons(title, duration_sec, free_preview, sort_order)
-- 其餘所有 course_lessons 查詢（admin/products/*）都走 service role。
-- 已逐一核對過，改成欄位級 grant 不會打到任何 anon 路徑。
--
-- 🔴 給後人：這張表現在是**欄位級 grant**。任何新的 anon/authenticated 查詢
--    只要寫成 course_lessons(*) 或用到不在下面白名單裡的欄位，就會整個查詢
--    permission denied（42501）——而且 lib/data.ts 的 catch 會回空陣列，
--    前台看起來像「課程全部下架」而不像錯誤。改這裡之前先讀這段。

revoke select on public.course_lessons from anon, authenticated;

grant select (
  id, product_id, title, duration_sec, free_preview, sort_order,
  created_at, updated_at
) on public.course_lessons to anon, authenticated;


-- =============================================================================
-- 3. 訂單歸戶用的索引
-- =============================================================================
--
-- backfill / claim 兩支都會用 lower(contact_email) 找未歸戶的訂單。
-- 沒有這個 partial index 的話兩支都是全表掃描。

create index if not exists idx_orders_unclaimed_email
  on public.orders (lower(contact_email))
  where user_id is null and contact_email is not null;


-- =============================================================================
-- 4. find_auth_user_id() —— 「這個 Email 有沒有帳號」
-- =============================================================================
--
-- 為什麼需要這支：supabase-js 的 admin API 沒有 getUserByEmail()，
-- 而 app/admin/staff/queries.ts 的 loadUserEmailIndex() 是 O(全站帳號數) ——
-- 不能放在結帳熱路徑上。
--
-- 為什麼不會造成帳號枚舉：
--   1. PostgREST 只開放 public schema，連 service role 都不能直接
--      select auth.users。這支是唯一通道，這就是它存在的理由。
--   2. 只 grant 給 service_role。service role key 只在 Vercel 環境變數裡，
--      不進 client bundle。anon/authenticated 的 JWT 呼叫會拿到 permission denied。
--   3. 唯一呼叫端 /api/orders 不把結果回傳給前端（回應格式維持不變）。

create or replace function public.find_auth_user_id(p_email text)
returns uuid
language sql
security definer
stable
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
    and u.deleted_at is null
  order by u.created_at
  limit 1
$$;

revoke all on function public.find_auth_user_id(text) from public, anon, authenticated;
grant execute on function public.find_auth_user_id(text) to service_role;

comment on function public.find_auth_user_id(text) is
  '用 Email 反查 auth.users.id。service_role only —— 開給任何其他角色就是帳號枚舉。';


-- =============================================================================
-- 5. grant_entitlements_for_order() —— 付款後開通線上課程
-- =============================================================================
--
-- 呼叫點：app/admin/orders/actions.ts 的 transitionOrder()，在條件式 update
-- 拿到那一列之後（那是冪等的唯一勝出點）、writeAudit 之前，且排在 syncSeats()
-- 前面 —— 名額同步失敗只是「數字要人工對」，課程沒開通是「客人付了錢看不到課」。
--
-- 三道拒絕刻意回**結構化理由**而不是丟例外：呼叫端要能分辨並顯示不同的中文，
-- 而且「訂單已經標記收款了，但課沒開通」這件事一定要浮到畫面上，不能靜默。

create or replace function public.grant_entitlements_for_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   public.orders;
  v_granted int := 0;
  v_kept    int := 0;
  v_titles  text[];
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found', 'granted', 0, 'kept', 0);
  end if;

  if v_order.status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'not_paid', 'granted', 0, 'kept', 0);
  end if;

  -- 訪客訂單（下單當下 Admin API 逾時、或這是改版前的歷史訂單）
  if v_order.user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_user', 'granted', 0, 'kept', 0);
  end if;

  -- init.sql 的欄位 comment 明寫「true 代表需人工複核後才能開通 entitlements」。
  -- 語意是「至少一個品項的單價是前端送上來的」—— 金額可能是 0。
  if v_order.price_unverified then
    return jsonb_build_object('ok', false, 'reason', 'price_unverified', 'granted', 0, 'kept', 0);
  end if;

  with wanted as (
    select distinct
      oi.product_id,
      p.title,
      case
        when p.access_days is null then null
        else now() + make_interval(days => p.access_days)
      end as expires_at
    from public.order_items oi
    join public.products p on p.id = oi.product_id
    where oi.order_id = p_order_id
      -- workshop 不發：報名名單本來就從 order_items join orders(status='paid')
      -- 即時算（見 worker 的 workshop-reminders.ts），而且 workshop 沒有
      -- course_lessons，發了也沒東西可看。
      and p.type in ('course', 'subscription')
  ),
  ins as (
    insert into public.entitlements (user_id, product_id, order_id, granted_at, expires_at)
    select v_order.user_id, w.product_id, p_order_id, now(), w.expires_at
    from wanted w
    on conflict (user_id, product_id) do update set
      -- 權限只放寬、不收緊：任一邊是 null（永久）就是 null，
      -- 兩邊都有日期就取較晚的。重跑這支永遠不會讓客人少看到東西。
      expires_at = case
        when public.entitlements.expires_at is null or excluded.expires_at is null then null
        else greatest(public.entitlements.expires_at, excluded.expires_at)
      end,
      -- 同一門課可能來自兩筆訂單。order_id 只是資訊（我們不自動撤銷權限，
      -- 見 revoke_entitlement 的註解），取最早已知來源最不意外。
      order_id   = coalesce(public.entitlements.order_id, excluded.order_id),
      updated_at = now()
    -- xmax = 0 是 PostgreSQL 判斷「這一列是 INSERT 進來的還是 ON CONFLICT
    -- 更新的」的標準寫法，不是筆誤。用它分辨「新開通」與「本來就有」。
    returning (xmax = 0) as inserted
  )
  select
    count(*) filter (where inserted)::int,
    count(*) filter (where not inserted)::int
  into v_granted, v_kept
  from ins;

  select array_agg(w.title order by w.title) into v_titles from wanted w;

  return jsonb_build_object(
    'ok', true,
    'granted', coalesce(v_granted, 0),
    'kept', coalesce(v_kept, 0),
    'products', coalesce(to_jsonb(v_titles), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.grant_entitlements_for_order(uuid) from public, anon, authenticated;
grant execute on function public.grant_entitlements_for_order(uuid) to service_role;

comment on function public.grant_entitlements_for_order(uuid) is
  '把一筆已付款訂單的線上課程開通給訂單的 user_id。冪等（重跑 granted=0、kept=N）。'
  '回 {ok, reason?, granted, kept, products[]}。reason 為 not_found/not_paid/no_user/price_unverified。';


-- =============================================================================
-- 5.5 count_unfulfilled_paid_orders() —— 「已收款但沒開通」的筆數
-- =============================================================================
--
-- 這個數字要放在 /admin 總覽上，因為那是**唯一每天會被看到的地方**。
-- 「客人付了錢但看不到課」如果只寫在 log 裡，就要等客人打 LINE 來問才會發現。
--
-- 判定：已付款 + 有線上課或訂閱制的品項 + 這筆訂單沒有產生過任何 entitlement。
-- 三個成因（user_id 是 null、price_unverified、RPC 當時失敗）都會落在這裡。

create or replace function public.count_unfulfilled_paid_orders()
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::int
  from public.orders o
  where o.status = 'paid'
    and exists (
      select 1
      from public.order_items oi
      join public.products p on p.id = oi.product_id
      where oi.order_id = o.id
        and p.type in ('course', 'subscription')
    )
    and not exists (
      select 1 from public.entitlements e where e.order_id = o.id
    )
$$;

revoke all on function public.count_unfulfilled_paid_orders() from public, anon, authenticated;
grant execute on function public.count_unfulfilled_paid_orders() to service_role;

comment on function public.count_unfulfilled_paid_orders() is
  '已收款、含線上課、卻沒有任何開通紀錄的訂單筆數。給 /admin 總覽的紅色數字用。';


-- =============================================================================
-- 6. revoke_entitlement() —— 人工撤銷單一門課的觀看權限
-- =============================================================================
--
-- ⚠️ 退款**不會**自動撤銷 entitlement，這是刻意的：
--    entitlements 的 PK 是 (user_id, product_id)，權限是跨訂單共用的。
--    客人重複下單、退掉其中一筆，自動撤銷會把**另一筆合法訂單**帶來的權限
--    一起刪掉。這是資料模型層面就決定的，不是靠寫得小心可以避開的。
--    加上退款理由不只一種（買錯、重複、工作坊取消、不滿意），只有最後一種
--    需要收回課程；而對 60–75 歲學員靜默關掉課程是客服災難。
--    所以：退款後由客服逐課按按鈕，每一次都寫 audit_log。

create or replace function public.revoke_entitlement(p_user_id uuid, p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  delete from public.entitlements
  where user_id = p_user_id and product_id = p_product_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.revoke_entitlement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_entitlement(uuid, uuid) to service_role;

comment on function public.revoke_entitlement(uuid, uuid) is
  '撤銷一門課的觀看權限。只由客服人工觸發，退款不會自動呼叫（理由見函式內註解）。';


-- =============================================================================
-- 7. claim_guest_orders() —— 登入當下認領自己的訪客訂單
-- =============================================================================
--
-- 這一支是「用 LINE/Google 登入後看得到之前用同一個信箱下的單」真的成立的
-- 那一段。呼叫點：/auth/callback、/auth/confirm、/account layout。
--
-- 🔴🔴 `email_confirmed_at is not null` 這一行絕對不能拿掉。
--      少了它，任何人註冊一個未驗證的 victim@example.com 就能認領受害者的
--      訂單，看到姓名、電話、地址。這是整份會員中心計畫裡最容易寫錯、
--      後果最嚴重的一行。
--
-- 同理，email 一定要從 auth.users 讀，不可以信 JWT 裡的 claim。

create or replace function public.claim_guest_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_n     int;
begin
  if v_uid is null then
    return 0;
  end if;

  select lower(trim(u.email)) into v_email
  from auth.users u
  where u.id = v_uid
    and u.email_confirmed_at is not null   -- 🔴 見上方警告
    and u.deleted_at is null;

  if v_email is null or v_email = '' then
    return 0;
  end if;

  update public.orders
  set user_id = v_uid, updated_at = now()
  where user_id is null
    and contact_email is not null
    and lower(trim(contact_email)) = v_email;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.claim_guest_orders() from public, anon;
grant execute on function public.claim_guest_orders() to authenticated, service_role;

comment on function public.claim_guest_orders() is
  '把「contact_email 等於自己已驗證信箱」的未歸戶訂單認領過來，回認領筆數。'
  '登入後呼叫。只認 email_confirmed_at 有值的帳號，否則會變成越權讀取他人訂單。';


-- =============================================================================
-- 8. backfill_order_user_ids() —— 批次回填（一次性 + worker 每小時）
-- =============================================================================
--
-- 處理三種情形：改版前就存在的歷史訂單、下單當下 Admin API 逾時、
-- 以及「客人一週後才自己註冊」。同樣只認已驗證的帳號。

create or replace function public.backfill_order_user_ids(p_limit int default 500)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  with candidates as (
    select o.id, u.id as user_id
    from public.orders o
    join auth.users u
      on lower(u.email) = lower(trim(o.contact_email))
    where o.user_id is null
      and o.contact_email is not null
      and u.email_confirmed_at is not null   -- 🔴 同 claim_guest_orders
      and u.deleted_at is null
    limit greatest(1, least(coalesce(p_limit, 500), 5000))
  )
  update public.orders o
  set user_id = c.user_id, updated_at = now()
  from candidates c
  where o.id = c.id;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.backfill_order_user_ids(int) from public, anon, authenticated;
grant execute on function public.backfill_order_user_ids(int) to service_role;

comment on function public.backfill_order_user_ids(int) is
  '批次把未歸戶訂單依 contact_email 綁到已驗證的帳號，回回填筆數。service_role only。';


-- =============================================================================
-- 9. email_outbox —— 交易信的收件匣模式
-- =============================================================================
--
-- 為什麼不直接在 route handler 裡呼叫 Resend：
-- Next.js 的 after() 沒有重試也沒有紀錄。Resend 掛 30 秒就會有一批人永遠
-- 收不到「設定密碼」信，而且任何地方都查不到。對「付了錢拿不到課」這件事
-- 這不可接受。
--
-- 流程：insert ... on conflict do nothing（冪等）→ after() 立刻試寄一次
--       → 失敗則 backoff → worker 每 2 分鐘掃 pending 重試
--
-- ⚠️ 刻意不寫任何 grant —— revoke-all 讓它預設就是 service-role-only。
--    收件人 Email 與信件內文都是個資，authenticated 不該讀得到別人的。

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),

  -- 冪等鍵。例：'order_created:<order_id>'、'account_setup:<user_id>'、
  -- 'order_paid:<order_id>'、'workshop_reminder:<session_id>:<stage>'
  dedupe_key text not null unique,

  to_email   text not null,
  subject    text not null,
  body_text  text not null,
  body_html  text not null,

  status text not null default 'pending'
    constraint email_outbox_status_valid
    check (status in ('pending', 'sent', 'failed', 'skipped')),

  attempts    int not null default 0 constraint email_outbox_attempts_nonneg check (attempts >= 0),
  last_error  text,
  provider_id text,

  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.email_outbox enable row level security;

create index if not exists idx_email_outbox_due
  on public.email_outbox (next_attempt_at)
  where status = 'pending';

create index if not exists idx_email_outbox_to_created
  on public.email_outbox (to_email, created_at desc);

drop trigger if exists trg_email_outbox_updated_at on public.email_outbox;
create trigger trg_email_outbox_updated_at
  before update on public.email_outbox
  for each row execute function public.set_updated_at();

comment on table public.email_outbox is
  '交易信的 outbox。dedupe_key 的 unique 就是冪等保證（連按兩下不會寄兩封）。'
  '沒有 grant = service-role-only。';
comment on column public.email_outbox.dedupe_key is
  '冪等鍵，格式 <用途>:<實體 id>。同一把鑰匙永遠只會有一列，也就只會寄一次。';
comment on column public.email_outbox.provider_id is
  'Resend 回傳的訊息 id。查「這封信到底寄出去了沒」時貼給 Resend 客服用。';


-- =============================================================================
-- 10. handle_new_user() 補 name fallback
-- =============================================================================
--
-- 現有版本只讀 raw_user_meta_data ->> 'full_name'。各種註冊來源給的欄位不同：
--   Email 註冊        什麼都沒有            → null（合理）
--   訪客結帳自動建帳號  full_name（我們自己塞的）→ ✅
--   Google           full_name 和 name      → ✅
--   LINE (custom OIDC) 只有 name           → ❌ 現在會讀到 null
--
-- 只多一個 coalesce，其餘邏輯（staff_invites 一次性消費）完全不動。

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_invite public.staff_invites%rowtype;
begin
  v_email := lower(trim(new.email));

  -- on conflict do nothing：使用者也可能自己先 insert 過（profiles_insert_own）
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),      -- Google / LINE
      nullif(trim(new.raw_user_meta_data ->> 'nickname'), '')
    )
  )
  on conflict (id) do nothing;

  if v_email is null or v_email = '' then
    return new;
  end if;

  -- 一次性消費：select 之後就刪掉，同一封邀請不會被第二個人用掉
  delete from public.staff_invites
  where email = v_email
  returning * into v_invite;

  if found then
    update public.profiles
    set role = v_invite.role
    where id = new.id;
  end if;

  return new;
end;
$$;

-- trigger 本身不用重建（create or replace function 就夠），但為了讓這支
-- migration 單獨重跑也安全，還是宣告一次。
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

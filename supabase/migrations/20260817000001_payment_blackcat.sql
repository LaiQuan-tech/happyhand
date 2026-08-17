-- 黑貓 PAY（統一客樂得多元支付平台）線上刷卡串接
--
-- 只做「線上刷卡」（COCS），收單行統一金流 PAYUNi。代收代付（ibon／ATM）
-- 這次不做 —— 客戶決定，且那條路要另外處理繳款到期日與繳款碼顯示。
--
-- ⚠️ 欄位放哪裡是有意義的安全決定：
--    `orders` 對 authenticated 是 **table 層 grant**（rls.sql:144 `grant select, insert`），
--    所以任何加到 orders 的欄位，學員在 /account 都看得到自己那筆。
--    因此 orders 上只放「本人看到也無妨」的欄位（交易編號、卡號末四碼、付款網址）。
--    APN 的完整原始封包另存 payment_events —— 那張表**不寫任何 grant**，
--    等於 service-role only（比照 email_outbox、staff_invites 的做法）。

-- ---------------------------------------------------------------------------
-- orders：付款狀態欄位
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists payment_provider     text,
  add column if not exists payment_trade_no     text,
  add column if not exists payment_url          text,
  add column if not exists payment_status_code  text,
  add column if not exists payment_paid_amount  int,
  add column if not exists payment_card_no      text,
  add column if not exists payment_auth_code    text,
  add column if not exists payment_notified_at  timestamptz;

comment on column public.orders.payment_provider is
  '金流商代號，目前只有 blackcat（統一客樂得黑貓 PAY）。null = 沒走線上金流（客服手動收款）。';
comment on column public.orders.payment_trade_no is
  'APN 的 trans_id：黑貓 PAY 給每筆刷卡訂單的唯一交易識別碼，客服對帳用。';
comment on column public.orders.payment_url is
  '黑貓 PAY 回傳的線上刷卡網址。客人關掉分頁後可以再點一次付款，所以要存下來。';
comment on column public.orders.payment_status_code is
  'APN 的 status 單一字母：B=授權完成 O=請款作業中 E=請款完成 F=授權失敗 D=訂單逾期 '
  'P=請款失敗 M=取消交易完成 N=取消交易失敗 Q=取消授權完成 R=取消授權失敗。';
comment on column public.orders.payment_paid_amount is
  '實際授權金額（APN payment_detail.pay_amount）。**這才是判斷收到多少錢的依據**，'
  '不可以用 APN 的 amount —— 那是繳款單金額，而且 checksum 算的是它，'
  '所以 checksum 通過不代表金額正確（規格 P35 注意事項 2 紅字明寫要用實收金額比對）。';
comment on column public.orders.payment_card_no is '信用卡號前六後四碼，客服對帳用。';

alter table public.orders
  drop constraint if exists orders_payment_provider_valid;
alter table public.orders
  add constraint orders_payment_provider_valid
    check (payment_provider is null or payment_provider in ('blackcat'));

-- 收到 APN 時要用 trans_id 反查訂單
create index if not exists idx_orders_payment_trade_no
  on public.orders (payment_trade_no)
  where payment_trade_no is not null;

-- ---------------------------------------------------------------------------
-- payment_events：APN 通知的完整紀錄（service-role only）
-- ---------------------------------------------------------------------------

create table if not exists public.payment_events (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references public.orders(id) on delete set null,
  provider     text        not null default 'blackcat',
  trans_id     text        not null,
  order_no     text,
  status_code  text        not null,
  amount       int,
  pay_amount   int,
  nonce        text,
  raw          jsonb       not null,
  -- 處理結果，方便事後查「為什麼這筆沒開通」
  outcome      text        not null,
  note         text,
  created_at   timestamptz not null default now()
);

-- 冪等的執行點。規格 P87：APN 每 15 分鐘重送、同一個狀態碼最多送 3 次。
-- 不能把 nonce 放進 unique —— 每次重送的 nonce 都不一樣，那樣就擋不住重複。
-- 用 (provider, trans_id, status_code) 才是「同一筆交易的同一個狀態只處理一次」。
create unique index if not exists payment_events_dedupe
  on public.payment_events (provider, trans_id, status_code);

create index if not exists idx_payment_events_order
  on public.payment_events (order_id, created_at desc);

comment on table public.payment_events is
  '黑貓 PAY APN 主動通知的完整紀錄。**刻意不寫任何 grant = service-role only**，'
  '因為 raw 裡有卡號與授權碼。學員要看的付款狀態放在 orders 的 payment_* 欄位。';
comment on column public.payment_events.outcome is
  'applied=有更新訂單／duplicate=同狀態重送已忽略／amount_mismatch=實收與應收不符（沒開通）／'
  'order_not_found=找不到訂單／ignored=狀態碼不需處理。';

-- 這張表刻意不 grant 給 anon/authenticated。
-- rls.sql 的基底已經 revoke all，這裡不補 grant 就是 service-role only。
alter table public.payment_events enable row level security;

-- ---------------------------------------------------------------------------
-- 後台總覽：付款異常的筆數（給 /admin 顯示紅字用）
-- ---------------------------------------------------------------------------

create or replace function public.count_payment_alerts()
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::int
  from public.payment_events
  where outcome in ('amount_mismatch', 'order_not_found')
    and created_at > now() - interval '30 days'
$$;

revoke all on function public.count_payment_alerts() from public, anon, authenticated;
grant execute on function public.count_payment_alerts() to service_role;

comment on function public.count_payment_alerts() is
  '近 30 天實收金額不符或找不到訂單的 APN 筆數。這兩種都代表有人付了錢卻沒拿到東西，'
  '必須有人看到 —— 顯示在 /admin 總覽。';

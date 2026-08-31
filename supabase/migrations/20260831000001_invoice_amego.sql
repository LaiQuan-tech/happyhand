-- ---------------------------------------------------------------------------
-- 電子發票（Amego）
--
-- 台灣的公司賣東西給消費者是法定要開電子發票的，這個站到目前為止完全沒有做 ——
-- 沒有欄位、沒有表、沒有 API。這支把整條線補起來。
--
-- 🔴 這張表的設計核心只有一句話：**發票開出去撤不回來**。
--    財政部那邊多一張就是多一張，只能再開一張作廢單去沖銷，而客人的信箱裡已經
--    躺著兩份稅務憑證。所以不能沿用 email_outbox 那種「先送再記」的樂觀模式 ——
--    寄信重複只是尷尬，開票重複是稅務事故。
--
--    改成 claim-then-act：
--      1. claim_invoice_issue()  原子地宣告「這張由我開」（status → 'issuing'）
--      2. 呼叫 Amego             只有拿到 claim 的人可以做這一步
--      3. finish / fail          一定要走到其中一個
--
--    這個順序讓「已送出但還沒記錄」在資料庫裡**看得見**（status='issuing'）。
--    少了它，從 Amego 回應到 UPDATE 落地之間行程被殺，這一列還是 pending，
--    下一次重試就開出第二張真發票 —— 而且沒有任何痕跡看得出來。
--
-- 冪等有兩道獨立的保險，互為 fallback（缺一不可）：
--   主動  開票前先用 invoice_query 反查 Amego，查得到號碼就認回、不重開
--   被動  c0401 回 3040171（OrderId 重複）→ 回頭查一次再認回
--   兩道都成立的前提是 OrderId = orders.order_no（init.sql:246 是 unique），
--   也就是把 Amego 那邊的唯一性約束借來當我們的冪等鍵。
--
-- ## 套用順序：**先 DB，後程式碼**
--    本檔全部是加欄位／建表／建函式，向後相容：舊版程式碼（不認識這些東西）
--    套用後行為完全不變。反過來先部署程式碼，claim RPC 會回 PGRST202
--    （function not found），開票全數停擺。
-- ---------------------------------------------------------------------------

-- ── 1. orders：客人自己填的發票資料，以及開完之後給他看的號碼 ───────────────
--
-- 為什麼放在 orders 而不是另開一張表：orders 對 authenticated 是 **table 層
-- grant**（rls.sql:144 grant select, insert），所以放這裡學員在 /account 就
-- 看得到自己那筆。這幾個欄位本來就是「他自己填的」與「他的發票號碼」，
-- 本人看到完全沒問題 —— 比照 20260817000001_payment_blackcat.sql:6-11 的判準。
--
-- 開票的機器（重試次數、錯誤訊息、送出去的原始封包）另存 public.invoices，
-- 那張表不寫任何 grant = service-role only。

alter table public.orders
  add column if not exists invoice_carrier_type text,
  add column if not exists invoice_carrier_id   text,
  add column if not exists invoice_tax_id       text,
  add column if not exists invoice_title        text,
  add column if not exists invoice_number       text,
  add column if not exists invoice_random_code  text,
  add column if not exists invoice_issued_at    timestamptz;

alter table public.orders drop constraint if exists orders_invoice_carrier_type_check;
alter table public.orders add constraint orders_invoice_carrier_type_check
  check (
    invoice_carrier_type is null
    or invoice_carrier_type in ('cloud', 'phone', 'natural_person', 'love_code', 'b2b')
  );

-- 統編一律 8 碼數字。檢查碼的驗證在 TS 端做（lib/invoice/validate.ts），
-- 這裡只擋格式 —— DB 端算檢查碼會讓 constraint 難讀又難改。
alter table public.orders drop constraint if exists orders_invoice_tax_id_check;
alter table public.orders add constraint orders_invoice_tax_id_check
  check (invoice_tax_id is null or invoice_tax_id ~ '^[0-9]{8}$');

comment on column public.orders.invoice_carrier_type is
  'cloud=雲端發票（預設）/ phone=手機條碼 / natural_person=自然人憑證 / love_code=捐贈 / b2b=公司統編。'
  ' 客人在結帳時選的。null 視同 cloud。';
comment on column public.orders.invoice_carrier_id is
  '載具號碼或愛心碼。carrier_type=phone 時是 /XXXXXXX（斜線開頭共 8 碼），'
  ' natural_person 是 2 大寫英文+14 數字，love_code 是 3~7 碼數字。b2b 與 cloud 留空。';
comment on column public.orders.invoice_tax_id is
  '買方統一編號，只有 carrier_type=b2b 才有值。有值就是三聯式，稅額要另外拆出來。';
comment on column public.orders.invoice_title is '買方抬頭（公司名），只有 b2b 用得到。';
comment on column public.orders.invoice_number is
  '⚠️ 這是 public.invoices 開立成功後回寫的**顯示用副本**，唯一真相在 invoices。'
  ' 放這裡是為了讓學員在 /account 看得到自己的發票號碼（invoices 是 service-role only）。'
  ' 只有 finish_invoice_issue() 會寫它，不要在別的地方 update。';
comment on column public.orders.invoice_random_code is '發票隨機碼四碼，對獎用。同樣是副本。';
comment on column public.orders.invoice_issued_at is '開立成功的時間。同樣是副本。';

-- ── 2. invoices：開票的機器 ─────────────────────────────────────────────────

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders(id) on delete cascade,

  -- Amego 端的唯一鍵。等於 orders.order_no，冪等的地基。
  amego_order_id  text not null,

  status          text not null default 'pending',

  -- 開立成功後的結果
  invoice_number  text,
  random_code     text,
  issued_at       timestamptz,

  -- 送出去的內容（存起來才對得出「當初開的是什麼」）
  buyer_tax_id    text,
  buyer_name      text,
  carrier_type    text,
  carrier_id      text,
  total_amount    int not null check (total_amount >= 0),

  -- 作廢
  voided_at       timestamptz,
  void_reason     text,

  -- 重試機器
  -- 🔴 issue_attempts 由 claim 遞增、**永不歸零**，這是它跟 retry_count 分開的
  --    唯一理由：retry_count 成功時會被重設為 0，用它反推「以前是否送出過」，
  --    等於在最需要反查的那一次（前一次剛好開成功、我們沒記到）選擇不反查。
  issue_attempts  int not null default 0 check (issue_attempts >= 0),
  retry_count     int not null default 0 check (retry_count >= 0),
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  last_error      text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint invoices_amego_order_id_key unique (amego_order_id),
  constraint invoices_status_check check (status in ('pending', 'issuing', 'issued', 'voided'))
);

-- 刻意**不**加 'failed' 狀態：失敗的列一律退回 'pending'，這樣後台的「待開立」
-- 篩選與重試邏輯只要看一個值。失敗的痕跡留在 last_error / retry_count；
-- retry_count 到上限之後 claim 會拒發，等於停在 pending 讓人來處理。
comment on table public.invoices is
  '電子發票（Amego）。一張訂單一列，unique 在 amego_order_id（= orders.order_no）。'
  ' 🔴 開票流程一律 claim_invoice_issue() → 打 Amego → finish/fail，不可以直接 update status。';

comment on column public.invoices.amego_order_id is
  '送給 Amego 的 OrderId，等於 orders.order_no。'
  ' 🔴 必須是對外訂單編號不是內部 uuid —— 它會顯示在 Amego 後台的「訂單編號」，'
  ' 而且是我們反查認回的唯一依據。';
comment on column public.invoices.status is
  'pending=待開立 / issuing=已宣告開立中（可能已送到 Amego）/ issued=已開立 / voided=已作廢。'
  ' 🔴 issuing 不代表失敗，代表「不確定 Amego 那邊有沒有收到」，必須反查才知道。';
comment on column public.invoices.issue_attempts is
  '送出嘗試次數，claim 時遞增，**永不歸零**。> 1 就代表以前送出過，開票前必須先反查 Amego。';
comment on column public.invoices.retry_count is
  '失敗重試次數，成功時歸零。到上限後 claim 會拒發，等人處理。'
  ' ⚠️ 不可以拿它判斷「以前是否送出過」，那是 issue_attempts 的工作。';
comment on column public.invoices.total_amount is
  '開票金額。取 orders.payment_paid_amount ?? orders.total —— 刷卡走 APN 的有實收金額'
  ' 且已驗證與應收相等；ATM／人工那兩種沒有實收欄位，只能用 total。';

create index if not exists idx_invoices_due
  on public.invoices (next_attempt_at)
  where status = 'pending';

create index if not exists idx_invoices_stale
  on public.invoices (claimed_at)
  where status = 'issuing';

create index if not exists idx_invoices_order
  on public.invoices (order_id);

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

alter table public.invoices enable row level security;

-- 🔴 刻意不寫任何 grant = service-role only（比照 payment_events、email_outbox）。
--    這裡有錯誤訊息與重試機器，學員看不到也不需要看到；他要的發票號碼已經
--    回寫到 orders 上了。
revoke all on public.invoices from anon, authenticated;

-- ── 3. claim：唯一可以把一列推進 'issuing' 的入口 ───────────────────────────

create or replace function public.claim_invoice_issue(
  p_order_id    uuid,
  p_max_retries int default 8,
  p_stale_after interval default '10 minutes'
)
returns table (
  ok             boolean,
  reason         text,
  invoice_id     uuid,
  amego_order_id text,
  issue_attempts int,
  total_amount   int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invoices%rowtype;
begin
  -- 閘門 1：用訂單列本身當序列化點。
  -- invoices 雖然有 amego_order_id 的 unique，但「同一張訂單被兩個 request
  -- 同時 claim」要擋的是併發不是重複列；鎖訂單列讓兩個 request 排隊。
  -- ⚠️ 刻意**不**在這裡檢查 orders.status = 'paid'：訂單列在這裡只當鎖用。
  --    要不要開票是呼叫端的判斷，這裡多一個條件只會讓卡住的發票更難補開。
  perform 1 from public.orders where id = p_order_id for update;

  select * into v_inv
    from public.invoices
   where order_id = p_order_id
   for update;

  if not found then
    return query select false, 'no_invoice_row'::text, null::uuid, null::text, null::int, null::int;
    return;
  end if;

  if v_inv.status = 'issued' then
    return query select false, 'already_issued'::text, v_inv.id, v_inv.amego_order_id,
                        v_inv.issue_attempts, v_inv.total_amount;
    return;
  end if;

  if v_inv.status = 'voided' then
    return query select false, 'already_voided'::text, v_inv.id, v_inv.amego_order_id,
                        v_inv.issue_attempts, v_inv.total_amount;
    return;
  end if;

  -- 閘門 2：已經有人拿著 claim。只有超過 stale 窗才接手 ——
  -- 接手的人會因為 issue_attempts > 1 而先反查，所以不會重開。
  if v_inv.status = 'issuing'
     and v_inv.claimed_at is not null
     and v_inv.claimed_at > now() - p_stale_after then
    return query select false, 'in_flight'::text, v_inv.id, v_inv.amego_order_id,
                        v_inv.issue_attempts, v_inv.total_amount;
    return;
  end if;

  if v_inv.retry_count >= p_max_retries then
    return query select false, 'retries_exhausted'::text, v_inv.id, v_inv.amego_order_id,
                        v_inv.issue_attempts, v_inv.total_amount;
    return;
  end if;

  if v_inv.next_attempt_at > now() then
    return query select false, 'not_due'::text, v_inv.id, v_inv.amego_order_id,
                        v_inv.issue_attempts, v_inv.total_amount;
    return;
  end if;

  update public.invoices
     set status         = 'issuing',
         claimed_at     = now(),
         issue_attempts = v_inv.issue_attempts + 1
   where id = v_inv.id;

  return query select true, 'claimed'::text, v_inv.id, v_inv.amego_order_id,
                      v_inv.issue_attempts + 1, v_inv.total_amount;
end;
$$;

comment on function public.claim_invoice_issue(uuid, int, interval) is
  '原子地宣告「這張發票由我開」。回 ok=true 才可以呼叫 Amego。'
  ' 🔴 呼叫端拿到 ok=true 之後**一定**要走到 finish_invoice_issue 或 fail_invoice_issue，'
  ' 否則這一列會卡在 issuing 直到 stale 窗過期。'
  ' issue_attempts > 1 代表以前送出過，呼叫端必須先反查 Amego 再決定要不要開。';

-- ── 4. finish：把結果落地，並回寫給客人看的副本 ─────────────────────────────

create or replace function public.finish_invoice_issue(
  p_invoice_id     uuid,
  p_invoice_number text,
  p_random_code    text,
  p_issued_at      timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order_id uuid;
  v_existing text;
begin
  select order_id, invoice_number into v_order_id, v_existing
    from public.invoices where id = p_invoice_id for update;

  if not found then
    return false;
  end if;

  -- 🔴 這裡是「一張訂單開出兩張發票」的絆線。
  --    同一列已經有一個**不同的**發票號碼，代表真的多開了一張稅務憑證。
  --    那不是可以 log 一行帶過的事 —— 直接 raise，讓呼叫端的錯誤路徑吵起來。
  if v_existing is not null and v_existing <> p_invoice_number then
    raise exception 'DOUBLE_ISSUE: invoice % already has number % but got %',
      p_invoice_id, v_existing, p_invoice_number;
  end if;

  update public.invoices
     set status         = 'issued',
         invoice_number = p_invoice_number,
         random_code    = p_random_code,
         issued_at      = p_issued_at,
         retry_count    = 0,
         last_error     = null,
         claimed_at     = null
   where id = p_invoice_id;

  -- 顯示用副本，讓學員在 /account 看得到
  update public.orders
     set invoice_number      = p_invoice_number,
         invoice_random_code = p_random_code,
         invoice_issued_at   = p_issued_at
   where id = v_order_id;

  return true;
end;
$$;

comment on function public.finish_invoice_issue(uuid, text, text, timestamptz) is
  '開立成功後落地，同時把號碼回寫到 orders 給客人看。'
  ' 同一列被寫入不同的發票號碼會直接 raise DOUBLE_ISSUE —— 那代表真的多開了一張。';

-- ── 5. fail：退回 pending 等重試 ─────────────────────────────────────────────

create or replace function public.fail_invoice_issue(
  p_invoice_id uuid,
  p_error      text,
  p_permanent  boolean default false,
  p_max_retries int default 8
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_retry int;
  v_backoff_minutes int;
begin
  select retry_count into v_retry
    from public.invoices where id = p_invoice_id for update;

  if not found then
    return false;
  end if;

  v_retry := v_retry + 1;

  -- p_permanent = 統編格式錯、金額算錯這種「重試一萬次還是同一個答案」的，
  -- 直接把 retry_count 推到上限，之後 claim 一律回 retries_exhausted 等人改資料。
  if p_permanent then
    v_retry := p_max_retries;
  end if;

  -- 指數退避，上限 6 小時（跟 email_outbox 同一套）
  v_backoff_minutes := least(360, power(2, least(v_retry, 8))::int);

  update public.invoices
     set status          = 'pending',
         retry_count     = v_retry,
         last_error      = left(coalesce(p_error, ''), 500),
         next_attempt_at = now() + make_interval(mins => v_backoff_minutes),
         claimed_at      = null
   where id = p_invoice_id
     -- 🔴 絕不碰已經開出去的列。發票已經在客人手上了，任何「還原成 pending」
     --    都是在邀請系統再開一張。
     and status <> 'issued'
     and status <> 'voided';

  return true;
end;
$$;

comment on function public.fail_invoice_issue(uuid, text, boolean, int) is
  '開立失敗，退回 pending 等重試（指數退避上限 6 小時）。'
  ' p_permanent=true 直接推到重試上限，用於「重試也不會變」的錯誤（統編格式錯之類）。'
  ' 🔴 status=issued/voided 的列不會被動到。';

-- ── 6. reclaim：把卡在 issuing 的列撿回來 ───────────────────────────────────

create or replace function public.reclaim_stale_invoices(
  p_stale_after interval default '10 minutes'
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.invoices
     set status     = 'pending',
         claimed_at = null,
         last_error = coalesce(last_error, '') || ' [reclaimed from issuing]'
   where status = 'issuing'
     and claimed_at is not null
     and claimed_at < now() - p_stale_after;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.reclaim_stale_invoices(interval) is
  '把卡在 issuing 超過 stale 窗的列撥回 pending。'
  ' claim 本身就會接手過期的 issuing，所以這支不是正確性必需品，是**可見性**必需品 ——'
  ' 讓後台的「待開立」清單看得到它們。撥回來的列 issue_attempts 仍 > 1，'
  ' 下次開票前一定會先反查，不會重開。';

-- ── 7. 後台告警計數 ─────────────────────────────────────────────────────────

create or replace function public.count_invoice_alerts()
returns table (
  pending_overdue int,  -- 付款超過 30 分鐘還沒開出來的
  stuck_issuing   int,  -- 卡在 issuing 的（不確定 Amego 收到沒）
  exhausted       int   -- 重試用完的
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    (select count(*)::int from public.invoices i
       join public.orders o on o.id = i.order_id
      where i.status = 'pending'
        and o.paid_at is not null
        and o.paid_at < now() - interval '30 minutes'),
    (select count(*)::int from public.invoices
      where status = 'issuing'
        and claimed_at < now() - interval '10 minutes'),
    (select count(*)::int from public.invoices
      where status = 'pending' and retry_count >= 8);
$$;

comment on function public.count_invoice_alerts() is
  '後台總覽的發票異常計數。'
  ' ⚠️ 這支一定要真的被畫面呼叫 —— payment 那邊的 count_payment_alerts() 寫好了'
  ' 卻沒有任何一處呼叫，等於「客人付了錢沒拿到東西」沒有人看得到。不要重蹈覆轍。';

revoke all on function public.claim_invoice_issue(uuid, int, interval) from public, anon, authenticated;
revoke all on function public.finish_invoice_issue(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_invoice_issue(uuid, text, boolean, int) from public, anon, authenticated;
revoke all on function public.reclaim_stale_invoices(interval) from public, anon, authenticated;
revoke all on function public.count_invoice_alerts() from public, anon, authenticated;

grant execute on function public.claim_invoice_issue(uuid, int, interval) to service_role;
grant execute on function public.finish_invoice_issue(uuid, text, text, timestamptz) to service_role;
grant execute on function public.fail_invoice_issue(uuid, text, boolean, int) to service_role;
grant execute on function public.reclaim_stale_invoices(interval) to service_role;
grant execute on function public.count_invoice_alerts() to service_role;

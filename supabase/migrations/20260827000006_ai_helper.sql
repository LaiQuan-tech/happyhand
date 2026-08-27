-- AI 小幫手：對話記錄、聯絡資訊萃取、用量上限。
--
-- 這張表存的是**未登入訪客**在官網右下角小幫手裡打的字，可能含姓名、
-- Email、電話、LINE ID，也可能含身體狀況（「我膝蓋開過刀可以學嗎」）。
-- 那是健康資訊。所以：
--   * 完全不給 anon 與 authenticated —— 連 grant 都不發，只有 service role 進得來。
--   * 讀取一律經過 /admin 的 requireCapability 守衛，不走 RLS 放行。
-- 這跟 orders 不同：orders 要讓學員在 /account 看自己的單，所以有 table 層 grant。

create table if not exists public.ai_chat_logs (
  id uuid primary key default gen_random_uuid(),

  -- 一段對話一列。session_id 由前端產生（crypto.randomUUID）存在 sessionStorage，
  -- 關掉分頁就換一段新的。unique 讓每一輪回覆都能 upsert 回同一列。
  session_id text not null unique,

  -- 完整逐字稿 [{role:'user'|'model', text}]
  messages jsonb not null default '[]'::jsonb,
  message_count int not null default 0,
  first_question text,
  last_reply text,

  user_ip text,
  user_agent text,

  -- AI 從對話中萃取的聯絡資訊與需求（訪客自己講的才算，不推測）
  contact_name text,
  contact_phone text,
  contact_email text,
  contact_line text,
  summary text,
  intent text,

  -- 🔴 generated 而不是由程式維護：給樂那套是應用層自己寫 has_contact，
  --    只要有一條寫入路徑忘記更新，後台的「待跟進」清單就會漏人。
  --    交給資料庫算就不可能漂移。
  has_contact boolean generated always as (
    contact_name is not null
    or contact_phone is not null
    or contact_email is not null
    or contact_line is not null
  ) stored,

  -- 後台跟進狀態
  handled_at timestamptz,
  handled_by uuid references auth.users(id) on delete set null,
  handled_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.ai_chat_logs is
  'AI 小幫手對話記錄。含訪客個資與可能的健康資訊，只有 service role 讀得到。';

-- 後台預設看「有留聯絡資訊、還沒處理」的，這個索引撐那一頁
create index if not exists ai_chat_logs_followup_idx
  on public.ai_chat_logs (created_at desc)
  where has_contact and handled_at is null;

create index if not exists ai_chat_logs_created_idx
  on public.ai_chat_logs (created_at desc);

alter table public.ai_chat_logs enable row level security;
revoke all on public.ai_chat_logs from anon, authenticated;
-- 刻意不建任何 policy：service role 繞過 RLS，其他人一律進不來。

/* ------------------------------------------------------------------ 用量上限 */

-- 沒有上限的話，一支腳本就能把 Gemini 的額度打光（帳單是客戶的），
-- 而且對話內容會被灌進上面那張表。每天重置，不必另外清理。
create table if not exists public.ai_rate_limits (
  bucket text not null,
  day date not null default (now() at time zone 'utc')::date,
  hits int not null default 0,
  primary key (bucket, day)
);

alter table public.ai_rate_limits enable row level security;
revoke all on public.ai_rate_limits from anon, authenticated;

/**
 * 記一次用量並回報「還可不可以用」。
 *
 * 🔴 用 insert ... on conflict do update 的原子加總，不是先 select 再 update：
 *    同一個 IP 同時開兩個分頁狂送，read-then-write 會兩邊都讀到 39、
 *    兩邊都寫 40，上限直接被繞過。
 *
 * 回 true = 這次放行。
 */
create or replace function public.ai_rate_check(p_bucket text, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits int;
begin
  insert into public.ai_rate_limits (bucket, day, hits)
  values (p_bucket, (now() at time zone 'utc')::date, 1)
  on conflict (bucket, day)
  do update set hits = public.ai_rate_limits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.ai_rate_check(text, int) from public, anon, authenticated;
grant execute on function public.ai_rate_check(text, int) to service_role;

/**
 * 後台「待跟進」數字。比照既有的 count_unfulfilled_paid_orders()。
 */
create or replace function public.count_pending_inquiries()
returns int
language sql
security definer
stable
set search_path = ''
as $$
  select count(*)::int
    from public.ai_chat_logs
   where has_contact and handled_at is null
$$;

revoke all on function public.count_pending_inquiries() from public, anon, authenticated;
grant execute on function public.count_pending_inquiries() to service_role;

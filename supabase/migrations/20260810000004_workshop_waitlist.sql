-- =============================================================================
-- 快樂手 — 工作坊候補名單
--
-- 這是「客服接完電話登記」用的，不是使用者自助排隊。
-- 前台額滿時的 CTA 就是 tel:0228335820（app/workshops/_components/session-row.tsx），
-- 客群 60–75 歲，打電話比填表單可靠。
--
-- 刻意不寫任何 grant → service-role-only。
-- =============================================================================

create table if not exists public.workshop_waitlist (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.workshop_sessions(id) on delete cascade,
  name        text not null,
  phone       text not null,
  email       text,
  note        text,
  -- waiting   還在等
  -- offered   已通知有位子，等對方回覆
  -- converted 已轉成正式報名（訂單另外建）
  -- cancelled 對方不要了 / 場次取消
  status      text not null default 'waiting',
  -- 哪位員工登記的
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint workshop_waitlist_status_valid
    check (status in ('waiting', 'offered', 'converted', 'cancelled'))
);

alter table public.workshop_waitlist enable row level security;

-- 後台主要查詢：某一場的待處理候補，先登記的排前面
create index if not exists idx_waitlist_session
  on public.workshop_waitlist (session_id, status, created_at);

-- 沿用既有的 updated_at trigger（20260808000001_init.sql:58）
drop trigger if exists set_updated_at_workshop_waitlist on public.workshop_waitlist;
create trigger set_updated_at_workshop_waitlist
  before update on public.workshop_waitlist
  for each row execute function public.set_updated_at();

comment on table public.workshop_waitlist is
  '工作坊候補名單，由客服在 /admin/sessions 手動登記。只有 service role 進得去。';

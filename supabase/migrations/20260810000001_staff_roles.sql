-- =============================================================================
-- 快樂手 — 員工角色、邀請制與註冊時自動建檔
--
-- 這支 migration 做四件事，順序不可調換：
--   1. profiles 加 role 欄位
--   2. 把 role 從 authenticated 可寫的欄位裡拿掉（提權修補）
--   3. staff_invites：owner 邀請員工的一次性名單
--   4. handle_new_user()：註冊時建 profile，命中邀請就套用角色
--
-- ⚠️ 第 2 步必須跟第 1 步在同一支 migration。
--    分成兩支的話，中間那段時間線上就是可提權的狀態。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. role 欄位
-- -----------------------------------------------------------------------------

alter table public.profiles
  add column if not exists role text not null default 'customer';

-- 四個角色的意義（能力表的唯一真相在 apps/web/lib/admin/roles.ts，
-- 這裡只負責保證資料庫裡不會出現拼錯的值）：
--   customer 一般會員，進不了 /admin
--   support  客服：訂單、收款、名單、候補
--   editor   內容編輯：課程與工作坊，看不到訂單
--   owner    負責人：全部 + 員工管理 + 稽核
alter table public.profiles
  drop constraint if exists profiles_role_valid;
alter table public.profiles
  add constraint profiles_role_valid
  check (role in ('customer', 'support', 'editor', 'owner'));

-- 員工是極少數，用 partial index 讓 /admin/staff 的列表不用全表掃描。
create index if not exists idx_profiles_staff
  on public.profiles (role)
  where role <> 'customer';

comment on column public.profiles.role is
  '員工角色。只能由 service role 寫入（見本檔第 2 節的欄位級 grant）。';


-- -----------------------------------------------------------------------------
-- 2. 提權修補：把 role 從 authenticated 可寫的欄位裡拿掉
--
-- 原本 20260808000002_rls.sql:119 是 table 層的
--   grant select, insert, update on public.profiles to authenticated;
-- 而 profiles_update_own / profiles_insert_own 兩個 policy 都只檢查
--   auth.uid() = id，沒有任何欄位限制。
--
-- 也就是說加了 role 欄位之後會有「兩條」提權路徑：
--   (a) update public.profiles set role = 'owner' where id = auth.uid();
--   (b) insert 自己的 profile 時直接帶 role = 'owner';
--
-- policy 改不了這件事（policy 管的是「哪些列」，不是「哪些欄」）。
-- 正解是欄位級 GRANT —— 這也符合這份 schema 既有的哲學：
-- 「沒有 GRANT 的話，policy 寫得再好也進不來」。
-- -----------------------------------------------------------------------------

revoke insert, update on public.profiles from authenticated;

-- insert 需要 id：profiles_insert_own 的 with check 是 auth.uid() = id，
-- 使用者必須寫得進 id 才建得了自己的 profile。
-- role 不在清單裡 → 只能吃 default 'customer'。
grant insert (id, full_name, phone, birth_year, line_user_id)
  on public.profiles to authenticated;

grant update (full_name, phone, birth_year, line_user_id)
  on public.profiles to authenticated;

-- select 維持 table 層：前台要讀自己的 role 來決定要不要顯示「後台」入口，
-- 而 profiles_select_own 已經限制只看得到自己那一列。


-- -----------------------------------------------------------------------------
-- 3. staff_invites — owner 邀請員工的一次性名單
--
-- 刻意不寫任何 grant：20260808000002_rls.sql 的 revoke all + alter default
-- privileges 讓新表預設就是 service-role-only，正好是這裡要的。
-- enable RLS 但不建 policy，是為了萬一日後有人補了 grant 也不會整表外洩。
-- -----------------------------------------------------------------------------

create table if not exists public.staff_invites (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  role        text not null,
  invited_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint staff_invites_role_valid
    check (role in ('support', 'editor', 'owner')),
  -- ⚠️ 這條 check 是必要的，不是潔癖。
  --    handle_new_user() 是拿 lower(trim(註冊者 email)) 去比對這裡的「原始值」，
  --    所以只要有人存進 'Staff@Example.com '，那封邀請就永遠不會被命中，
  --    而且不會有任何錯誤 —— 是一筆看得到卻永遠不生效的死邀請。
  --    寧可讓寫錯的 insert 當場報錯。
  --    順帶讓上面的 unique (email) 真的有意義：否則同一個人可以同時存在
  --    'Staff@Example.com' 與 'staff@example.com' 兩筆互相衝突的邀請。
  constraint staff_invites_email_normalized
    check (email = lower(trim(email)))
);

alter table public.staff_invites enable row level security;

comment on table public.staff_invites is
  '員工邀請名單。email 必須是 lower(trim()) 正規化後的值（由 check constraint 強制），'
  '被 handle_new_user() 消費一次後即刪除。只有 service role 進得去。';


-- -----------------------------------------------------------------------------
-- 4. handle_new_user() — 註冊時建 profile，命中邀請就套用角色
--
-- 為什麼要 trigger 而不是在應用層做：
--   註冊成功與建 profile 之間若有網路中斷，使用者會變成「有帳號沒 profile」，
--   之後每一頁都要處理這個半殘狀態。trigger 讓它在同一個 transaction 內完成。
--
-- security definer + 寫死 search_path：這支會以函式擁有者的權限執行，
-- 不鎖 search_path 的話有被 search_path 劫持的風險。
-- -----------------------------------------------------------------------------

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
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''))
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 既有的 20260808000002_rls.sql:35-36 只 revoke 了 tables 與 sequences 的
-- default privileges，漏掉 functions。所以 rls.sql 之後新建的函式會自動繼承
-- Supabase 原廠給 anon/authenticated 的 EXECUTE。
-- handle_new_user() 是 trigger 函式（直呼會被 PostgreSQL 擋下）所以目前不可利用，
-- 但這個缺口會影響日後每一支新函式，在這裡一併補起來。
alter default privileges in schema public
  revoke all on functions from anon, authenticated;

revoke all on function public.handle_new_user()
  from public, anon, authenticated;

comment on function public.handle_new_user() is
  '註冊時自動建 profile；email 命中 staff_invites 就套用該角色並刪除邀請。';


-- -----------------------------------------------------------------------------
-- 5. 第一位 owner
--
-- 刻意「不」寫在 migration 裡 —— email 是 PII，不該進版控。
-- 部署後在 Supabase Dashboard 的 SQL editor 執行一次：
--
--   insert into public.staff_invites (email, role)
--   values (lower(trim('負責人的信箱')), 'owner');
--
-- 然後該信箱到 /login 註冊，完成後即為 owner。
-- 之後所有員工都由 owner 在 /admin/staff 邀請，不需要再下 SQL。
-- -----------------------------------------------------------------------------

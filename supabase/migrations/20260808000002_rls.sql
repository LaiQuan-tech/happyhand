-- =============================================================================
-- 快樂手 — Row Level Security 與授權
-- 規格：design_handoff_happyhands/STACK.md §3「RLS 要點」
--
-- 授權模型（兩層，缺一不可）
--   第一層 GRANT：先 revoke all，再逐表 grant 最小必要權限。
--                 沒有 GRANT 的話，policy 寫得再好也進不來。
--   第二層 POLICY：每一張表都 enable row level security，
--                 包含「完全不開放給 anon/authenticated」的表也要開，
--                 漏開 RLS = 只要有 GRANT 就整表外洩。
--
-- 沒有 policy 的表 = 只有 service role（bypassrls）進得去，這是刻意的。
--
-- 注意：這裡刻意「不」使用 `force row level security`。
--       service_role 靠 bypassrls 屬性繞過 RLS，force 影響不到它；
--       但 force 會連 table owner（跑 migration / seed 的 postgres）都擋住，
--       會直接讓下一個 seed migration 失敗。
--
-- 效能小抄：policy 內的 auth.uid() 一律寫成 (select auth.uid())，
--          讓 planner 當成 InitPlan 只算一次，而不是每一列都呼叫。
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. 先收回所有預設權限
-- -----------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 之後新增的物件也不要自動 grant。
-- ⚠️ 提醒後續開發者：新建表之後若出現 "permission denied for table xxx"，
--    就是這行造成的，正確做法是在該表的 migration 裡明確寫 grant，而不是把這行拿掉。
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- PostgREST 仍需要 schema usage
grant usage on schema public to anon, authenticated;


-- -----------------------------------------------------------------------------
-- 1. 每一張表都開 RLS（包含沒有 policy 的）
-- -----------------------------------------------------------------------------

alter table public.profiles          enable row level security;
alter table public.products          enable row level security;
alter table public.course_lessons    enable row level security;
alter table public.workshop_sessions enable row level security;
alter table public.orders            enable row level security;
alter table public.order_items       enable row level security;
alter table public.entitlements      enable row level security;
alter table public.lesson_progress   enable row level security;
alter table public.seat_holds        enable row level security;


-- =============================================================================
-- 2. 公開目錄：products / course_lessons / workshop_sessions
--    anon 與 authenticated 都只能 select，且只看得到已發布的商品。
--    任何寫入都不開放（service role 專用）。
-- =============================================================================

-- --- products ---------------------------------------------------------------
grant select on public.products to anon, authenticated;

drop policy if exists "products_select_published" on public.products;
create policy "products_select_published"
  on public.products
  for select
  to anon, authenticated
  using (is_published = true);

-- --- course_lessons ----------------------------------------------------------
-- ⚠️ 這裡是 table 層 grant 而不是 column 層 grant，因為 lib/data.ts 用的是
--    products.select("*, course_lessons(*)")，PostgREST 會把 * 展開成全部欄位，
--    只要有一欄沒 grant 就整個查詢 permission denied。
--    代價是 video_path 會被未購買者讀到（只是私有 bucket 內的路徑字串，
--    沒有簽名 URL 無法播放）。若日後要徹底遮蔽，建議把 video_path 搬到
--    另一張不開放 anon 的 lesson_assets 表，前端查詢不需改動。
grant select on public.course_lessons to anon, authenticated;

drop policy if exists "course_lessons_select_published_product" on public.course_lessons;
create policy "course_lessons_select_published_product"
  on public.course_lessons
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = course_lessons.product_id
        and p.is_published = true
    )
  );

-- --- workshop_sessions -------------------------------------------------------
grant select on public.workshop_sessions to anon, authenticated;

drop policy if exists "workshop_sessions_select_published_product" on public.workshop_sessions;
create policy "workshop_sessions_select_published_product"
  on public.workshop_sessions
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.products p
      where p.id = workshop_sessions.product_id
        and p.is_published = true
    )
  );


-- =============================================================================
-- 3. 個人資料：auth.uid() = user_id 才可讀寫
-- =============================================================================

-- --- profiles（主鍵就是 user id）---------------------------------------------
grant select, insert, update on public.profiles to authenticated;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- 不開放 delete：刪帳號走 auth.users 的 cascade（service role）。


-- --- orders ------------------------------------------------------------------
-- ⚠️ 刻意「不」開放 update / delete。
--    orders.status 若使用者可改，任何人都能把自己的訂單改成 paid。
--    狀態流轉（pending → paid / cancelled / refunded）與 paid_at、total
--    一律只能由付款 webhook 或客服以 service role 寫入。
grant select, insert on public.orders to authenticated;

drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
  on public.orders for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "orders_insert_own_pending" on public.orders;
create policy "orders_insert_own_pending"
  on public.orders for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and status = 'pending'
    and paid_at is null
  );

-- --- order_items（透過 orders 關聯判斷擁有者）--------------------------------
grant select, insert on public.order_items to authenticated;

drop policy if exists "order_items_select_own_order" on public.order_items;
create policy "order_items_select_own_order"
  on public.order_items for select to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.user_id = (select auth.uid())
    )
  );

drop policy if exists "order_items_insert_own_pending_order" on public.order_items;
create policy "order_items_insert_own_pending_order"
  on public.order_items for insert to authenticated
  with check (
    exists (
      select 1
      from public.orders o
      where o.id = order_items.order_id
        and o.user_id = (select auth.uid())
        and o.status = 'pending'
    )
  );

-- --- entitlements ------------------------------------------------------------
-- ⚠️ 只給 select。可寫 = 使用者可以自己開通任何課程，等於全站付費內容免費。
--    發放一律由付款 webhook（service role）處理。
grant select on public.entitlements to authenticated;

drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own"
  on public.entitlements for select to authenticated
  using ((select auth.uid()) = user_id);

-- --- lesson_progress ---------------------------------------------------------
grant select, insert, update on public.lesson_progress to authenticated;

drop policy if exists "lesson_progress_select_own" on public.lesson_progress;
create policy "lesson_progress_select_own"
  on public.lesson_progress for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "lesson_progress_insert_own" on public.lesson_progress;
create policy "lesson_progress_insert_own"
  on public.lesson_progress for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "lesson_progress_update_own" on public.lesson_progress;
create policy "lesson_progress_update_own"
  on public.lesson_progress for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- --- seat_holds --------------------------------------------------------------
-- ⚠️ 只給 select。直接 insert 會繞過 reserve_seat() 的容量檢查造成超賣，
--    所以建立暫扣一律走 reserve_seat() RPC（security definer）。
grant select on public.seat_holds to authenticated;

drop policy if exists "seat_holds_select_own" on public.seat_holds;
create policy "seat_holds_select_own"
  on public.seat_holds for select to authenticated
  using ((select auth.uid()) = user_id);


-- =============================================================================
-- 4. 函式執行權限
--    注意：function 的 EXECUTE 預設會 grant 給 PUBLIC，
--    只 revoke anon/authenticated 是不夠的，必須連 public 一起收回。
-- =============================================================================

revoke all on function public.reserve_seat(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_seat(uuid, uuid) to authenticated, service_role;

revoke all on function public.release_expired_seat_holds() from public, anon, authenticated;
grant execute on function public.release_expired_seat_holds() to service_role;

revoke all on function public.commit_seat_hold(uuid) from public, anon, authenticated;
grant execute on function public.commit_seat_hold(uuid) to service_role;

revoke all on function public.release_seat_hold(uuid) from public, anon, authenticated;
grant execute on function public.release_seat_hold(uuid) to authenticated, service_role;

-- trigger function 不會被使用者直接呼叫（直接呼叫只會得到
-- "trigger functions can only be called as triggers"），trigger 執行時
-- 也不檢查 EXECUTE 權限，所以維持上面的 revoke all 即可。
revoke all on function public.set_updated_at() from public;
revoke all on function public.sync_workshop_session_status() from public;


-- =============================================================================
-- 5. 影片 Storage
--
-- ⚠️ 影片 bucket 一定要是 private（public = false）。
--    設成 public 等於把付費內容永久公開，而且 CDN 會快取，事後補救很麻煩。
--
-- 正確播放流程（STACK.md §3）：
--   1. 使用者點播放 → 打 server action / route handler（不是 client 直接要 URL）
--   2. server 用 service role 查 entitlements：
--        select 1 from entitlements
--        where user_id = <登入者> and product_id = <該課程>
--          and (expires_at is null or expires_at > now())
--      查不到就回 403，且不可以把 video_path 回傳給前端
--   3. 有權限才 createSignedUrl(video_path, 60 * 60 * 2)  ← 2 小時
--   4. free_preview = true 的單元可以不查 entitlements 直接簽，但仍然要走 server
--
-- 這裡刻意不新增任何 storage.objects 的 policy：
-- 沒有 policy 就只有 service role 讀得到 → 正好符合「一律由 server 簽 URL」。
-- =============================================================================

do $$
begin
  insert into storage.buckets (id, name, public)
  values ('course-videos', 'course-videos', false)
  on conflict (id) do update set public = false;
exception when others then
  raise notice '略過 storage bucket 建立（權限不足或 storage schema 不存在）：%', sqlerrm;
end $$;

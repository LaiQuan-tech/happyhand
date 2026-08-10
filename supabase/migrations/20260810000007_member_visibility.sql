-- =============================================================================
-- 學員對「自己買過的東西」的可見性
-- =============================================================================
--
-- 🔴 這支修的是一個會靜默吃掉客人課程的問題。
--
-- 既有的三條 policy 都綁在 products.is_published = true：
--   products_select_published
--   course_lessons_select_published_product
--   workshop_sessions_select_published_product
--
-- 對公開目錄來說完全正確——下架的課本來就不該出現在 /courses。
-- 但會員中心用的是同一組 policy，於是：
--
--   客人買了《仁神術入門》→ 公司改版把它下架 →
--   客人的「我的學習」少一門課、訂單明細顯示「找不到課程」
--
-- 而且完全不會報錯，客人只會覺得「我買的課不見了」。
-- 這種下架在課程改版時很常見，不是罕見情境。
--
-- 修法：加上 OR 條件的 policy（policy 之間是 OR，所以只會放寬不會收緊）——
-- 「我有這門課的觀看權限」或「我買過它」就看得到，不管上下架。
--
-- 用 security definer 函式而不是直接把 exists 寫進 policy：
-- policy 的 USING 運算式裡引用其他表時，那些表的 RLS 也會套用，
-- 於是變成 products policy → orders policy → order_items policy 三層巢狀。
-- 不會遞迴，但很難推理、也很難查效能。包成函式讓它只做一件事。
-- =============================================================================


-- --- 我擁有這個商品嗎 --------------------------------------------------------
--
-- 「擁有」有兩種：已開通觀看權限（entitlements），或買過（order_items）。
-- 後者刻意不限定 status = 'paid'：待付款的訂單也要看得到自己買了什麼，
-- 否則訂單列表會出現一筆沒有品名的訂單。
--
-- ⚠️ 這支沒有 user 參數，一律用 auth.uid()——所以它只能回答
--    「**我**擁有嗎」，不能拿來窺探別人擁有什麼。這是安全設計的一部分，
--    要加參數之前先想清楚。

create or replace function public.owns_product(p_product_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select
    exists (
      select 1
      from public.entitlements e
      where e.product_id = p_product_id
        and e.user_id = (select auth.uid())
    )
    or exists (
      select 1
      from public.order_items oi
      join public.orders o on o.id = oi.order_id
      where oi.product_id = p_product_id
        and o.user_id = (select auth.uid())
    )
$$;

revoke all on function public.owns_product(uuid) from public, anon;
grant execute on function public.owns_product(uuid) to authenticated, service_role;

comment on function public.owns_product(uuid) is
  '呼叫者是否擁有這個商品（有 entitlement 或買過）。'
  '刻意沒有 user 參數：只能問「我」，不能問別人。';


-- --- 我報名了這一場嗎 --------------------------------------------------------

create or replace function public.registered_for_session(p_session_id uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where oi.session_id = p_session_id
      and o.user_id = (select auth.uid())
  )
$$;

revoke all on function public.registered_for_session(uuid) from public, anon;
grant execute on function public.registered_for_session(uuid) to authenticated, service_role;

comment on function public.registered_for_session(uuid) is
  '呼叫者是否報名過這一場工作坊。同 owns_product，只能問「我」。';


-- --- 三條放寬用的 policy -----------------------------------------------------
--
-- policy 之間是 OR。既有的 *_select_published 一條都不動，
-- 這裡只是多開一扇門給「已經付過錢的人」。

drop policy if exists "products_select_owned" on public.products;
create policy "products_select_owned"
  on public.products
  for select
  to authenticated
  using (public.owns_product(id));

drop policy if exists "course_lessons_select_owned_product" on public.course_lessons;
create policy "course_lessons_select_owned_product"
  on public.course_lessons
  for select
  to authenticated
  using (public.owns_product(product_id));

drop policy if exists "workshop_sessions_select_registered" on public.workshop_sessions;
create policy "workshop_sessions_select_registered"
  on public.workshop_sessions
  for select
  to authenticated
  using (
    public.registered_for_session(id)
    or public.owns_product(product_id)
  );


-- --- 效能 --------------------------------------------------------------------
--
-- owns_product() 的第二個 exists 會用 order_items.product_id 找，再 join orders。
-- idx_order_items_product_id 已經有了（init.sql），orders 那邊走主鍵。
-- entitlements 的 PK 前導欄是 user_id，這裡是用 product_id 找，
-- 走 idx_entitlements_product_id（也已經有了）再比對 user_id。
-- 6 個商品的站不需要再加索引，這段留給日後商品數變多時參考。

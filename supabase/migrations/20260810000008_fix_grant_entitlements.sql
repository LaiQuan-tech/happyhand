-- =============================================================================
-- 修正 grant_entitlements_for_order()：CTE 跨語句不存在
-- =============================================================================
--
-- 20260810000006 的版本長這樣：
--
--   with wanted as (...), ins as (insert ... returning ...)
--   select count(...) into v_granted, v_kept from ins;
--
--   select array_agg(w.title) into v_titles from wanted w;   -- 🔴 這裡就爆了
--
-- CTE 的生存範圍是**單一 SQL 語句**。在 PL/pgSQL 裡上面是兩個獨立語句，
-- 所以第二句跑的時候 `wanted` 早就不存在了，直接丟
-- `42P01 relation "wanted" does not exist`。
--
-- 後果不是「少了商品名稱」而是整支函式失敗 →
-- transitionOrder() 會收到 error → 客服看到「開通線上課程時發生錯誤」→
-- 訂單標成已收款但課沒開通。實測抓到的，不是理論問題。
--
-- 修法：把三個值放進同一個語句一次取出，ins 與 wanted 在那個語句裡都還活著。
-- 其餘邏輯（三道拒絕、on conflict 只放寬不收緊、xmax = 0 判斷新舊）完全不動。
-- =============================================================================

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

  -- 🔴 三個值必須在同一個語句裡取出：CTE 活不過語句邊界。
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
      -- 即時算，而且 workshop 沒有 course_lessons，發了也沒東西可看。
      and p.type in ('course', 'subscription')
  ),
  ins as (
    insert into public.entitlements (user_id, product_id, order_id, granted_at, expires_at)
    select v_order.user_id, w.product_id, p_order_id, now(), w.expires_at
    from wanted w
    on conflict (user_id, product_id) do update set
      -- 權限只放寬、不收緊：任一邊是 null（永久）就是 null，
      -- 兩邊都有日期就取較晚的。重跑永遠不會讓客人少看到東西。
      expires_at = case
        when public.entitlements.expires_at is null or excluded.expires_at is null then null
        else greatest(public.entitlements.expires_at, excluded.expires_at)
      end,
      -- 同一門課可能來自兩筆訂單。order_id 只是資訊（我們不自動撤銷權限），
      -- 取最早已知來源最不意外。
      order_id   = coalesce(public.entitlements.order_id, excluded.order_id),
      updated_at = now()
    -- xmax = 0 是 PostgreSQL 判斷「這一列是 INSERT 進來的還是 ON CONFLICT
    -- 更新的」的標準寫法，不是筆誤。用它分辨「新開通」與「本來就有」。
    returning (xmax = 0) as inserted, product_id
  )
  select
    count(*) filter (where i.inserted)::int,
    count(*) filter (where not i.inserted)::int,
    array_agg(w.title order by w.title)
  into v_granted, v_kept, v_titles
  from ins i
  join wanted w on w.product_id = i.product_id;

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

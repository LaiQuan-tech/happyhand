-- 列出「已收款但沒開通」的訂單，給每日 cron 補救用。
--
-- 為什麼需要這一支：cron 原本是抓 status='paid' 的訂單 limit 50 逐筆重跑
-- grant_entitlements_for_order。grant 本身是冪等的所以不會出錯，但抓到的
-- 永遠是同樣的前 50 筆（早就開通過的），訂單一旦累積超過 50 筆，真正漏開通
-- 的那筆就永遠輪不到 —— 補救機制本身會靜默失效。
--
-- 條件與 count_unfulfilled_paid_orders() 完全一致，只是回傳清單而不是數量。
-- 兩支要一起改，否則 /admin 顯示的數字會跟 cron 實際處理的對不起來。
create or replace function public.list_unfulfilled_paid_orders(p_limit int default 50)
returns table (id uuid, order_no text)
language sql
security definer
stable
set search_path = ''
as $$
  select o.id, o.order_no
  from public.orders o
  where o.status = 'paid'
    and o.price_unverified = false
    and o.user_id is not null
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
  order by o.paid_at nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 500))
$$;

revoke all on function public.list_unfulfilled_paid_orders(int) from public, anon, authenticated;
grant execute on function public.list_unfulfilled_paid_orders(int) to service_role;

comment on function public.list_unfulfilled_paid_orders(int) is
  '已收款、金額已核、已綁帳號，但還沒開通任何 entitlement 的訂單。'
  '條件與 count_unfulfilled_paid_orders() 一致，改一支要改兩支。';

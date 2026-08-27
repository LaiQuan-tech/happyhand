-- 未付款訂單的佔位時效
--
-- 問題：checkSessionCapacity（api/orders）把**所有** status='pending' 的
-- order_items 都算成佔位，但沒有任何機制讓它過期 ——
-- init.sql 設計的 seat_holds 表與 release_expired_seat_holds() 從來沒被
-- apps/web 寫入過（grep 零命中），所以那條回收路徑實際上是空的。
-- 結果是：客人下單不付款，那個位子就**永遠**被佔著。
--
-- 而且前台顯示走的是另一段算式（session-row.tsx: capacity - seats_taken），
-- 完全沒扣掉 pending，所以會出現「頁面說剩 4 位、結帳卻說滿了」。
--
-- 這支 migration 把「佔位」變成單一定義，前台顯示與下單檢查都改讀它。

-- 佔位有效時間。刷卡通常幾分鐘內完成；放寬到 30 分鐘容納「離開再回來付」。
-- 代價是有極小機率超賣（客人第 31 分鐘才付款成功，位子已被別人拿走）——
-- 工作坊超賣一兩個位子可以現場加椅子，但「名額被永久佔住」會讓真正想報名
-- 的人一直被擋在門外，那個更糟。
create or replace function public.seat_hold_window()
returns interval
language sql
immutable
as $$ select interval '30 minutes' $$;

comment on function public.seat_hold_window() is
  '未付款訂單佔住工作坊名額的有效時間。改這裡就同時改到前台顯示與下單檢查。';

-- 每個場次目前被「有效的未付款訂單」佔住幾個位子。
-- security definer：前台是 anon client，讀不到 orders/order_items。
-- 只回傳場次 id 與數量，沒有任何個資，所以可以開給 anon。
create or replace function public.workshop_holds()
returns table (session_id uuid, held int)
language sql
security definer
stable
set search_path = ''
as $$
  select oi.session_id, sum(oi.qty)::int as held
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where o.status = 'pending'
    and oi.session_id is not null
    and o.created_at > now() - public.seat_hold_window()
  group by oi.session_id
$$;

revoke all on function public.workshop_holds() from public;
grant execute on function public.workshop_holds() to anon, authenticated, service_role;

comment on function public.workshop_holds() is
  '各場次被有效未付款訂單佔住的名額數。前台顯示剩餘名額與 /api/orders 的容量檢查'
  '都要用這一支，否則兩邊算式會再度分岔。';

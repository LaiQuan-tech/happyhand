-- =============================================================================
-- 快樂手 — 後台調整場次已報名人數
--
-- 為什麼要 RPC 而不是讓 server action 直接 update：
--   (1) seats_taken = seats_taken + 1 從 JS 端做要先 read 再 write，
--       兩個客服同時標記兩筆訂單付款就會少算一個。
--   (2) workshop_sessions 上有 check (seats_taken <= capacity)，
--       直接 update 撞到會丟 23514，server action 只能拿到一句英文錯誤。
--       在函式裡先 clamp 就能回傳「已經滿了」這種人話。
--
-- 取鎖順序刻意與 reserve_seat() 一致：先鎖 workshop_sessions 那一列，
-- 再動別的。順序一致才不會跟報名流程互等。
--
-- 只 grant execute 給 service_role —— 這支能無視名額上限往下扣，
-- 不是給前台用的。
-- =============================================================================

create or replace function public.admin_adjust_seats(
  p_session_id uuid,
  p_delta      int
)
returns public.workshop_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.workshop_sessions;
  v_target  int;
begin
  -- (1) 先鎖住場次列
  select * into v_session
  from public.workshop_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception '找不到這個場次' using errcode = 'PT404';
  end if;

  -- (2) clamp 到 [0, capacity]，不讓 check constraint 有機會丟 23514。
  --     超出範圍不當成錯誤：客服手動微調時給個合理上下界比報錯好用。
  v_target := least(greatest(v_session.seats_taken + p_delta, 0), v_session.capacity);

  if v_target = v_session.seats_taken then
    return v_session;
  end if;

  update public.workshop_sessions
  set seats_taken = v_target
  where id = p_session_id
  returning * into v_session;

  -- status 由 sync_workshop_session_status() trigger 自動維護
  -- （20260808000001_init.sql:197），這裡不用手動改。

  return v_session;
end;
$$;

revoke all on function public.admin_adjust_seats(uuid, int) from public, anon, authenticated;
grant execute on function public.admin_adjust_seats(uuid, int) to service_role;

comment on function public.admin_adjust_seats(uuid, int) is
  '後台調整場次已報名人數，clamp 到 [0, capacity]。只有 service role 可執行。';

-- =============================================================================
-- 快樂手 — 後台操作稽核紀錄
--
-- 為什麼要有：多位員工 + 分權限 + 會碰訂單金額與付款狀態。
-- 沒有稽核就無法回答「誰把這筆 3,600 的訂單標成已收款」。
--
-- ⚠️ 刻意「不」用 DB trigger 做稽核。
--    後台一律以 service role 寫入，trigger 裡的 auth.uid() 是 null，
--    記出來的會是「有人改了某一列」而不是「王小明把 HH-… 標成已收款」，
--    對客服糾紛毫無用處。
--    改為應用層在每支 server action 成功後顯式呼叫 writeAudit()
--    （apps/web/lib/admin/audit.ts），由它帶入操作者身分。
--    代價：漏寫 writeAudit() 就沒紀錄，靠 code review 擋。
--
-- 刻意不寫任何 grant：revoke all + alter default privileges 讓新表
-- 預設就是 service-role-only，正好是這裡要的。
-- =============================================================================

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  -- 冗餘存一份 email：帳號被刪之後仍然查得到是誰做的。
  actor_email text,
  actor_role  text,
  -- 動詞，例如 'order.mark_paid'、'product.publish'、'staff.invite'
  action      text not null,
  -- 受影響的實體種類與主鍵，例如 ('order', '<uuid>')
  entity      text not null,
  entity_id   text,
  -- 給人看的一句話，例如「把 HH-20260810-ABCD 標記為已收款」
  summary     text not null,
  -- 給機器看的前後值，只存有變動的欄位
  diff        jsonb,
  created_at  timestamptz not null default now()
);

alter table public.audit_log enable row level security;

-- 稽核頁預設是「最近的在最上面」
create index if not exists idx_audit_log_created
  on public.audit_log (created_at desc);

-- 「這筆訂單被動過哪些手腳」
create index if not exists idx_audit_log_entity
  on public.audit_log (entity, entity_id, created_at desc);

comment on table public.audit_log is
  '後台寫入操作的稽核紀錄。由 apps/web/lib/admin/audit.ts 的 writeAudit() 寫入，'
  '只有 service role 進得去。';

-- =============================================================================
-- 快樂手 — notification_log：通知寄送記錄（提醒信去重）
--
-- 為什麼需要這張表
--   apps/worker 的 workshop-reminders 原本把「哪個場次的哪個階段已經寄過」
--   記在 process 記憶體裡。Railway 每次 deploy、crash 重啟、平台搬遷 instance
--   都會清空 → 同一批客人收到第二封一模一樣的提醒信；也因為兩個副本各有一份
--   記憶體，worker 不能開超過一個 replica。寫進 DB 之後這兩件事都不再成立。
--
-- 怎麼用（apps/worker/src/lib/db.ts 的 claimNotification()）
--   寄信「之前」先 insert 一列：
--     insert 成功            → 這一輪由我負責寄
--     撞到 unique violation  → 別人（或重啟前的自己）已經寄過 → 跳過
--   互斥完全靠 unique constraint，單一 statement 就結束，
--   不需要交易、advisory lock 或 Redis。
--
-- 授權：service role 專用。
--   這張表只有 worker 會寫、只有查問題時人工會讀，不開放 anon / authenticated。
--   內容也刻意不含任何客人資料（沒有 email、姓名、訂單），只有場次 id 與時間。
--
-- 前置：..._init.sql（workshop_sessions）、..._rls.sql（授權基線）
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. 表
-- -----------------------------------------------------------------------------

create table if not exists public.notification_log (
  id         uuid primary key default gen_random_uuid(),

  -- 可為 null：日後的 24 節氣電子報這類通知不屬於任何場次。
  -- ⚠️ 但 unique 索引裡 null 彼此不相等，session_id 為 null 的列**沒有去重效果**。
  --    那類通知要自己另外設計去重鍵（例如再開一張表，或補一個 not null 的邏輯鍵）。
  session_id uuid references public.workshop_sessions (id) on delete cascade,

  stage      text not null,
  channel    text not null default 'email',
  sent_at    timestamptz not null default now(),

  -- 去重的核心。
  -- 順帶提供 (session_id, stage, channel) 的複合索引：worker 的
  -- 「這批場次哪些已經寄過」查詢（session_id in (...) and stage = ... and channel = ...）
  -- 前導欄位就是 session_id，直接吃這個索引，不必另外建（同 init.sql §11 的原則：
  -- 重複建同鍵索引只會增加寫入放大與 bloat）。
  constraint notification_log_session_stage_key unique (session_id, stage, channel)
);

comment on table public.notification_log is
  '通知寄送記錄。寄信前先 insert，撞到 unique violation 就代表已經寄過 → 跳過。取代 worker 早期的記憶體去重，讓重啟與多副本都不會重複寄信。';

comment on column public.notification_log.session_id is
  '對應的工作坊場次。可為 null（非場次類通知），但 null 不受 unique constraint 約束，見建表註解。';

comment on column public.notification_log.stage is
  '提醒階段：d3 = 開課前 3 天、d1 = 開課前 1 天。刻意用 text 而不是 enum —— 日後要加階段（例如 d7、課後回訪）不必動型別。';

comment on column public.notification_log.channel is
  '通知管道，目前只有 email。LINE 推播接上後填 line，與 email 各自獨立去重（同一場次兩個管道各寄一次是預期行為）。';

comment on column public.notification_log.sent_at is
  '「宣告要寄」的時間。insert 發生在實際送出之前（先佔位再寄），所以這是嘗試寄送的時間點，不代表每一封都成功送達 —— 個別失敗記在 worker 的 email_send_failed log。';


-- -----------------------------------------------------------------------------
-- 2. RLS 與授權：service role only
--
-- ..._rls.sql 已對 schema public 下了 `alter default privileges ... revoke all`，
-- 新表本來就不會自動 grant 給 anon / authenticated。這裡再明確 revoke 一次，
-- 讓「這張表不對外」是讀這個檔案就看得到的事實，而不是靠前一個 migration 的副作用。
--
-- ⚠️ 就算完全沒有 grant 也一定要 enable row level security：
--    哪天有人補了 grant 卻忘了開 RLS，整張表就直接外洩。
--    （同 ..._rls.sql 的理由，這裡一樣不用 force row level security —— force 會連
--     跑 migration 的 table owner 都擋住，service_role 則本來就靠 bypassrls 繞過。）
-- -----------------------------------------------------------------------------

revoke all on public.notification_log from anon, authenticated;

alter table public.notification_log enable row level security;

-- 刻意不建立任何 policy → 只有 service role（bypassrls）進得來。

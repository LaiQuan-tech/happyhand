-- 報名問題與站台共用內容

-- ---------------------------------------------------------------------------
-- 1. orders：結帳時多問的報名問題
-- ---------------------------------------------------------------------------
--
-- ⚠️ orders 對 authenticated 是 table 層 grant，所以這幾欄學員在 /account
--    看得到自己那筆 —— 那本來就是他自己填的，沒有隱私問題。

alter table public.orders
  add column if not exists intake_experience text,
  add column if not exists intake_goal       text,
  add column if not exists intake_source     text,
  add column if not exists health_ack_at     timestamptz;

comment on column public.orders.intake_experience is
  '報名問題：是否有相關學習經驗（none/heard/formal）。';
comment on column public.orders.intake_goal is
  '報名問題：最希望理解或改善什麼。給老師備課用。';
comment on column public.orders.intake_source is
  '報名問題：從哪裡得知這堂課。招生成效分析用。';
comment on column public.orders.health_ack_at is
  '勾選健康聲明的時間。⚠️ 這是法律證據，不要只存 boolean —— 要留得下「什麼時候同意的」。';

-- ---------------------------------------------------------------------------
-- 2. site_settings：所有課共用的內容
-- ---------------------------------------------------------------------------
--
-- 講師介紹、健康聲明這類東西每門課都一樣，不該在每個商品重填一次。
-- 目前它們寫死在 apps/web/lib/content.ts 的 TEACHER 常數裡。

create table if not exists public.site_settings (
  key         text        primary key,
  value       jsonb       not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

comment on table public.site_settings is
  '站台共用內容，key-value。目前用到的 key：'
  'teacher（講師介紹：name/title/paragraphs[]/credentials[]/links[]/photo_url）、'
  'health_notice（健康聲明全文）、payment_note（匯款與付款說明）。';

drop trigger if exists trg_site_settings_updated_at on public.site_settings;
create trigger trg_site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;

revoke all on public.site_settings from anon, authenticated;
grant select on public.site_settings to anon, authenticated;

-- 站台文案本來就是公開內容，全部開放讀取
drop policy if exists site_settings_select_all on public.site_settings;
create policy site_settings_select_all on public.site_settings
  for select
  to anon, authenticated
  using (true);

-- 種入目前寫死在 lib/content.ts 的講師資料，讓前台切換過去時不會突然變空白
insert into public.site_settings (key, value)
values (
  'teacher',
  jsonb_build_object(
    'name', 'Alice 劉柳樺',
    'title', '快樂手 JSJ 講師',
    'paragraphs', jsonb_build_array(
      '「快樂手」身心自我照顧品牌創辦人、JSJ 仁神術講師，華山小時光風土誌書店主理人。',
      '多年來，持續整合身心照顧、教育、藝術與公益，希望讓每個人都能把照顧自己的能力，輕輕帶回自己的雙手。'
    ),
    'credentials', jsonb_build_array(
      '仁神術合格講師',
      '自 2013 年起投入快樂手／Jin Shin Jyutsu 華文教材轉譯、課程主辦與教學',
      '快樂手 JSJ 課程系統主理人',
      '好日子股份有限公司創辦人',
      '華山小時光共好空間創辦人'
    ),
    'links', jsonb_build_array(),
    'photo_url', null
  )
)
on conflict (key) do nothing;

insert into public.site_settings (key, value)
values (
  'health_notice',
  jsonb_build_object(
    'title', '健康聲明',
    'body', '本課程為自我照顧、身體覺察與日常練習之學習內容，不提供醫療診斷、不取代醫療、不處理任何緊急狀況。' ||
            E'\n\n' ||
            '如您正在接受醫療或服藥，請持續遵循您的醫療團隊建議，不建議自行停藥或中斷治療。若身體出現急性或持續不適，請優先就醫。' ||
            E'\n\n' ||
            '仁神術是一種溫和的自我照顧練習，身體反應因人而異，也不保證任何療效或特定結果。'
  )
)
on conflict (key) do nothing;

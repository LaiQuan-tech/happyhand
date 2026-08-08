-- =============================================================================
-- 快樂手 — 種子資料
-- 來源：apps/web/lib/content.ts（PRODUCTS / WORKSHOP_SESSIONS）
--       與 design_handoff_happyhands/CONTENT.md 的商品清單
--
-- 這份 seed 必須與 lib/content.ts 逐字一致：前端在 DB 尚未就緒時會 fallback
-- 回 content.ts 的靜態資料，兩邊不一致的話畫面會在部署前後跳動。
--
-- 可重複執行：全部用 on conflict do update。
--   products          → conflict (slug)
--   course_lessons    → conflict (product_id, sort_order)
--   workshop_sessions → conflict (product_id, starts_at)
--
-- 刻意「不」覆寫的欄位：
--   products.cover_url          — 後台上傳的封面圖不該被 seed 洗掉
--   workshop_sessions.seats_taken — 這是活的報名數，覆寫等於竄改名額
--     （若要重置 demo 名額，手動下：
--        update workshop_sessions set seats_taken = 0 where product_id = ...;）
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. products（6 筆，全部 is_published = true）
-- -----------------------------------------------------------------------------

insert into public.products
  (type, slug, title, subtitle, description,
   price, compare_at_price, is_published, is_featured, tags, benefits, sort_order)
values
  (
    'course',
    'self-help-book-28-lessons',
    '自助課本 + 28 堂線上基礎學習課',
    '最多人選的完整組合',
    '從最基礎的手位開始，一堂一個能量流，二十八堂走完一輪。附一本紙本自助課本，練習的時候放在旁邊翻，不用一直看螢幕。',
    3600,
    4800,
    true,
    true,
    array['線上課程', '含課本'],
    array['永久回放', '含紙本課本', '可問老師'],
    1
  ),
  (
    'course',
    'jsj-beginner',
    '仁神術新手入門課（永久版）',
    '永久版，現在加贈課本',
    '沒有接觸過仁神術也沒關係。這門課從頭講起，慢慢帶你把手放到對的位置，一次學一個就好。',
    3600,
    null,
    true,
    false,
    array['線上課程', '新手'],
    array['永久回放', '現加贈課本', '可問老師'],
    2
  ),
  (
    'course',
    'pulse-reading',
    '快樂手 JSJ「讀脈入門課」',
    '終生回放，另有台北實體班',
    '把手放上去之後，怎麼知道身體在說什麼。這門課帶你認識讀脈的入門方法，慢慢練，不用急。',
    6800,
    null,
    true,
    false,
    array['線上課程', '進階'],
    array['終生回放', '另有台北實體班', '可問老師'],
    3
  ),
  (
    'course',
    'main-central-flow',
    '正中能量流（任脈＋督脈）',
    '單堂小品，先試試看感覺',
    '只有一堂，講最常用的正中能量流。想先試試看的話，從這裡開始最輕鬆。',
    888,
    null,
    true,
    false,
    array['線上課程', '單堂'],
    array['永久回放', '十分鐘就能做完'],
    4
  ),
  (
    'subscription',
    'seasonal-companion',
    '『24 節氣美好生活的年度陪伴計畫』',
    '依節氣定期寄送內容',
    '一年二十四個節氣，每到一個節氣就寄一封信給你，講這個時節身體容易怎麼樣、可以怎麼照顧自己。',
    500,
    null,
    true,
    false,
    array['訂閱', '陪伴'],
    array['依節氣寄送', '可隨時取消'],
    5
  ),
  (
    'workshop',
    'root-memory-workshop',
    '改寫根源記憶：療癒關係工作坊',
    '台北實體工作坊',
    '兩天的實體課，跟著老師一起把手放好，也把心裡的事情放好。名額不多，想來的話早點報名。',
    6800,
    null,
    true,
    false,
    array['實體工作坊', '台北'],
    array['含茶點', '可改期一次', '現場有助教'],
    6
  )
on conflict (slug) do update set
  type             = excluded.type,
  title            = excluded.title,
  subtitle         = excluded.subtitle,
  description      = excluded.description,
  price            = excluded.price,
  compare_at_price = excluded.compare_at_price,
  is_published     = excluded.is_published,
  is_featured      = excluded.is_featured,
  tags             = excluded.tags,
  benefits         = excluded.benefits,
  sort_order       = excluded.sort_order;
  -- cover_url 不覆寫；updated_at 由 trg_products_updated_at 處理


-- -----------------------------------------------------------------------------
-- 2. course_lessons（依 product slug 反查 id）
--    duration_sec 與 free_preview 需與 lib/content.ts 的 lessons 陣列一致。
-- -----------------------------------------------------------------------------

insert into public.course_lessons
  (product_id, title, duration_sec, free_preview, sort_order)
select p.id, v.title, v.duration_sec, v.free_preview, v.sort_order
from (
  values
    -- 自助課本 + 28 堂線上基礎學習課
    ('self-help-book-28-lessons', '第一堂：先把手放好',            720,  true,  1),
    ('self-help-book-28-lessons', '第二堂：呼吸慢下來',            660,  false, 2),
    ('self-help-book-28-lessons', '第三堂：手指與情緒',            780,  false, 3),
    ('self-help-book-28-lessons', '第四堂：正中能量流（上）',      840,  false, 4),
    ('self-help-book-28-lessons', '第五堂：正中能量流（下）',      810,  false, 5),
    ('self-help-book-28-lessons', '第六堂：肩頸緊繃時',            700,  false, 6),
    ('self-help-book-28-lessons', '第七堂：睡不好的晚上',          690,  false, 7),
    ('self-help-book-28-lessons', '第八堂：坐著也能做的替代姿勢',  750,  false, 8),

    -- 仁神術新手入門課（永久版）
    ('jsj-beginner',              '第一堂：什麼是仁神術',          600,  true,  1),
    ('jsj-beginner',              '第二堂：手上的能量鎖',          720,  false, 2),
    ('jsj-beginner',              '第三堂：每天十分鐘的順序',      660,  false, 3),
    ('jsj-beginner',              '第四堂：替家人做的時候',        780,  false, 4),

    -- 快樂手 JSJ「讀脈入門課」
    ('pulse-reading',             '第一堂：讀脈之前',              900,  true,  1),
    ('pulse-reading',             '第二堂：十二段的位置',          1020, false, 2),
    ('pulse-reading',             '第三堂：手感怎麼練',            960,  false, 3),

    -- 正中能量流（任脈＋督脈）
    ('main-central-flow',         '正中能量流完整示範',            960,  true,  1)
) as v (slug, title, duration_sec, free_preview, sort_order)
join public.products p on p.slug = v.slug
on conflict (product_id, sort_order) do update set
  title        = excluded.title,
  duration_sec = excluded.duration_sec,
  free_preview = excluded.free_preview;
  -- video_path 不覆寫：影片上傳後路徑由後台寫入，seed 不該清掉


-- -----------------------------------------------------------------------------
-- 3. workshop_sessions（3 筆）
--    第二筆是 16/16 額滿，trg_workshop_sessions_status 會自動把 status 設成 full，
--    lib/data.ts 的 .in("status", ["open","full"]) 仍然撈得到，前端顯示
--    「已額滿・我要候補」（README §工作坊列表）。
--    第三筆的 product 是線上課「讀脈入門課」的台北實體班，屬正常情形。
-- -----------------------------------------------------------------------------

insert into public.workshop_sessions
  (product_id, starts_at, ends_at, location, address, capacity, seats_taken)
select p.id, v.starts_at, v.ends_at, v.location, v.address, v.capacity, v.seats_taken
from (
  values
    (
      'root-memory-workshop',
      timestamptz '2026-09-12T01:30:00Z',
      timestamptz '2026-09-12T09:00:00Z',
      '好日子・台北教室',
      '臺北市中山區新生北路三段 1 號 9 樓之 15',
      16,
      12
    ),
    (
      'root-memory-workshop',
      timestamptz '2026-09-27T01:30:00Z',
      timestamptz '2026-09-27T09:00:00Z',
      '好日子・台北教室',
      '臺北市中山區新生北路三段 1 號 9 樓之 15',
      16,
      16
    ),
    (
      'pulse-reading',
      timestamptz '2026-10-18T02:00:00Z',
      timestamptz '2026-10-18T09:30:00Z',
      '好日子・台北教室',
      '臺北市中山區新生北路三段 1 號 9 樓之 15',
      12,
      3
    )
) as v (slug, starts_at, ends_at, location, address, capacity, seats_taken)
join public.products p on p.slug = v.slug
on conflict (product_id, starts_at) do update set
  ends_at  = excluded.ends_at,
  location = excluded.location,
  address  = excluded.address,
  capacity = excluded.capacity;
  -- seats_taken 刻意不覆寫（見檔頭說明）；status 由 trigger 依 seats_taken 維護


-- -----------------------------------------------------------------------------
-- 4. 自我檢查：資料筆數不對就讓 migration 失敗，不要靜默種錯
-- -----------------------------------------------------------------------------

do $$
declare
  v_products int;
  v_lessons  int;
  v_sessions int;
begin
  select count(*) into v_products from public.products where is_published;
  select count(*) into v_lessons  from public.course_lessons;
  select count(*) into v_sessions from public.workshop_sessions;

  if v_products < 6 then
    raise exception 'seed 檢查失敗：已發布商品只有 % 筆，應為 6 筆', v_products;
  end if;
  if v_lessons < 16 then
    raise exception 'seed 檢查失敗：課程單元只有 % 筆，應為 16 筆', v_lessons;
  end if;
  if v_sessions < 3 then
    raise exception 'seed 檢查失敗：工作坊場次只有 % 筆，應為 3 筆', v_sessions;
  end if;

  raise notice 'seed 完成：商品 % 筆 / 單元 % 筆 / 場次 % 筆', v_products, v_lessons, v_sessions;
end $$;

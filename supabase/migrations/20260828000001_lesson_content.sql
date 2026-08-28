-- =============================================================================
-- 快樂手 — 每一堂課的文字內容、講義與圖片
--
-- 老師想在單元裡放的東西有三種：一段文字說明、課程文件（PDF 講義），
-- 以及課內插圖。三種都是**賣出去的內容**，跟影片同一個付費牆。
-- =============================================================================

-- ── 1. 單元文字 ────────────────────────────────────────────────────────────
--
-- 純文字，換行原樣保留、空一行分段（渲染時 split(/\n{2,}/)）。
-- 不用 text[]：那組是給「一行一項」的清單用的，而且 shared.ts 的
-- linesToArray() 有每項 60 字的靜默截斷 —— 段落一定會被切掉。
alter table public.course_lessons
  add column if not exists body text;

comment on column public.course_lessons.body is
  '這一堂的文字說明。空一行分段。與 youtube_id 一樣屬於付費內容。';

-- ── 2. 私有 bucket ─────────────────────────────────────────────────────────
--
-- 🔴 public = false，跟 media 那個公開 bucket 完全相反。理由很直接：
--    講義 PDF 就是客人花 3,600 元買的東西。放公開 bucket 的話，
--    網址一流出去誰都能下載，而且沒有辦法事後收回。
--    現有程式碼把 youtube_id 保護到「欄位級 grant」的程度，
--    講義如果反而公開，那道保護就沒有意義了。
--
--    私有 bucket 的讀取一律經 /api/lessons/[id]/materials：
--    server 端驗過 entitlement 之後才發簽章網址（短效期）。
--
-- ⚠️ bucket 名稱一旦有檔案就不能改：lesson_materials.storage_path 存的是
--    bucket 內的相對路徑，名稱改了全部失效。
--    唯一真相在 apps/web/lib/admin/materials.ts 的 MATERIALS_BUCKET。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-materials', 'course-materials', false, 20971520,
        array[
          'application/pdf',
          'image/jpeg', 'image/png', 'image/webp'
        ])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ⚠️ 刻意不建立任何 storage.objects 的 policy（與 media bucket 同一個模型）：
--    沒有 policy → anon/authenticated 既讀不到也寫不進去。
--    讀取只能透過 server 端用 service role 產生的簽章網址，
--    寫入只能經 /api/admin/materials（驗員工身分）。
--
-- ⚠️⚠️ 不要「順手補齊 RLS」加 select policy —— 加了之後任何登入者都能
--       storage.list() 把整個 bucket 的檔名列出來，甚至直接下載。
--       這是刻意的留白，不是遺漏。

-- ── 3. 講義與圖片的索引表 ──────────────────────────────────────────────────

create table if not exists public.lesson_materials (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null
    references public.course_lessons(id) on delete cascade,

  -- file = 可下載的講義；image = 顯示在課程內容裡的插圖
  kind text not null,
  constraint lesson_materials_kind_valid check (kind in ('file', 'image')),

  /** bucket 內的相對路徑，例如 lessons/<lesson_id>/<uuid>.pdf */
  storage_path text not null unique,
  /** 上傳時的原始檔名。學員下載時看到的就是這個，不是 uuid。 */
  file_name text not null,
  mime_type text not null,
  size_bytes int not null,
  /** 圖片說明。file 不用。 */
  caption text,

  sort_order int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint lesson_materials_sort_key unique (lesson_id, kind, sort_order)
);

comment on table public.lesson_materials is
  '單元的講義與插圖。檔案本體在私有 bucket course-materials，讀取一律走簽章網址。';

create index if not exists lesson_materials_lesson_idx
  on public.lesson_materials (lesson_id, kind, sort_order);

alter table public.lesson_materials enable row level security;

-- 🔴 完全不發 grant 給 anon / authenticated。
--    這張表本身沒有機密，但「哪一堂有幾份講義、檔名叫什麼」就是課程大綱，
--    而且一旦給了 select，前端就能拿到 storage_path 去猜。
--    學員端一律經 /api/lessons/[id]/materials（驗過 entitlement 才回傳）。
revoke all on public.lesson_materials from anon, authenticated;

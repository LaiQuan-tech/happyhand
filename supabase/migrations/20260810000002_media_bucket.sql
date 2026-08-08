-- =============================================================================
-- 快樂手 — 後台圖片素材的 public bucket
-- 做法沿用 goodday/supabase/migrations/20260806000002_product_images_bucket.sql
--
-- 為什麼 public 而不是像 course-videos 那樣 private：
--   前台圖要長期顯示且經 next/image 最佳化。private 只能給簽名網址，而簽名網址
--   (a) 到期後 next/image 快取內的來源失效，變破圖
--   (b) 每次 render 的 query string 都不同 → 快取鍵每次都變 → 每個請求重新最佳化
--   (c) 這是公開行銷素材（課程封面、老師照片），沒有課程影片的付費牆考量
--
-- public URL 的 host 是 <ref>.supabase.co，
-- 已在 apps/web/next.config.ts 的 images.remotePatterns 放行。
--
-- ⚠️ bucket 名稱 'media' 一旦有圖就不能改：
--    既有 products.cover_url 存的是完整 public URL，改名會讓所有圖片 404。
--    唯一真相在 apps/web/lib/admin/media.ts 的 MEDIA_BUCKET。
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 8388608,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ⚠️ 刻意不建立任何 storage.objects 的 policy，維持本專案既有的安全模型：
--
--   讀：public bucket 的 /storage/v1/object/public/... 端點不經 RLS，不需要 select policy。
--   寫：沒有 insert/update/delete policy → anon/authenticated 一律不能寫。
--       上傳只能經 /api/admin/uploads（server 端驗員工身分 + service role 寫入）。
--
-- ⚠️⚠️ 不要「順手補齊 RLS」加上 select policy —— 一旦加了，匿名就能用
--       storage.list() 列出整個 bucket 的檔名。這是刻意的留白，不是遺漏。

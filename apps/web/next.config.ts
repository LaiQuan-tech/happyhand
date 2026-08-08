import type { NextConfig } from "next";

/**
 * 後台上傳的圖片存在 Supabase Storage 的 public bucket，
 * 前台用 next/image（components/ui/placeholder.tsx 的 Figure）顯示。
 *
 * ⚠️ 沒有這段 remotePatterns，只要 products.cover_url 有值，
 * /courses、/courses/[slug]、/workshops/[slug]、/cart、/checkout 會全部 500。
 * 目前 cover_url 都是 null 所以看不出問題，後台一上傳就會炸。
 *
 * 只放行 /storage/v1/object/public/**：簽名 URL（私有檔，例如課程影片）
 * 不該經過 next/image 快取層。
 */
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;

import Image from "next/image";

/**
 * 圖片佔位：設計稿中的斜紋色塊。
 * 一旦客戶提供素材，把 `src` 傳進來就會換成真實照片（README §8）。
 */
export function Figure({
  src,
  alt,
  label,
  className = "",
  rounded = "",
  sizes = "100vw",
  priority = false,
}: {
  src?: string | null;
  alt: string;
  label?: string;
  className?: string;
  rounded?: string;
  sizes?: string;
  priority?: boolean;
}) {
  if (src) {
    return (
      <div className={`relative overflow-hidden ${rounded} ${className}`}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      </div>
    );
  }
  return (
    <div
      role="img"
      aria-label={alt}
      className={`img-placeholder flex items-center justify-center ${rounded} ${className}`}
    >
      {label && (
        <span className="font-mono text-[13px] text-brown-300">{label}</span>
      )}
    </div>
  );
}

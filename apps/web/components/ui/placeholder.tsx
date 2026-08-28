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
  objectPosition = "object-center",
}: {
  src?: string | null;
  alt: string;
  label?: string;
  className?: string;
  rounded?: string;
  sizes?: string;
  priority?: boolean;
  /**
   * object-cover 的對齊點。人像放進比原圖更方的框時要用 `object-top`，
   * 不然置中裁切會把頭切掉 —— 講師照就是這個情況：同一張 4:5 的照片
   * 要同時吃首頁的 4:5 框與工作坊頁的 220px 方框。
   */
  objectPosition?: string;
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
          className={`object-cover ${objectPosition}`}
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

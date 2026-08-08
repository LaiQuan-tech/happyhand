import { SITE } from "@/lib/site";
import { LinkButton } from "@/components/ui/button";

/**
 * 手機固定行動列（README §4.1 #7）
 * 桌機不顯示。頁面容器需加 `.pb-action-bar` 預留 96px，避免遮擋內容。
 */
export function MobileActionBar({
  href = "/courses",
  label = "開始線上練習",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-sand-300 bg-white/96 px-[16px] pb-[calc(12px+env(safe-area-inset-bottom))] pt-[12px] backdrop-blur-sm md:hidden">
      <div className="flex gap-[10px]">
        <LinkButton
          href={SITE.phoneHref}
          variant="outline"
          className="flex-1 px-2 text-[17px]"
        >
          打電話問
        </LinkButton>
        <LinkButton
          href={href}
          variant="primary"
          className="flex-[1.4] px-2 text-[17px]"
        >
          {label}
        </LinkButton>
      </div>
    </div>
  );
}

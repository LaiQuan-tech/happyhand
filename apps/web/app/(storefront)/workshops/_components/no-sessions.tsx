import { LinkButton } from "@/components/ui/button";
import { SITE } from "@/lib/site";

/**
 * 沒有場次時的空狀態。
 * 不留白畫面，直接給一個打電話的出口（README §4.4／樂齡族需求）。
 */
export function NoSessions({ message }: { message?: string }) {
  return (
    <div className="rounded-card border border-dashed border-sand-400 bg-cream-100 p-[24px] text-center md:p-[40px]">
      <p className="t-body mx-auto max-w-[560px] text-brown-500">
        {message ??
          `最近沒有安排場次，想知道下一場什麼時候開，打 ${SITE.phone} 問我們。`}
      </p>
      <div className="mt-[20px] flex justify-center">
        <LinkButton
          href={SITE.phoneHref}
          variant="primary"
          className="w-full md:w-auto"
        >
          打電話問 {SITE.phone}
        </LinkButton>
      </div>
    </div>
  );
}

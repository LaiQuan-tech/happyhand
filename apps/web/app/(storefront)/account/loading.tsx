/**
 * 會員中心的載入畫面。
 *
 * 全站原本一個 loading.tsx 都沒有，而會員中心是唯一每一頁都要打資料庫的
 * 動態區塊 —— 沒有它，切頁時畫面會整個停住不動，長輩會以為當掉了然後一直按。
 *
 * 刻意用「骨架」而不是轉圈圈：轉圈圈只說「在忙」，骨架還說了
 * 「等一下會出現什麼形狀」，心理上的等待時間比較短。
 *
 * aria-hidden + 一句 sr-only：螢幕閱讀器不該逐一讀出十幾個空方塊。
 */
export default function AccountLoading() {
  return (
    <div>
      <span className="sr-only" role="status">
        正在讀取，請稍候
      </span>

      <div aria-hidden="true" className="animate-pulse">
        <div className="h-[38px] w-[180px] rounded-input bg-skeleton md:h-[44px] md:w-[220px]" />
        <div className="mt-[14px] h-[22px] w-full max-w-[420px] rounded-input bg-skeleton" />

        <div className="mt-[26px] flex flex-col gap-[16px] md:mt-[34px]">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="rounded-card border border-sand-300 px-[20px] py-[20px] md:px-[26px] md:py-[24px]"
            >
              <div className="flex flex-col gap-[18px] sm:flex-row sm:gap-[24px]">
                <div className="h-[160px] w-full shrink-0 rounded-card bg-skeleton sm:h-[126px] sm:w-[200px]" />
                <div className="flex-1">
                  <div className="h-[26px] w-[70%] rounded-input bg-skeleton" />
                  <div className="mt-[12px] h-[20px] w-[90%] rounded-input bg-skeleton" />
                  <div className="mt-[8px] h-[20px] w-[50%] rounded-input bg-skeleton" />
                  <div className="mt-[20px] h-[56px] w-full rounded-pill bg-skeleton sm:w-[200px]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

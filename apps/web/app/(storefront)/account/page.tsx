import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Figure } from "@/components/ui/placeholder";
import { getMember } from "@/lib/account/guard";
import { getMyCourses, type MyCourse } from "./queries";
import {
  Card,
  EmptyState,
  LineButton,
  LoadError,
  PageHeading,
  StatusChip,
} from "./_components/shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "我的學習",
  description: "你買過的線上課程都在這裡，想看幾次都可以。",
  robots: { index: false, follow: false },
};

/**
 * 我的學習。
 *
 * 名字照台灣慣例（Hahow、PressPlay、知識衛星三家都叫「我的學習」，
 * 只有較舊的 YOTTA 叫「我的課程」），但呈現方式為 60–75 歲客群改過：
 *
 * ・進度用完整句子「你已經上完 3 堂，還有 9 堂」，不用百分比也不用 3/12
 * ・**不做「進行中／已完成」分頁籤**。長輩手上的課可能只有一兩門，
 *   任何分頁都是純粹的認知負擔。實測台灣四家也沒有一家這樣分。
 * ・「不限觀看次數、沒有觀看期限」要大字寫出來 —— 長輩最大的焦慮是
 *   「會不會過期」「會不會看不完」，知識衛星把它寫成粗體 FAQ 是對的，
 *   我們寫在他每次登入都會看到的地方。
 * ・空狀態有兩句話，第二句處理「買了卻看不到」——那通常是登入的信箱
 *   跟下單時填的不一樣，是這個設計最容易出事的地方。
 */
export default async function AccountHomePage() {
  const member = await getMember();
  const { courses, error } = await getMyCourses();

  const greeting = member?.fullName ? `${member.fullName}，你好` : "你好";

  return (
    <>
      <PageHeading
        title="我的學習"
        lead={
          courses.length > 0
            ? `${greeting}。你買過的課都在這裡，想看幾次都可以。`
            : `${greeting}。`
        }
      />

      {error ? (
        <LoadError message={error} />
      ) : courses.length === 0 ? (
        // 兩個出口的順序有意義：先給「去買課」（多數人來到這裡的原因），
        // 再處理「我明明買了」（少數但很急的那群）。
        // EmptyState 的 children 排在 action 前面，所以主 CTA 要放 children 裡。
        <EmptyState title="您還沒有課程。">
          <Link
            href="/courses"
            className={buttonClass({
              variant: "primary",
              size: "lg",
              fullWidth: true,
              className: "mt-[6px] sm:w-auto",
            })}
          >
            點這裡看看有哪些課 →
          </Link>

          <p className="mt-[24px] border-t border-sand-300 pt-[20px]">
            如果你買過課卻看不到，可能是登入的信箱跟下單時填的不一樣。
            <br className="hidden sm:block" />
            用 LINE 跟我們說一聲，報你的名字就好，我們幫你查。
          </p>
          <div className="mt-[14px]">
            <LineButton label="買了課卻看不到？問我們" />
          </div>
        </EmptyState>
      ) : (
        <>
          <p className="t-body rounded-card bg-cream-100 px-[20px] py-[16px] text-brown-900 md:px-[26px] md:py-[18px]">
            <strong className="font-semibold">
              課程不限觀看次數，也沒有觀看期限。
            </strong>
            <br className="sm:hidden" />
            <span className="text-brown-700"> 你想看幾次都可以，慢慢來沒關係。</span>
          </p>

          <ul className="mt-[18px] flex flex-col gap-[16px] md:mt-[24px] md:gap-[20px]">
            {courses.map((course) => (
              <li key={course.productId}>
                <CourseCard course={course} />
              </li>
            ))}
          </ul>

          <PasswordReminder />
        </>
      )}
    </>
  );
}

/**
 * 換密碼提醒。
 *
 * 2026-08 把 2023 年舊平台的學員匯進來時，是統一發同一組預設密碼給他們的
 * —— 也就是說，知道某個人 email 的人就能登入他的帳號，看到姓名、電話與訂單。
 * 這條提醒是那個取捨的配套。
 *
 * 文案刻意寫成「如果你現在用的是……」而不是直接說「請改密碼」：
 * 自己設過密碼的人（訪客結帳後走設定密碼信的那群）讀到也不會困惑，
 * 所以不需要為了顯示這段而去記「這個人有沒有改過密碼」的狀態。
 *
 * 連到 /reset-password —— 那頁對已登入者就是「修改密碼」，
 * 跟 /account/settings 的改密碼入口是同一個地方。
 */
function PasswordReminder() {
  return (
    <section className="mt-[24px] rounded-card border border-sand-300 px-[20px] py-[18px] md:mt-[32px] md:px-[26px] md:py-[22px]">
      <h2 className="t-h3 text-brown-900">換一組只有你知道的密碼</h2>
      <p className="t-body mt-[8px] text-pretty text-brown-700">
        如果你現在用的是我們提供的預設密碼，建議改成自己的。
        改好之後，下次就用新的密碼登入。
      </p>
      <div className="mt-[16px]">
        <Link
          href="/reset-password"
          className={buttonClass({
            variant: "outline",
            size: "lg",
            fullWidth: true,
            className: "sm:w-auto",
          })}
        >
          設定新的密碼
        </Link>
      </div>
    </section>
  );
}

/**
 * 進度句子。
 *
 * 刻意不是「3/12」也不是「25%」。長輩讀分數要先做一次換算，
 * 讀百分比則完全沒有「還剩多少」的體感。完整句子最直接。
 */
function progressSentence(course: MyCourse): string {
  // 訂閱制（例如「24 節氣年度陪伴計畫」）本來就沒有影片單元，內容是寄信給你的。
  // 套用「課程內容準備中」會讓客人以為東西還沒做好、跑來問什麼時候開課。
  if (course.type === "subscription") {
    return "這是訂閱制的陪伴計畫，內容會依節氣寄到你的信箱，不用來這裡看。";
  }
  if (course.totalLessons === 0) return "課程內容準備中，開課我們會用 LINE 通知你。";
  if (course.completedLessons === 0) return `這門課有 ${course.totalLessons} 堂，還沒開始。`;
  const left = course.totalLessons - course.completedLessons;
  if (left === 0) return `這門課 ${course.totalLessons} 堂你都上完了，隨時可以再看一次。`;
  return `你已經上完 ${course.completedLessons} 堂，還有 ${left} 堂。`;
}

function CourseCard({ course }: { course: MyCourse }) {
  // 沒有單元的商品（例如還沒排課的訂閱制）不給進教室 ——
  // 讓長輩點進去看到空白畫面比不給點更糟。
  const enterable = course.totalLessons > 0 && !course.expired;
  const started = course.completedLessons > 0;

  return (
    <Card>
      <div className="flex flex-col gap-[18px] sm:flex-row sm:items-start sm:gap-[24px]">
        <Figure
          src={course.coverUrl ?? undefined}
          alt={`${course.title} 課程縮圖`}
          rounded="rounded-card"
          sizes="(min-width: 640px) 200px, 100vw"
          className="h-[160px] w-full shrink-0 sm:h-[126px] sm:w-[200px]"
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start gap-x-[12px] gap-y-[8px]">
            <h2 className="t-h3 min-w-0 text-brown-900">{course.title}</h2>
            {course.expired && <StatusChip tone="danger">觀看期限已到</StatusChip>}
          </div>

          {course.subtitle && (
            <p className="t-body-sm mt-[6px] text-pretty text-brown-500">
              {course.subtitle}
            </p>
          )}

          <p className="t-body mt-[12px] text-brown-700">
            {progressSentence(course)}
          </p>

          {course.expiresAt && !course.expired && (
            <p className="t-body-sm mt-[6px] text-brown-500">
              這門課可以看到 {course.expiresAt.slice(0, 10).replaceAll("-", "/")}。
            </p>
          )}

          <div className="mt-[18px]">
            {enterable ? (
              <Link
                href={`/account/learn/${course.slug}`}
                className={buttonClass({
                  variant: "primary",
                  size: "lg",
                  fullWidth: true,
                  className: "sm:w-auto",
                })}
              >
                {started
                  ? `繼續上課：${course.resumeLessonTitle ?? "下一堂"}`
                  : "開始上課"}
              </Link>
            ) : course.expired ? (
              <LineButton label="想繼續看？跟我們說" />
            ) : course.type === "subscription" ? (
              <p className="t-body-sm text-brown-500">
                有問題或想調整寄送方式，用 LINE 跟我們說就好。
              </p>
            ) : (
              <p className="t-body-sm text-brown-500">
                內容準備好我們會用 LINE 通知你。
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

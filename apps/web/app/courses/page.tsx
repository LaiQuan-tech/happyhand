import type { Metadata } from "next";
import { getProducts } from "@/lib/data";
import { MobileActionBar } from "@/components/mobile-action-bar";
import { SITE } from "@/lib/site";
import { CourseFilter } from "./_components/course-filter";

export const metadata: Metadata = {
  title: "線上課程",
  description:
    "在家慢慢練的線上課程，每一堂都可以永久回放，看不懂的地方隨時倒帶重來。也有實體工作坊與節氣訂閱計畫，不確定從哪堂開始可以打 02-2833-5820 問我們。",
};

/** 課程總覽（設計稿 195–336 行：桌機 201–280、手機 282–334） */
export default async function CoursesPage() {
  const products = await getProducts();

  return (
    <>
      <div className="pb-action-bar">
        {/* 標題帶：設計稿 210–214（桌機）／289–293（手機），底色 token cream-100 */}
        <section className="bg-cream-100 px-[22px] py-[32px] text-center md:px-[40px] md:py-[56px]">
          <div className="mx-auto max-w-maxw">
            <p className="t-eyebrow text-caramel-ink">ONLINE COURSES</p>
            <h1 className="mt-[10px] font-serif text-[28px] font-medium leading-[1.5] text-brown-900 md:mt-[12px] md:text-[36px] lg:text-[42px]">
              在家慢慢練的線上課程
            </h1>
            <p className="t-body mx-auto mt-[10px] max-w-[640px] text-brown-500 md:mt-[12px]">
              每一堂都可以永久回放，看不懂的地方隨時倒帶重來。
            </p>
          </div>
        </section>

        <CourseFilter products={products} />

        <div className="mx-auto max-w-maxw px-[20px] pb-[32px] md:px-[40px]">
          <p className="t-caption border-t border-sand-300 pt-[20px] text-brown-500">
            {SITE.disclaimer}
          </p>
        </div>
      </div>

      <MobileActionBar href="/workshops" label="看實體工作坊" />
    </>
  );
}

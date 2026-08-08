import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 登出。
 *
 * 刻意只收 POST：GET 的話任何一張圖片或連結（<img src="/logout">）
 * 都能把人登出，也會被瀏覽器預抓。
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase 驗證連結的落地點。
 *
 * 信箱驗證信、重設密碼信、magic link 都會把使用者導回這裡並帶 ?code=…，
 * 必須用這個 code 換成 session cookie。沒有這支的話，員工點完驗證信會落在
 * 首頁、看起來什麼都沒發生，得再自己回登入頁輸入一次密碼。
 *
 * next 參數只允許站內相對路徑，理由同 login-form.tsx 的 safeRedirect()：
 * 不擋的話這裡會變成開放轉址。
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/admin";
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  // Supabase 在連結失效或被用過時會帶 error 回來，直接把原因轉給登入頁顯示
  const errorDescription = searchParams.get("error_description");
  if (errorDescription) {
    const url = new URL("/login", origin);
    url.searchParams.set("error", errorDescription);
    return NextResponse.redirect(url);
  }

  if (!code) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const url = new URL("/login", origin);
    url.searchParams.set(
      "error",
      "這個連結已經失效或被使用過了，請重新登入或再要一次驗證信",
    );
    return NextResponse.redirect(url);
  }

  return NextResponse.redirect(new URL(next, origin));
}

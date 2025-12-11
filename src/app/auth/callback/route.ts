import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const redirect = requestUrl.searchParams.get("redirect") || "/app";
  const errorParam = requestUrl.searchParams.get("error");
  const errorDescription = requestUrl.searchParams.get("error_description");

  console.log("[auth/callback] Starting", {
    hasCode: !!code,
    redirect,
    origin: requestUrl.origin,
  });

  // Handle OAuth errors
  if (errorParam) {
    console.error("[auth/callback] OAuth error:", errorParam, errorDescription);
    return NextResponse.redirect(`${requestUrl.origin}/auth/error?message=${encodeURIComponent(errorDescription || errorParam)}`);
  }

  if (code) {
    // Build response with headers that will carry cookies
    const response = new NextResponse(
      `<!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta http-equiv="refresh" content="0;url=${redirect}" />
          <title>Redirecting...</title>
        </head>
        <body>
          <p>Redirecting...</p>
          <script>window.location.href = "${redirect}";</script>
        </body>
      </html>`,
      {
        status: 200,
        headers: {
          "Content-Type": "text/html",
        },
      }
    );
    
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          console.log("[auth/callback] setAll called with", cookiesToSet.length, "cookies:", cookiesToSet.map(c => c.name));
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, { ...options, path: options?.path || "/" });
          });
        },
      },
    });
    
    console.log("[auth/callback] Exchanging code for session...");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
      console.error("[auth/callback] Exchange error:", error.message);
      return NextResponse.redirect(`${requestUrl.origin}/auth/error?message=${encodeURIComponent(error.message)}`);
    }
    
    if (data.session) {
      console.log("[auth/callback] Success! User:", data.session.user.id);
      console.log("[auth/callback] Cookies set:", response.cookies.getAll().map(c => c.name));
      // Return HTML page instead of redirect - this allows cookies to be properly set
      return response;
    }
    
    console.error("[auth/callback] No session returned");
  }

  return NextResponse.redirect(`${requestUrl.origin}/auth/error`);
}

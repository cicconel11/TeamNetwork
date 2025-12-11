import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "./lib/env";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// Routes that don't require authentication
const publicRoutes = ["/", "/auth/login", "/auth/signup", "/auth/callback", "/auth/error", "/auth/signout", "/terms"];

// Routes that should redirect to /app if user is already authenticated
const authOnlyRoutes = ["/", "/auth/login", "/auth/signup"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host");

  // Bypass Stripe webhook so middleware does not block it
  if (pathname === "/api/stripe/webhook") {
    return NextResponse.next();
  }

  // Canonical host redirect: ensure cookies stay scoped to www domain
  if (host === "myteamnetwork.com") {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = "www.myteamnetwork.com";
    return NextResponse.redirect(url, { status: 308 });
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  const cookiesAll = request.cookies.getAll();
  const hasAuthCookies = cookiesAll.some(
    (c) => c.name.startsWith("sb-") || c.name.includes("auth-token")
  );

  // Safer: read session from cookies; allow pass-through if cookies exist but session null
  const isTestMode = process.env.AUTH_TEST_MODE === "true";
  let session = null;
  let authError: Error | null = null;
  if (isTestMode) {
    session = hasAuthCookies ? { user: { id: "test-user" } as { id: string } } : null;
  } else {
    const res = await supabase.auth.getSession();
    session = res.data.session;
    authError = res.error;
  }

  const user = session?.user ?? null;

  const shouldLog = process.env.NEXT_PUBLIC_LOG_AUTH === "true";
  const sbCookies = cookiesAll.map((c) => c.name).filter((n) => n.startsWith("sb-"));
  if (shouldLog) {
    console.log("[AUTH-MW]", {
      host,
      pathname,
      sbCookies,
      sessionUser: user ? user.id : null,
      sessionNull: !session,
      authError: authError?.message || null,
    });
    if (pathname.startsWith("/testing123")) {
      console.log("[AUTH-MW-testing123]", {
        pathname,
        sbCookies,
        sessionPresent: !!session,
        authError: authError?.message || null,
      });
    }
  }

  const isPublicRoute =
    publicRoutes.some((route) => pathname === route) || pathname.startsWith("/auth/");

  if (isPublicRoute) {
    return response;
  }

  // API routes: keep JSON 401 instead of HTML redirect
  if (pathname.startsWith("/api/")) {
    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "Authentication required" },
        { status: 401 }
      );
    }
    return response;
  }

  if (user && authOnlyRoutes.includes(pathname)) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  if (!user) {
    if (hasAuthCookies) {
      // Likely refresh in-flight; allow pass-through to avoid loops
      return response;
    }
    const redirectUrl = new URL("/auth/login", request.url);
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

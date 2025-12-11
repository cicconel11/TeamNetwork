import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "./lib/env";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// Routes that don't require authentication
const publicRoutes = ["/", "/auth/login", "/auth/signup", "/auth/callback", "/auth/error", "/auth/signout"];

// Routes that should redirect to /app if user is already authenticated
const authOnlyRoutes = ["/", "/auth/login", "/auth/signup"];

export async function middleware(request: NextRequest) {
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
        request.cookies.set({
          name,
          value,
          ...options,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({
          name,
          value,
          ...options,
        });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({
          name,
          value: "",
          ...options,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({
          name,
          value: "",
          ...options,
        });
      },
    },
  });

  // Refresh session if it exists
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  
  // Debug: log auth state for protected routes
  if (!pathname.startsWith("/auth") && !pathname.startsWith("/api") && pathname !== "/") {
    console.log("[middleware]", pathname, user ? `user:${user.id.slice(0,8)}` : "no-user", authError?.message || "");
  }

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(route => 
    pathname === route || pathname.startsWith("/auth/")
  );

  // If user is authenticated and on an auth-only route, redirect to /app
  if (user && authOnlyRoutes.includes(pathname)) {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  // If user is not authenticated and trying to access a protected route
  if (!user && !isPublicRoute) {
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

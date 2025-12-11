import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Routes that don't require authentication
const publicRoutes = ["/", "/auth/login", "/auth/signup", "/auth/callback", "/auth/error", "/auth/signout", "/terms"];

// Routes that should redirect to /app if user is already authenticated
const authOnlyRoutes = ["/", "/auth/login", "/auth/signup"];

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        );
        supabaseResponse = NextResponse.next({
          request,
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: Do NOT use getSession() - it doesn't properly refresh the session.
  // Use getUser() which validates the session and refreshes cookies if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // Debug logging
  if (!pathname.startsWith("/api") && !pathname.startsWith("/_next")) {
    console.log("[middleware]", pathname, user ? `user:${user.id.slice(0, 8)}` : "no-user");
  }

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith("/auth/")
  );

  // For public routes, just pass through
  if (isPublicRoute) {
    return supabaseResponse;
  }

  // If user is authenticated and on an auth-only route, redirect to /app
  if (user && authOnlyRoutes.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    return NextResponse.redirect(url);
  }

  // If user is not authenticated and trying to access a protected route
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // IMPORTANT: Return the supabaseResponse, not a new NextResponse.
  // This ensures the cookies are properly set for session management.
  return supabaseResponse;
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

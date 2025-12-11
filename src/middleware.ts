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

  // FIX: Use getSession() instead of getUser() for route protection.
  // getUser() validates tokens against Supabase servers and can fail with
  // "Auth session missing!" during token refresh race conditions.
  // getSession() reads the JWT from cookies locally without server validation,
  // which is sufficient for route protection. Server components that need
  // verified user data can still call getUser().
  const {
    data: { session },
    error: authError,
  } = await supabase.auth.getSession();

  const user = session?.user ?? null;
  const pathname = request.nextUrl.pathname;

  // Debug logging for non-static routes
  if (!pathname.startsWith("/_next") && !pathname.match(/\.(svg|png|jpg|jpeg|gif|webp|ico)$/)) {
    console.log("[middleware]", pathname, user ? `user:${user.id.slice(0, 8)}` : "no-user", 
      `cookies:${request.cookies.getAll().map(c => c.name).filter(n => n.startsWith('sb-')).join(',') || 'none'}`,
      authError ? `error:${authError.message}` : '');
  }

  // Check if this is a public route
  const isPublicRoute = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith("/auth/")
  );

  // For public routes, just pass through (but still refresh session if present)
  if (isPublicRoute) {
    return supabaseResponse;
  }

  // API routes should return 401 JSON, not redirect to login page
  // This prevents client-side fetch calls from following redirects to HTML
  if (pathname.startsWith("/api/")) {
    if (!user) {
      console.log("[middleware] API route unauthorized:", pathname);
      return NextResponse.json(
        { error: "Unauthorized", message: "Authentication required" },
        { status: 401 }
      );
    }
    // API routes pass through if authenticated
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
    console.log("[middleware] Redirecting to login, no user found for:", pathname);
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

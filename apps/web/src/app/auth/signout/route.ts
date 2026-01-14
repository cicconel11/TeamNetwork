import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireEnv } from "@/lib/env";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function GET(request: Request) {
  // Don't allow GET requests for signout to prevent accidental logout via prefetching
  // Next.js <Link> prefetches pages, which would trigger this handler and log out the user
  const { origin } = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;

  console.log("[signout] Rejected GET request - use POST to sign out");

  // Redirect to home instead of signing out
  return NextResponse.redirect(`${siteUrl}/`, { status: 303 });
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;
  const cookieStore = await cookies();

  // Create response first so we can set cookies on it
  const response = NextResponse.redirect(`${siteUrl}/`, {
    status: 303, // Use 303 to convert POST to GET redirect
  });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, {
            ...options,
            path: options.path ?? "/",
            domain: undefined,
          });
        });
      },
    },
  });

  await supabase.auth.signOut();

  console.log("[signout] Signed out, cookies cleared");

  // Force-clear any legacy cookies on .myteamnetwork.com domain to prevent conflicts
  if (process.env.NODE_ENV === "production") {
    const allCookies = cookieStore.getAll();
    allCookies.forEach((cookie) => {
      if (cookie.name.startsWith("sb-")) {
        response.headers.append(
          "Set-Cookie",
          `${cookie.name}=; Path=/; Domain=.myteamnetwork.com; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax`
        );
      }
    });
  }

  return response;
}

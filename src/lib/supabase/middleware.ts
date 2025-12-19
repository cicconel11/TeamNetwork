import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireEnv } from "../env";

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

export async function updateSession(request: NextRequest) {
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
        // Add domain for production to ensure cookies work across www and non-www
        const cookieOptions = {
          ...options,
          domain: process.env.NODE_ENV === "production" ? ".myteamnetwork.com" : undefined,
        };
        request.cookies.set({
          name,
          value,
          ...cookieOptions,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({
          name,
          value,
          ...cookieOptions,
        });
      },
      remove(name: string, options: CookieOptions) {
        // Add domain for production to ensure cookies are removed across www and non-www
        const cookieOptions = {
          ...options,
          domain: process.env.NODE_ENV === "production" ? ".myteamnetwork.com" : undefined,
        };
        request.cookies.set({
          name,
          value: "",
          ...cookieOptions,
        });
        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        response.cookies.set({
          name,
          value: "",
          ...cookieOptions,
        });
      },
    },
  });

  // Refresh session if it exists
  await supabase.auth.getUser();

  return response;
}


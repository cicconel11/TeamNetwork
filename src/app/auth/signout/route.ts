import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || origin;
  const cookieStore = await cookies();
  
  // Create response first so we can set cookies on it
  const response = NextResponse.redirect(`${siteUrl}/`);
  
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, { ...options, path: "/" });
        });
      },
    },
  });
  
  await supabase.auth.signOut();
  
  console.log("[signout] Signed out, cookies cleared");
  
  return response;
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
          response.cookies.set(name, value, { ...options, path: "/" });
        });
      },
    },
  });
  
  await supabase.auth.signOut();
  
  console.log("[signout] Signed out, cookies cleared");
  
  return response;
}


import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  
  await supabase.auth.signOut();
  
  return NextResponse.redirect(`${origin}/`);
}

export async function POST(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  
  await supabase.auth.signOut();
  
  return NextResponse.redirect(`${origin}/`, {
    status: 303, // Use 303 to convert POST to GET redirect
  });
}


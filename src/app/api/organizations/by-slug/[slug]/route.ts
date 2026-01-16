import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { baseSchemas } from "@/lib/security/validation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

/**
 * GET /api/organizations/by-slug/[slug]
 * 
 * Returns the organization ID for a given slug.
 * Used by CheckoutSuccessBanner to poll for org creation after checkout.
 */
export async function GET(req: Request, { params }: RouteParams) {
  const { slug } = await params;
  
  // Validate slug format
  const slugParsed = baseSchemas.slug.safeParse(slug);
  if (!slugParsed.success) {
    return NextResponse.json({ error: "Invalid slug format" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: org, error } = await supabase
    .from("organizations")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[by-slug] Failed to lookup organization:", error);
    return NextResponse.json({ error: "Failed to lookup organization" }, { status: 500 });
  }

  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  return NextResponse.json({ id: org.id, name: org.name, slug: org.slug });
}

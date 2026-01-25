import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { maskUrl } from "@/lib/schedule-connectors/fetch";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to view sources." },
        { status: 401 }
      );
    }

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");

    if (!orgId) {
      return NextResponse.json(
        { error: "Missing parameter", message: "orgId is required." },
        { status: 400 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (!membership || membership.status === "revoked") {
      return NextResponse.json(
        { error: "Forbidden", message: "You are not a member of this organization." },
        { status: 403 }
      );
    }

    const { data: sources, error } = await supabase
      .from("schedule_sources")
      .select("id, vendor_id, source_url, status, last_synced_at, last_error, title")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[schedule-sources] Failed to fetch sources:", error);
      return NextResponse.json(
        { error: "Database error", message: "Failed to fetch sources." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      sources: (sources || []).map((source) => ({
        id: source.id,
        vendor_id: source.vendor_id,
        maskedUrl: maskUrl(source.source_url),
        status: source.status,
        last_synced_at: source.last_synced_at,
        last_error: source.last_error,
        title: source.title,
      })),
    });
  } catch (error) {
    console.error("[schedule-sources] Error:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to load sources." },
      { status: 500 }
    );
  }
}

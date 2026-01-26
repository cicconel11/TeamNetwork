import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { maskUrl } from "@/lib/schedule-connectors/fetch";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: { sourceId: string } }
) {
  try {
    // IP-based rate limiting
    const ipRateLimit = checkRateLimit(request, {
      limitPerIp: 15,
      limitPerUser: 0,
      windowMs: 60_000,
      feature: "schedule sources",
    });
    if (!ipRateLimit.ok) {
      return buildRateLimitResponse(ipRateLimit);
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to update sources." },
        { status: 401 }
      );
    }

    // User-based rate limiting
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0,
      limitPerUser: 10,
      windowMs: 60_000,
      feature: "schedule sources",
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    let body: { status?: "active" | "paused"; title?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request", message: "Request body must be valid JSON." },
        { status: 400 }
      );
    }

    const { data: source, error } = await supabase
      .from("schedule_sources")
      .select("id, org_id, source_url, status, title")
      .eq("id", params.sourceId)
      .single();

    if (error || !source) {
      return NextResponse.json(
        { error: "Not found", message: "Schedule source not found." },
        { status: 404 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", source.org_id)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can update schedule sources." },
        { status: 403 }
      );
    }

    const updates: { status?: string; title?: string | null; updated_at?: string } = {
      updated_at: new Date().toISOString(),
    };

    if (body.status) {
      updates.status = body.status;
    }

    if (typeof body.title === "string") {
      updates.title = body.title.trim() || null;
    }

    const { data: updated, error: updateError } = await supabase
      .from("schedule_sources")
      .update(updates)
      .eq("id", source.id)
      .select("id, vendor_id, source_url, status, last_synced_at, last_error, title")
      .single();

    if (updateError || !updated) {
      console.error("[schedule-source] Failed to update source:", updateError);
      return NextResponse.json(
        { error: "Database error", message: "Failed to update schedule source." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        source: {
          id: updated.id,
          vendor_id: updated.vendor_id,
          maskedUrl: maskUrl(updated.source_url),
          status: updated.status,
          last_synced_at: updated.last_synced_at,
          last_error: updated.last_error,
          title: updated.title,
        },
      },
      { headers: rateLimit.headers }
    );
  } catch (error) {
    console.error("[schedule-source] Error updating source:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to update schedule source." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { sourceId: string } }
) {
  try {
    // IP-based rate limiting
    const ipRateLimit = checkRateLimit(request, {
      limitPerIp: 15,
      limitPerUser: 0,
      windowMs: 60_000,
      feature: "schedule sources",
    });
    if (!ipRateLimit.ok) {
      return buildRateLimitResponse(ipRateLimit);
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to remove sources." },
        { status: 401 }
      );
    }

    // User-based rate limiting
    const rateLimit = checkRateLimit(request, {
      userId: user.id,
      limitPerIp: 0,
      limitPerUser: 10,
      windowMs: 60_000,
      feature: "schedule sources",
    });
    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    const { data: source, error } = await supabase
      .from("schedule_sources")
      .select("id, org_id")
      .eq("id", params.sourceId)
      .single();

    if (error || !source) {
      return NextResponse.json(
        { error: "Not found", message: "Schedule source not found." },
        { status: 404 }
      );
    }

    const { data: membership } = await supabase
      .from("user_organization_roles")
      .select("role,status")
      .eq("user_id", user.id)
      .eq("organization_id", source.org_id)
      .maybeSingle();

    if (!membership || membership.status === "revoked" || membership.role !== "admin") {
      return NextResponse.json(
        { error: "Forbidden", message: "Only admins can remove schedule sources." },
        { status: 403 }
      );
    }

    const { error: deleteError } = await supabase
      .from("schedule_sources")
      .delete()
      .eq("id", source.id);

    if (deleteError) {
      console.error("[schedule-source] Failed to delete source:", deleteError);
      return NextResponse.json(
        { error: "Database error", message: "Failed to delete schedule source." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true }, { headers: rateLimit.headers });
  } catch (error) {
    console.error("[schedule-source] Error deleting source:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to delete schedule source." },
      { status: 500 }
    );
  }
}

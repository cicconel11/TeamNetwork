import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncScheduleSource } from "@/lib/schedule-connectors/sync-source";

export const dynamic = "force-dynamic";

const WINDOW_PAST_DAYS = 30;
const WINDOW_FUTURE_DAYS = 366;

export async function POST(
  _request: Request,
  { params }: { params: { sourceId: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to sync sources." },
        { status: 401 }
      );
    }

    const { data: source, error } = await supabase
      .from("schedule_sources")
      .select("id, org_id, vendor_id, source_url")
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
        { error: "Forbidden", message: "Only admins can sync schedule sources." },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    const window = buildSyncWindow();
    const result = await syncScheduleSource(serviceClient, { source, window });

    return NextResponse.json({
      sync: result,
    });
  } catch (error) {
    console.error("[schedule-source-sync] Error:", error);
    return NextResponse.json(
      { error: "Internal error", message: "Failed to sync schedule source." },
      { status: 500 }
    );
  }
}

function buildSyncWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - WINDOW_PAST_DAYS);
  from.setHours(0, 0, 0, 0);

  const to = new Date(now);
  to.setDate(to.getDate() + WINDOW_FUTURE_DAYS);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

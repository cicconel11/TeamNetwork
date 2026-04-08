import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getUserFromRequest } from "@/lib/supabase/get-user-from-request";
import { syncEventToUsers, SyncOperation } from "@/lib/google/calendar-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/calendar/event-sync
 *
 * Triggers calendar synchronization for a specific event.
 * Called automatically when events are created, updated, or deleted.
 *
 * Request body:
 * - eventId: string - The event ID to sync
 * - organizationId: string - The organization ID
 * - operation: "create" | "update" | "delete" - The sync operation type
 *
 * Requirements: 2.1, 3.1, 4.1
 */
export async function POST(request: NextRequest) {
  try {
    const { user, supabase } = await getUserFromRequest(request);

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized", message: "You must be logged in to sync events." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { eventId, organizationId, operation } = body as {
      eventId: string;
      organizationId: string;
      operation: SyncOperation;
    };

    if (!eventId || !organizationId || !operation) {
      return NextResponse.json(
        { error: "Bad request", message: "Missing required fields: eventId, organizationId, operation" },
        { status: 400 }
      );
    }

    if (!["create", "update", "delete"].includes(operation)) {
      return NextResponse.json(
        { error: "Bad request", message: "Invalid operation. Must be create, update, or delete." },
        { status: 400 }
      );
    }

    const { data: membership, error: membershipError } = await supabase
      .from("user_organization_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("organization_id", organizationId)
      .single();

    if (membershipError || !membership) {
      return NextResponse.json(
        { error: "Forbidden", message: "You do not have access to this organization." },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();
    await syncEventToUsers(serviceClient, organizationId, eventId, operation);

    return NextResponse.json({
      success: true,
      message: `Calendar sync triggered for event ${eventId} (${operation})`,
    });
  } catch (error) {
    console.error("[calendar-event-sync] Error:", error);

    // Do not fail the parent event action when sync work errors.
    return NextResponse.json(
      {
        success: false,
        message: "Calendar sync encountered an error but event operation completed.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

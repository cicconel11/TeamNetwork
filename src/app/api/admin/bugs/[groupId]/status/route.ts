import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isDevAdminEmail } from "@/lib/auth/dev-admin";
import { updateErrorGroupStatus } from "@/lib/error-alerts/queries";

const VALID_STATUSES = ["open", "resolved", "ignored", "muted"] as const;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;

  // Auth check - get current user
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user || !isDevAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 }
    );
  }

  // Validate body
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const { status } = body;

  if (!status || !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return NextResponse.json(
      { error: "Invalid status. Must be one of: open, resolved, ignored, muted" },
      { status: 400 }
    );
  }

  // Update using service client (bypasses RLS)
  const serviceClient = createServiceClient();
  const { data, error } = await updateErrorGroupStatus(
    serviceClient,
    groupId,
    status as typeof VALID_STATUSES[number]
  );

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Error group not found" },
      { status: 404 }
    );
  }

  return NextResponse.json(data);
}

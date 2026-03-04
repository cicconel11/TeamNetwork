import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { createPollSchema } from "@/lib/schemas/chat-polls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

/**
 * Loads the chat group and validates it exists and is not soft-deleted.
 * Also selects require_approval to determine message status.
 * Returns the group or null.
 */
async function loadGroup(supabase: Awaited<ReturnType<typeof createClient>>, groupId: string) {
  const { data } = await supabase
    .from("chat_groups")
    .select("id, organization_id, require_approval, deleted_at")
    .eq("id", groupId)
    .is("deleted_at", null)
    .single();
  return data;
}

/**
 * Checks if a user is a member of the chat group and returns their membership row.
 */
async function getGroupMembership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  groupId: string,
  userId: string
) {
  const { data } = await supabase
    .from("chat_group_members")
    .select("id, role, joined_at")
    .eq("chat_group_id", groupId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  return data;
}

/**
 * POST /api/chat/[groupId]/polls
 * Create a poll message in the group.
 * Auth: must be group member.
 * Body: { question, options, allow_change }
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "chat-poll-create",
    limitPerIp: 15,
    limitPerUser: 8,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  // Parse body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return respond({ error: "Invalid JSON body" }, 400);
  }

  const parsed = createPollSchema.safeParse(body);
  if (!parsed.success) {
    return respond({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const group = await loadGroup(supabase, groupId);
  if (!group) return respond({ error: "Group not found" }, 404);

  // Check org membership and role
  const { data: orgRole } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", group.organization_id)
    .maybeSingle();

  if (!orgRole) return respond({ error: "Forbidden" }, 403);

  const isOrgAdmin = orgRole.role === "admin";
  const membership = await getGroupMembership(supabase, groupId, user.id);

  if (!membership && !isOrgAdmin) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Determine if user can moderate (approve messages without review)
  const isGroupMod = membership?.role === "admin" || membership?.role === "moderator";
  const canModerate = isOrgAdmin || isGroupMod;

  // Determine message status based on group approval requirements
  const status = group.require_approval && !canModerate ? "pending" : "approved";

  // Build poll metadata from parsed input (immutable construction)
  const metadata = {
    question: parsed.data.question,
    options: parsed.data.options.map((label) => ({ label })),
    allow_change: parsed.data.allow_change,
  };

  const { data: message, error: insertError } = await supabase
    .from("chat_messages")
    .insert({
      message_type: "poll",
      body: parsed.data.question,
      metadata,
      status,
      author_id: user.id,
      chat_group_id: groupId,
      organization_id: group.organization_id,
    })
    .select()
    .single();

  if (insertError) {
    return respond({ error: "Failed to create poll" }, 500);
  }

  return respond({ message }, 201);
}

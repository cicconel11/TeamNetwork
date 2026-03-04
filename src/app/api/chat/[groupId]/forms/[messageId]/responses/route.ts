import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { chatFormResponseSchema, type FormMetadata } from "@/lib/schemas/chat-polls";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string; messageId: string }>;
}

/**
 * Loads the chat group and validates it exists and is not soft-deleted.
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
 * POST /api/chat/[groupId]/forms/[messageId]/responses
 * Submit a response to a form message.
 * Auth: must be group member.
 * Body: Record<fieldId, value>
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { groupId, messageId } = await params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const messageIdParsed = baseSchemas.uuid.safeParse(messageId);
  if (!messageIdParsed.success) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "chat-form-response",
    limitPerIp: 30,
    limitPerUser: 20,
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

  const parsed = chatFormResponseSchema.safeParse(body);
  if (!parsed.success) {
    return respond({ error: "Validation failed", details: parsed.error.flatten() }, 400);
  }

  const group = await loadGroup(supabase, groupId);
  if (!group) return respond({ error: "Group not found" }, 404);

  // Check org membership
  const { data: orgRole } = await supabase
    .from("user_organization_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("organization_id", group.organization_id)
    .maybeSingle();

  if (!orgRole) return respond({ error: "Forbidden" }, 403);

  const membership = await getGroupMembership(supabase, groupId, user.id);
  if (!membership) return respond({ error: "Forbidden" }, 403);

  // Verify the message exists, is a form, is not deleted, and is approved
  const { data: message } = await supabase
    .from("chat_messages")
    .select("id, message_type, status, metadata, deleted_at")
    .eq("id", messageId)
    .eq("chat_group_id", groupId)
    .is("deleted_at", null)
    .single();

  if (!message) return respond({ error: "Form not found" }, 404);
  if (message.message_type !== "form") return respond({ error: "Message is not a form" }, 400);
  if (message.status !== "approved") return respond({ error: "Form is not available" }, 400);

  // Validate required fields from form metadata
  const formMetadata = message.metadata as FormMetadata | null;
  if (formMetadata?.fields) {
    const requiredFieldIds = formMetadata.fields
      .filter((field) => field.required)
      .map((field) => field.id);

    const missingFields = requiredFieldIds.filter((fieldId) => {
      const value = parsed.data[fieldId];
      return value === undefined || value.trim() === "";
    });

    if (missingFields.length > 0) {
      return respond({ error: "Missing required fields", missing_fields: missingFields }, 400);
    }
  }

  // Check if user already submitted a response
  const { data: existingResponse } = await supabase
    .from("chat_form_responses")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingResponse) return respond({ error: "Already submitted" }, 409);

  // Insert the form response
  const { data: response, error: insertError } = await supabase
    .from("chat_form_responses")
    .insert({
      message_id: messageId,
      chat_group_id: groupId,
      organization_id: group.organization_id,
      user_id: user.id,
      responses: parsed.data,
    })
    .select()
    .single();

  if (insertError) {
    return respond({ error: "Failed to submit response" }, 500);
  }

  return respond({ response }, 201);
}

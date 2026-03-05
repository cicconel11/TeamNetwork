import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, validateJson, ValidationError } from "@/lib/security/validation";
import { createFormSchema } from "@/lib/schemas/chat-polls";
import { getChatGroupContext } from "@/lib/auth/chat-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

/**
 * POST /api/chat/[groupId]/forms
 * Create a form message in the chat group.
 * Auth: must be active org member + group member.
 * Body: { title: string, fields: ChatFormField[] }
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
    feature: "chat-form-create",
    limitPerIp: 15,
    limitPerUser: 8,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  let parsed;
  try {
    parsed = await validateJson(req, createFormSchema);
  } catch (err) {
    if (err instanceof ValidationError) {
      return respond({ error: err.message, details: err.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  if (!ctx.membership) {
    return respond({ error: "Forbidden" }, 403);
  }

  // Determine message status based on group approval requirement
  const status = ctx.group.require_approval && !ctx.canModerate ? "pending" : "approved";

  // Build metadata from parsed fields
  const metadata = {
    title: parsed.title,
    fields: parsed.fields,
  };

  const { data: message, error: insertError } = await supabase
    .from("chat_messages")
    .insert({
      chat_group_id: groupId,
      organization_id: ctx.group.organization_id,
      author_id: user.id,
      message_type: "form",
      body: parsed.title,
      metadata,
      status,
    })
    .select()
    .single();

  if (insertError) {
    return respond({ error: "Failed to create form" }, 500);
  }

  return respond({ message }, 201);
}

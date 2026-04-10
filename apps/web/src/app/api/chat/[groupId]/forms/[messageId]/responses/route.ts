import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas } from "@/lib/security/validation";
import { chatFormResponseSchema, type FormMetadata } from "@/lib/schemas/chat-polls";
import { getChatGroupContext } from "@/lib/auth/chat-helpers";

export async function POST(req: Request, { params }: { params: { groupId: string; messageId: string } }) {
  const { groupId, messageId } = params;

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

  let rawBody: unknown;
  try {
    const bodyBuffer = await req.arrayBuffer();
    if (bodyBuffer.byteLength > 25_000) {
      return respond({ error: "Payload too large" }, 413);
    }
    const rawText = new TextDecoder().decode(bodyBuffer);
    rawBody = rawText.length ? JSON.parse(rawText) : {};
  } catch {
    return respond({ error: "Invalid JSON payload" }, 400);
  }

  if (
    rawBody &&
    typeof rawBody === "object" &&
    !Array.isArray(rawBody) &&
    "responses" in rawBody &&
    typeof (rawBody as Record<string, unknown>).responses === "object"
  ) {
    rawBody = (rawBody as Record<string, unknown>).responses;
  }

  const parseResult = chatFormResponseSchema.safeParse(rawBody);
  if (!parseResult.success) {
    return respond(
      { error: "Invalid form response", details: parseResult.error.issues.map((e) => e.message) },
      400,
    );
  }
  const parsed = parseResult.data;

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  if (!ctx.membership) {
    return respond({ error: "Forbidden" }, 403);
  }

  const { data: message } = await supabase
    .from("chat_messages")
    .select("id, author_id, message_type, status, metadata, deleted_at")
    .eq("id", messageId)
    .eq("chat_group_id", groupId)
    .is("deleted_at", null)
    .single();

  if (!message) return respond({ error: "Form not found" }, 404);
  if (message.message_type !== "form") return respond({ error: "Message is not a form" }, 400);

  const isAuthor = message.author_id === user.id;
  if (message.status !== "approved" && !isAuthor && !ctx.canModerate) {
    return respond({ error: "Form is not available" }, 403);
  }

  const formMetadata = message.metadata as FormMetadata | null;
  let filteredResponses = parsed;

  if (formMetadata?.fields) {
    const allowedFieldIds = new Set(formMetadata.fields.map((field) => field.id));
    filteredResponses = Object.fromEntries(
      Object.entries(parsed).filter(([key]) => allowedFieldIds.has(key)),
    );

    const requiredFieldIds = formMetadata.fields
      .filter((field) => field.required)
      .map((field) => field.id);

    const missingFields = requiredFieldIds.filter((fieldId) => {
      const value = filteredResponses[fieldId];
      return value === undefined || value.trim() === "";
    });

    if (missingFields.length > 0) {
      return respond({ error: "Missing required fields", missing_fields: missingFields }, 400);
    }
  }

  const { data: existingResponse } = await supabase
    .from("chat_form_responses")
    .select("id")
    .eq("message_id", messageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existingResponse) return respond({ error: "Already submitted" }, 409);

  const { data: response, error: insertError } = await supabase
    .from("chat_form_responses")
    .insert({
      message_id: messageId,
      chat_group_id: groupId,
      organization_id: ctx.group.organization_id,
      user_id: user.id,
      responses: filteredResponses,
    })
    .select()
    .single();

  if (insertError) {
    return respond({ error: "Failed to submit response" }, 500);
  }

  return respond({ response }, 201);
}

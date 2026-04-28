import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import { baseSchemas, safeString, validateJson, ValidationError } from "@/lib/security/validation";
import { getChatGroupContext } from "@/lib/auth/chat-helpers";
import { sendPush } from "@/lib/notifications/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ groupId: string }>;
}

const sendMessageSchema = z.object({
  body: safeString(4000),
});
type SendMessageBody = z.infer<typeof sendMessageSchema>;

/**
 * POST /api/chat/[groupId]/messages
 * Send a text message in the chat group.
 * Auth: active org role + (group member OR org admin).
 * Body: { body: string }
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { groupId } = await params;

  const groupIdParsed = baseSchemas.uuid.safeParse(groupId);
  if (!groupIdParsed.success) {
    return NextResponse.json({ error: "Invalid group id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const rateLimit = checkRateLimit(req, {
    userId: user?.id ?? null,
    feature: "chat-message-send",
    limitPerIp: 60,
    limitPerUser: 40,
  });
  if (!rateLimit.ok) return buildRateLimitResponse(rateLimit);

  const respond = (payload: unknown, status = 200) =>
    NextResponse.json(payload, { status, headers: rateLimit.headers });

  if (!user) return respond({ error: "Unauthorized" }, 401);

  let parsed: SendMessageBody;
  try {
    parsed = await validateJson(req, sendMessageSchema);
  } catch (err) {
    if (err instanceof ValidationError) {
      return respond({ error: err.message, details: err.details }, 400);
    }
    return respond({ error: "Invalid request" }, 400);
  }

  const ctx = await getChatGroupContext(supabase, user.id, groupId);
  if (!ctx.ok) return respond({ error: ctx.error }, ctx.status);

  const status = ctx.group.require_approval && !ctx.canModerate ? "pending" : "approved";

  const { data: message, error: insertError } = await supabase
    .from("chat_messages")
    .insert({
      chat_group_id: groupId,
      organization_id: ctx.group.organization_id,
      author_id: user.id,
      body: parsed.body,
      status,
    })
    .select()
    .single();

  if (insertError) {
    return respond({ error: "Failed to send message" }, 500);
  }

  // Fire-and-forget push fan-out. Pending messages (require_approval=true,
  // non-moderator sender) don't notify anyone — they need approval first.
  if (status === "approved") {
    void notifyGroup({
      groupId,
      organizationId: ctx.group.organization_id,
      senderId: user.id,
      bodyText: parsed.body,
    }).catch((err) => {
      console.warn("[chat-push] fan-out failed:", err instanceof Error ? err.message : err);
    });
  }

  return respond({ message }, 201);
}

/**
 * Push fan-out for new chat messages. Uses the service client because we
 * need to read other users' tokens (RLS would block the sender).
 *
 * Excludes the sender. Gated by `chat_push_enabled` per recipient via
 * `category: "chat"` in sendPush.
 */
async function notifyGroup(input: {
  groupId: string;
  organizationId: string;
  senderId: string;
  bodyText: string;
}): Promise<void> {
  const service = createServiceClient();

  // Group display name + org slug for routing on the device.
  const [groupRow, orgRow] = await Promise.all([
    service
      .from("chat_groups")
      .select("name")
      .eq("id", input.groupId)
      .maybeSingle(),
    service
      .from("organizations")
      .select("slug")
      .eq("id", input.organizationId)
      .maybeSingle(),
  ]);

  const groupName = (groupRow.data as { name?: string } | null)?.name ?? "Chat";
  const orgSlug = (orgRow.data as { slug?: string } | null)?.slug;

  // Sender display name.
  const { data: sender } = await service
    .from("users")
    .select("name, email")
    .eq("id", input.senderId)
    .maybeSingle();
  const senderName =
    (sender as { name?: string | null; email?: string | null } | null)?.name?.trim() ||
    (sender as { name?: string | null; email?: string | null } | null)?.email?.split("@")[0] ||
    "Someone";

  // Active members in the group, excluding the sender.
  const { data: members } = await service
    .from("chat_group_members")
    .select("user_id")
    .eq("chat_group_id", input.groupId)
    .is("removed_at", null)
    .neq("user_id", input.senderId);

  const recipientIds = ((members as { user_id: string }[] | null) ?? []).map(
    (m) => m.user_id
  );
  if (recipientIds.length === 0) return;

  const preview = input.bodyText.length > 140
    ? `${input.bodyText.slice(0, 137)}...`
    : input.bodyText;

  await sendPush({
    supabase: service,
    organizationId: input.organizationId,
    targetUserIds: recipientIds,
    title: `${groupName}: ${senderName}`,
    body: preview,
    category: "chat",
    pushType: "chat",
    pushResourceId: input.groupId,
    orgSlug,
  });
}

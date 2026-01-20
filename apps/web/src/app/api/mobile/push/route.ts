import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendExpoPushNotifications, buildPushMessage } from "@/lib/expo-push";
import { checkRateLimit, buildRateLimitResponse } from "@/lib/security/rate-limit";
import {
  baseSchemas,
  optionalSafeString,
  uuidArray,
  validateJson,
  ValidationError,
  validationErrorResponse,
} from "@/lib/security/validation";
import { checkOrgReadOnly, readOnlyResponse } from "@/lib/subscription/read-only-guard";
import type { NotificationAudience, UserRole } from "@teammeet/types";

const pushNotificationSchema = z
  .object({
    organizationId: baseSchemas.uuid,
    title: baseSchemas.safeString(200),
    body: optionalSafeString(2000),
    type: z.enum(["announcement", "event"]),
    resourceId: baseSchemas.uuid,
    audience: z.enum(["members", "alumni", "both"]).optional(),
    targetUserIds: uuidArray(500).optional(),
  })
  .strict();

export async function POST(request: Request) {
  let respond: ((payload: unknown, status?: number) => ReturnType<typeof NextResponse.json>) | null = null;

  try {
    const supabase = await createClient();
    const service = createServiceClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimit = checkRateLimit(request, {
      userId: user?.id ?? null,
      feature: "mobile push",
      limitPerIp: 20,
      limitPerUser: 15,
    });

    if (!rateLimit.ok) {
      return buildRateLimitResponse(rateLimit);
    }

    respond = (payload: unknown, status = 200) =>
      NextResponse.json(payload, { status, headers: rateLimit.headers });

    if (!user) {
      return respond({ error: "Unauthorized" }, 401);
    }

    const body = await validateJson(request, pushNotificationSchema, { maxBodyBytes: 10_000 });
    const { organizationId, title, type, resourceId, audience = "both", targetUserIds } = body;
    const bodyText = body.body ?? "";

    // Check admin permission
    const { data: roleData } = await supabase
      .from("user_organization_roles")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!roleData || roleData.role !== "admin") {
      return respond({ error: "Only admins can send push notifications" }, 403);
    }

    // Check if org is in read-only mode
    const { isReadOnly } = await checkOrgReadOnly(organizationId);
    if (isReadOnly) {
      return respond(readOnlyResponse(), 403);
    }

    // Get org slug for deep linking
    const { data: org } = await service
      .from("organizations")
      .select("slug")
      .eq("id", organizationId)
      .single();

    if (!org) {
      return respond({ error: "Organization not found" }, 404);
    }

    // Determine target users based on audience
    const audienceRoles: readonly UserRole[] =
      audience === "members"
        ? ["admin", "active_member", "member"]
        : audience === "alumni"
        ? ["alumni", "viewer"]
        : ["admin", "active_member", "member", "alumni", "viewer"];

    // Get users who should receive the notification
    const membershipFilter = service
      .from("user_organization_roles")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .in("role", audienceRoles);

    const membershipsRes = targetUserIds && targetUserIds.length > 0
      ? await membershipFilter.in("user_id", targetUserIds)
      : await membershipFilter;

    const memberUserIds = (membershipsRes.data || []).map((m) => m.user_id);

    if (memberUserIds.length === 0) {
      return respond({ error: "No recipients matched the audience", sent: 0 }, 400);
    }

    // Get push tokens for these users, filtering by push_enabled preference
    const { data: tokens } = await service
      .from("user_push_tokens")
      .select("expo_push_token, user_id")
      .in("user_id", memberUserIds);

    if (!tokens || tokens.length === 0) {
      return respond({ 
        success: true, 
        sent: 0, 
        message: "No push tokens registered for target users" 
      });
    }

    // Check notification preferences (push_enabled) for each user
    const { data: prefs } = await service
      .from("notification_preferences")
      .select("user_id, push_enabled")
      .eq("organization_id", organizationId)
      .in("user_id", memberUserIds);

    const prefsMap = new Map<string, boolean>();
    (prefs || []).forEach((p) => {
      if (p.user_id) prefsMap.set(p.user_id, p.push_enabled ?? true);
    });

    // Filter tokens by preference (default to enabled if no preference set)
    const enabledTokens = tokens.filter((t) => {
      const pushEnabled = prefsMap.get(t.user_id) ?? true;
      return pushEnabled;
    });

    if (enabledTokens.length === 0) {
      return respond({
        success: true,
        sent: 0,
        message: "All target users have push notifications disabled",
      });
    }

    // Build push messages
    const messages = enabledTokens.map((t) =>
      buildPushMessage(t.expo_push_token, title, bodyText, {
        type,
        orgSlug: org.slug,
        id: resourceId,
      })
    );

    // Send push notifications
    const result = await sendExpoPushNotifications(messages);

    return respond({
      success: result.success,
      sent: result.sent,
      failed: result.failed,
      totalTargets: memberUserIds.length,
      tokensFound: tokens.length,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  } catch (err) {
    console.error("Error sending push notifications:", err);
    if (err instanceof ValidationError) {
      if (respond) {
        return respond({ error: err.message, details: err.details }, 400);
      }
      return validationErrorResponse(err);
    }
    return NextResponse.json({ error: "Failed to send push notifications" }, { status: 500 });
  }
}

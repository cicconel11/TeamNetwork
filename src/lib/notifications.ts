import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, NotificationAudience, NotificationChannel, UserRole } from "@/types/database";

export type DeliveryChannel = "email" | "sms";

export interface NotificationTarget {
  email?: string | null;
  phone?: string | null;
  channels: DeliveryChannel[];
  source: "member" | "alumni" | "user";
  id: string;
}

export interface NotificationBlastInput {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  audience: NotificationAudience;
  channel: NotificationChannel; // "email" | "sms" | "both"
  title: string;
  body: string;
  targetUserIds?: string[] | null;
}

export interface NotificationBlastResult {
  total: number;
  emailCount: number;
  smsCount: number;
  skippedMissingContact: number;
  errors: string[];
}

/**
 * Price/notification plug points:
 * - Emails: replace sendEmail implementation with Resend/SendGrid/etc.
 * - SMS: replace sendSMS with Twilio/etc.
 * - buildNotificationTargets derives per-recipient channels from preferences and requested channel.
 */

export interface EmailParams {
  to: string;
  subject: string;
  body: string;
}

export interface SMSParams {
  to: string;
  message: string;
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

const DESIRED_CHANNELS: Record<NotificationChannel, DeliveryChannel[]> = {
  email: ["email"],
  sms: ["sms"],
  both: ["email", "sms"],
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendEmail(params: EmailParams): Promise<NotificationResult> {
  console.log("[STUB] Sending email:", {
    to: params.to,
    subject: params.subject,
    body: params.body.substring(0, 100) + "...",
  });
  await delay(50);
  return { success: true, messageId: `email_${Date.now()}_${Math.random().toString(36).slice(2)}` };
}

export async function sendSMS(params: SMSParams): Promise<NotificationResult> {
  console.log("[STUB] Sending SMS:", {
    to: params.to,
    message: params.message.substring(0, 100) + "...",
  });
  await delay(50);
  return { success: true, messageId: `sms_${Date.now()}_${Math.random().toString(36).slice(2)}` };
}

type PreferenceRow = Database["public"]["Tables"]["notification_preferences"]["Row"];

const getChannelsForContact = ({
  desired,
  pref,
  email,
}: {
  desired: DeliveryChannel[];
  pref?: PreferenceRow | null;
  email?: string | null;
}) => {
  const channels: DeliveryChannel[] = [];

  const emailEnabled = pref ? pref.email_enabled && !!pref.email_address : !!email;
  const smsEnabled = pref ? pref.sms_enabled && !!pref.phone_number : false;

  if (desired.includes("email") && emailEnabled) channels.push("email");
  if (desired.includes("sms") && smsEnabled) channels.push("sms");

  const resolvedEmail = pref?.email_address || email || null;
  const resolvedPhone = pref?.phone_number || null;

  return { channels, email: resolvedEmail, phone: resolvedPhone };
};

export async function buildNotificationTargets(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  audience: NotificationAudience;
  channel: NotificationChannel;
  targetUserIds?: string[] | null;
}): Promise<{ targets: NotificationTarget[]; stats: { total: number; emailCount: number; smsCount: number; skippedMissingContact: number } }> {
  const { supabase, organizationId, audience, channel, targetUserIds } = params;
  const desired = DESIRED_CHANNELS[channel];

  // Include legacy role aliases so older memberships still receive blasts
  const audienceRoles: readonly UserRole[] =
    audience === "members"
      ? ["admin", "active_member", "member"]
      : audience === "alumni"
      ? ["alumni", "viewer"]
      : ["admin", "active_member", "member", "alumni", "viewer"];

  const normalizeRole = (role: UserRole) => {
    if (role === "member") return "active_member";
    if (role === "viewer") return "alumni";
    return role;
  };

  const membershipFilter = supabase
    .from("user_organization_roles")
    .select("user_id, role, status")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", audienceRoles);

  const [prefsRes, usersRes, membershipsRes] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("email_enabled,email_address,sms_enabled,phone_number,user_id,organization_id")
      .eq("organization_id", organizationId),
    supabase
      .from("users")
      .select("id,email,name"),
    targetUserIds && targetUserIds.length > 0 ? membershipFilter.in("user_id", targetUserIds) : membershipFilter,
  ]);

  const prefs = (prefsRes.data as PreferenceRow[] | null) || [];
  const prefByUser = new Map<string, PreferenceRow>();
  prefs.forEach((pref) => {
    if (pref.user_id) prefByUser.set(pref.user_id, pref);
  });

  const users =
    (usersRes.data as { id: string; email: string | null; name: string | null }[] | null) || [];
  const userById = new Map<string, { email: string | null }>();
  users.forEach((u) => {
    userById.set(u.id, { email: u.email });
  });

  const membershipRows =
    (membershipsRes.data as { user_id: string; role: string; status: string }[] | null) || [];

  const memberships =
    targetUserIds && targetUserIds.length > 0
      ? membershipRows.filter((m) => targetUserIds.includes(m.user_id))
      : membershipRows;

  const targets: NotificationTarget[] = [];
  let emailCount = 0;
  let smsCount = 0;
  let skippedMissingContact = 0;

  memberships.forEach((membership) => {
    const user = userById.get(membership.user_id);
    const pref = prefByUser.get(membership.user_id);
    const { channels, email, phone } = getChannelsForContact({
      desired,
      pref,
      email: user?.email || null,
    });

    if (channels.length === 0) {
      skippedMissingContact += 1;
      return;
    }

    if (channels.includes("email")) emailCount += 1;
    if (channels.includes("sms")) smsCount += 1;
    const normalizedRole = normalizeRole(membership.role as UserRole);
    targets.push({
      id: membership.user_id,
      source: normalizedRole === "alumni" ? "alumni" : "member",
      email,
      phone,
      channels,
    });
  });

  return {
    targets,
    stats: {
      total: targets.length,
      emailCount,
      smsCount,
      skippedMissingContact,
    },
  };
}

export async function sendNotificationBlast(input: NotificationBlastInput): Promise<NotificationBlastResult> {
  const { supabase, organizationId, audience, channel, title, body, targetUserIds } = input;
  const { targets, stats } = await buildNotificationTargets({
    supabase,
    organizationId,
    audience,
    channel,
    targetUserIds: targetUserIds || undefined,
  });

  const errors: string[] = [];
  let emailSent = 0;
  let smsSent = 0;

  for (const target of targets) {
    if (target.channels.includes("email") && target.email) {
      const result = await sendEmail({ to: target.email, subject: title, body });
      if (result.success) emailSent += 1;
      else if (result.error) errors.push(`Email to ${target.email}: ${result.error}`);
    }
    if (target.channels.includes("sms") && target.phone) {
      const result = await sendSMS({ to: target.phone, message: `${title}\n\n${body}` });
      if (result.success) smsSent += 1;
      else if (result.error) errors.push(`SMS to ${target.phone}: ${result.error}`);
    }
  }

  return {
    total: stats.total,
    emailCount: emailSent,
    smsCount: smsSent,
    skippedMissingContact: stats.skippedMissingContact,
    errors,
  };
}

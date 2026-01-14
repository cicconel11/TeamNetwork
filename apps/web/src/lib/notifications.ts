import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import type { Database, NotificationAudience, NotificationChannel, UserRole } from "@/types/database";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@myteamnetwork.com";

export type DeliveryChannel = "email" | "sms";

export type NotificationCategory =
  | "announcement" | "discussion" | "event" | "workout" | "competition";

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
  /** Optional notification category for per-category preference filtering. */
  category?: NotificationCategory;
  /** Optional custom email sender (e.g., Resend). Falls back to stub if not provided. */
  sendEmailFn?: (params: EmailParams) => Promise<NotificationResult>;
}

export interface NotificationBlastResult {
  total: number;
  emailCount: number;
  smsCount: number;
  skippedMissingContact: number;
  errors: string[];
}

/**
 * Notification plug points:
 * - Emails: Uses Resend API when RESEND_API_KEY is configured, otherwise falls back to stub
 * - SMS: Stub implementation - replace sendSMS with Twilio/MessageBird/etc.
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

/**
 * Runs an array of async task functions with a concurrency limit.
 * Returns results in the order tasks were provided.
 * Tasks that throw are caught and returned as { success: false, error }.
 */
async function runWithConcurrency<T extends { success: boolean; error?: string }>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        results[currentIndex] = await tasks[currentIndex]();
      } catch (err) {
        // Safely handle thrown errors without rejecting the whole batch
        const errorMsg = err instanceof Error ? err.message : String(err);
        results[currentIndex] = { success: false, error: errorMsg } as T;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function sendEmail(params: EmailParams): Promise<NotificationResult> {
  if (!resend) {
    // Fallback to stub behavior when Resend is not configured (e.g., local development)
    console.log("[STUB] Sending email (RESEND_API_KEY not configured):", {
      to: params.to,
      subject: params.subject,
      body: params.body.substring(0, 100) + "...",
    });
    await delay(50);
    return { success: true, messageId: `stub_${Date.now()}_${Math.random().toString(36).slice(2)}` };
  }

  try {
    const response = await resend.emails.send({
      from: FROM_EMAIL,
      to: params.to,
      subject: params.subject,
      text: params.body,
    });

    if (response.error) {
      console.error("Resend email error:", response.error);
      return { success: false, error: response.error.message };
    }

    return { success: true, messageId: response.data?.id };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Resend email exception:", errorMsg);
    return { success: false, error: errorMsg };
  }
}

// TODO: Replace SMS stub with actual provider integration (e.g., Twilio, MessageBird)
// SMS requires a separate provider as Resend only handles email
export async function sendSMS(params: SMSParams): Promise<NotificationResult> {
  console.log("[STUB] Sending SMS (provider not configured):", {
    to: params.to,
    message: params.message.substring(0, 100) + "...",
  });
  await delay(50);
  return { success: true, messageId: `sms_stub_${Date.now()}_${Math.random().toString(36).slice(2)}` };
}

type PreferenceRow = Database["public"]["Tables"]["notification_preferences"]["Row"];

const CATEGORY_PREF_COLUMN: Record<NotificationCategory, keyof PreferenceRow> = {
  announcement: "announcement_emails_enabled",
  discussion: "discussion_emails_enabled",
  event: "event_emails_enabled",
  workout: "workout_emails_enabled",
  competition: "competition_emails_enabled",
};

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
  category?: NotificationCategory;
}): Promise<{ targets: NotificationTarget[]; stats: { total: number; emailCount: number; smsCount: number; skippedMissingContact: number } }> {
  const { supabase, organizationId, audience, channel, targetUserIds, category } = params;
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

  // Step 1: Fetch memberships first to get the list of relevant user IDs
  const membershipFilter = supabase
    .from("user_organization_roles")
    .select("user_id, role, status")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", audienceRoles);

  const membershipsRes = targetUserIds && targetUserIds.length > 0
    ? await membershipFilter.in("user_id", targetUserIds)
    : await membershipFilter;

  const membershipRows =
    (membershipsRes.data as { user_id: string; role: string; status: string }[] | null) || [];

  const memberships =
    targetUserIds && targetUserIds.length > 0
      ? membershipRows.filter((m) => targetUserIds.includes(m.user_id))
      : membershipRows;

  // Collect member user IDs to scope subsequent queries
  const memberUserIds = memberships.map((m) => m.user_id);

  // Early return if no members match
  if (memberUserIds.length === 0) {
    return {
      targets: [],
      stats: { total: 0, emailCount: 0, smsCount: 0, skippedMissingContact: 0 },
    };
  }

  // Step 2: Fetch users and preferences scoped to member IDs only
  const [prefsRes, usersRes] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("email_enabled,email_address,sms_enabled,phone_number,user_id,organization_id,announcement_emails_enabled,discussion_emails_enabled,event_emails_enabled,workout_emails_enabled,competition_emails_enabled")
      .eq("organization_id", organizationId)
      .in("user_id", memberUserIds),
    supabase
      .from("users")
      .select("id,email,name")
      .in("id", memberUserIds),
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

    // Per-category opt-out: remove email channel if user disabled this email category
    if (category && pref) {
      const col = CATEGORY_PREF_COLUMN[category];
      if (col && pref[col] === false) {
        const emailIdx = channels.indexOf("email");
        if (emailIdx !== -1) channels.splice(emailIdx, 1);
      }
    }

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
  const { supabase, organizationId, audience, channel, title, body, targetUserIds, category, sendEmailFn } = input;
  const { targets, stats } = await buildNotificationTargets({
    supabase,
    organizationId,
    audience,
    channel,
    targetUserIds: targetUserIds || undefined,
    category,
  });

  const errors: string[] = [];
  let emailSent = 0;
  let smsSent = 0;

  const emailFn = sendEmailFn || sendEmail;

  // Build tasks for concurrent execution
  type SendResult = { type: "email" | "sms"; success: boolean; error?: string };
  const tasks: (() => Promise<SendResult>)[] = [];

  for (const target of targets) {
    if (target.channels.includes("email") && target.email) {
      const email = target.email;
      tasks.push(async () => {
        const result = await emailFn({ to: email, subject: title, body });
        return { type: "email" as const, success: result.success, error: result.error ? `Email to ${email}: ${result.error}` : undefined };
      });
    }
    if (target.channels.includes("sms") && target.phone) {
      const phone = target.phone;
      tasks.push(async () => {
        const result = await sendSMS({ to: phone, message: `${title}\n\n${body}` });
        return { type: "sms" as const, success: result.success, error: result.error ? `SMS to ${phone}: ${result.error}` : undefined };
      });
    }
  }

  // Run with concurrency limit of 10
  const results = await runWithConcurrency(tasks, 10);

  for (const r of results) {
    if (r.type === "email" && r.success) emailSent += 1;
    if (r.type === "sms" && r.success) smsSent += 1;
    if (r.error) errors.push(r.error);
  }

  return {
    total: stats.total,
    emailCount: emailSent,
    smsCount: smsSent,
    skippedMissingContact: stats.skippedMissingContact,
    errors,
  };
}

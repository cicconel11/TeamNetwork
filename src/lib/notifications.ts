import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, NotificationAudience, NotificationChannel } from "@/types/database";

export type DeliveryChannel = "email" | "sms";

export interface NotificationTarget {
  email?: string | null;
  phone?: string | null;
  channels: DeliveryChannel[];
  source: "member" | "alumni";
  id: string;
}

export interface NotificationBlastInput {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  audience: NotificationAudience;
  channel: NotificationChannel; // "email" | "sms" | "both"
  title: string;
  body: string;
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
}): Promise<{ targets: NotificationTarget[]; stats: { total: number; emailCount: number; smsCount: number; skippedMissingContact: number } }> {
  const { supabase, organizationId, audience, channel } = params;
  const desired = DESIRED_CHANNELS[channel];

  const [prefsRes, membersRes, alumniRes] = await Promise.all([
    supabase
      .from("notification_preferences")
      .select("email_enabled,email_address,sms_enabled,phone_number,user_id,organization_id")
      .eq("organization_id", organizationId),
    audience === "alumni"
      ? Promise.resolve({ data: [] })
      : supabase
          .from("members")
          .select("id,email,first_name,last_name")
          .eq("organization_id", organizationId)
          .is("deleted_at", null),
    audience === "members"
      ? Promise.resolve({ data: [] })
      : supabase
          .from("alumni")
          .select("id,email,first_name,last_name")
          .eq("organization_id", organizationId)
          .is("deleted_at", null),
  ]);

  const prefs = (prefsRes.data as PreferenceRow[] | null) || [];
  const prefByEmail = new Map<string, PreferenceRow>();
  prefs.forEach((pref) => {
    if (pref.email_address) prefByEmail.set(pref.email_address.toLowerCase(), pref);
  });

  const targets: NotificationTarget[] = [];
  let emailCount = 0;
  let smsCount = 0;
  let skippedMissingContact = 0;

  const processPerson = (record: { id: string; email: string | null }, source: "member" | "alumni") => {
    const email = record.email;
    const pref = email ? prefByEmail.get(email.toLowerCase()) : undefined;
    const { channels, email: resolvedEmail, phone } = getChannelsForContact({ desired, pref, email });
    if (channels.length === 0) {
      skippedMissingContact += 1;
      return;
    }
    if (channels.includes("email")) emailCount += 1;
    if (channels.includes("sms")) smsCount += 1;
    targets.push({
      id: record.id,
      source,
      email: resolvedEmail,
      phone,
      channels,
    });
  };

  membersRes.data?.forEach((m) => processPerson(m, "member"));
  alumniRes.data?.forEach((a) => processPerson(a, "alumni"));

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
  const { supabase, organizationId, audience, channel, title, body } = input;
  const { targets, stats } = await buildNotificationTargets({ supabase, organizationId, audience, channel });

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

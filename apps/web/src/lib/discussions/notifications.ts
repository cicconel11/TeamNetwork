import { sendNotificationBlast } from "@/lib/notifications";
import { sendPush } from "@/lib/notifications/push";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

async function resolveOrgSlug(
  supabase: SupabaseClient<Database>,
  organizationId: string
): Promise<string | undefined> {
  const { data } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", organizationId)
    .maybeSingle();
  return (data as { slug?: string } | null)?.slug ?? undefined;
}

export async function notifyNewThread(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  threadId: string;
  threadTitle: string;
  threadUrl: string;
  authorName: string;
  excludeUserId?: string;
}) {
  const { supabase, organizationId, threadId, threadTitle, threadUrl, authorName, excludeUserId } = params;

  // Email fan-out is gated by the legacy `discussion_emails_enabled` column.
  const { data: preferences } = await supabase
    .from("notification_preferences")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("discussion_emails_enabled", true);

  const emailTargetIds = (preferences ?? [])
    .map((p) => p.user_id)
    .filter((id): id is string => !!id && id !== excludeUserId);

  const orgSlug = await resolveOrgSlug(supabase, organizationId);

  const [emailResult, pushResult] = await Promise.all([
    emailTargetIds.length > 0
      ? sendNotificationBlast({
          supabase,
          organizationId,
          audience: "both",
          channel: "email",
          title: `New Discussion: ${threadTitle}`,
          body: `${authorName} started a new discussion thread.\n\nTitle: ${threadTitle}\n\nView and reply: ${threadUrl}`,
          targetUserIds: emailTargetIds,
        })
      : Promise.resolve({ emailCount: 0, errors: [] as string[] }),
    sendPush({
      supabase,
      organizationId,
      audience: "both",
      title: `New discussion: ${threadTitle}`,
      body: `${authorName} started a new discussion`,
      category: "discussion",
      pushType: "discussion",
      pushResourceId: threadId,
      orgSlug,
    }).catch((err) => ({
      sent: 0,
      queued: 0,
      skipped: 0,
      errors: [err instanceof Error ? err.message : String(err)],
    })),
  ]);

  return {
    sent: (emailResult as { emailCount: number }).emailCount + pushResult.sent,
    errors: [...(emailResult.errors ?? []), ...pushResult.errors],
  };
}

export async function notifyNewReply(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  threadId: string;
  threadTitle: string;
  authorName: string;
}) {
  const { supabase, organizationId, threadId, threadTitle, authorName } = params;

  const orgSlug = await resolveOrgSlug(supabase, organizationId);

  // Push only for replies — email fan-out for every reply would be noisy.
  // Audience: thread participants. For v1 we fan out to everyone with
  // discussion push enabled; a later pass can scope to thread participants.
  return sendPush({
    supabase,
    organizationId,
    audience: "both",
    title: `Reply: ${threadTitle}`,
    body: `${authorName} replied to "${threadTitle}"`,
    category: "discussion",
    pushType: "discussion",
    pushResourceId: threadId,
    orgSlug,
  }).catch((err) => ({
    sent: 0,
    queued: 0,
    skipped: 0,
    errors: [err instanceof Error ? err.message : String(err)],
  }));
}

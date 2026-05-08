import { sendNotificationBlast } from "@/lib/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Email blast for new discussion threads. Push notifications for both new
 * threads and replies are handled in Postgres via the
 * `enqueue_discussion_thread_push` / `enqueue_discussion_reply_push`
 * triggers — that fires uniformly whether the row was inserted from the web
 * server route or directly from the mobile client.
 */
export async function notifyNewThread(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  threadId: string;
  threadTitle: string;
  threadUrl: string;
  authorName: string;
}) {
  const { supabase, organizationId, threadTitle, threadUrl, authorName } = params;

  const { data: preferences } = await supabase
    .from("notification_preferences")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("discussion_emails_enabled", true);

  if (!preferences || preferences.length === 0) {
    return { sent: 0, errors: [] };
  }

  const targetUserIds = preferences.map((p) => p.user_id);

  const result = await sendNotificationBlast({
    supabase,
    organizationId,
    audience: "both",
    channel: "email",
    title: `New Discussion: ${threadTitle}`,
    body: `${authorName} started a new discussion thread.\n\nTitle: ${threadTitle}\n\nView and reply: ${threadUrl}`,
    targetUserIds,
    category: "discussion",
  });

  return {
    sent: result.emailCount,
    errors: result.errors,
  };
}

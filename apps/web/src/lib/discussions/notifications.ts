import { sendNotificationBlast } from "@/lib/notifications";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export async function notifyNewThread(params: {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  threadTitle: string;
  threadUrl: string;
  authorName: string;
}) {
  const { supabase, organizationId, threadTitle, threadUrl, authorName } = params;

  // Fetch users who have discussion_emails_enabled
  const { data: preferences } = await supabase
    .from("notification_preferences")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("discussion_emails_enabled", true);

  if (!preferences || preferences.length === 0) {
    return { sent: 0, errors: [] };
  }

  const targetUserIds = preferences.map((p) => p.user_id);

  // Send notification blast to users with discussion emails enabled
  const result = await sendNotificationBlast({
    supabase,
    organizationId,
    audience: "both",
    channel: "email",
    title: `New Discussion: ${threadTitle}`,
    body: `${authorName} started a new discussion thread.\n\nTitle: ${threadTitle}\n\nView and reply: ${threadUrl}`,
    targetUserIds,
  });

  return {
    sent: result.emailCount,
    errors: result.errors,
  };
}

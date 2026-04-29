/**
 * Audit-log a notification send to `public.notifications`.
 *
 * The notifications table is the canonical "what was sent" surface used by
 * the admin notifications dashboard. Every dispatcher run (Expo + APNs) writes
 * a row here with `kind` so admins can trace LA / standard / wallet sends from
 * one place.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

interface AuditNotificationSendInput {
  organizationId: string;
  kind: string;
  title: string;
  body: string;
  audience?: string | null;
  targetUserIds?: string[] | null;
  sentAt: string;
}

export async function auditNotificationSend(
  supabase: SupabaseClient<Database>,
  input: AuditNotificationSendInput,
): Promise<void> {
  // Cast because `notifications.kind` ships in migration
  // 20261110000003_notifications_kind_audit_column.sql; regenerate types via
  // `bun run gen:types` to remove this cast.
  const row = {
    organization_id: input.organizationId,
    channel: "push",
    audience: input.audience ?? "members",
    target_user_ids: input.targetUserIds ?? null,
    title: input.title,
    body: input.body,
    sent_at: input.sentAt,
    kind: input.kind,
  } as unknown as Database["public"]["Tables"]["notifications"]["Insert"];

  const { error } = await supabase.from("notifications").insert(row);
  if (error) {
    // Audit logging failures should not block dispatch; surface in logs only.
    console.warn(
      `[notifications.audit] insert failed for org=${input.organizationId} kind=${input.kind}: ${error.message}`,
    );
  }
}

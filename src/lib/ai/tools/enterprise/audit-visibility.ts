/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ListEnterpriseAuditEventsArgs {
  organization_id?: string;
  limit?: number;
}

type EnterpriseToolSupabase = any;

interface AuditLogRow {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_email_redacted: string | null;
  enterprise_id: string;
  organization_id: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface AdoptionRequestRow {
  id: string;
  enterprise_id: string;
  organization_id: string;
  requested_by: string | null;
  requested_at: string;
  status: string;
  responded_by: string | null;
  responded_at: string | null;
  expires_at: string | null;
}

export interface AuditVisibilityEvent {
  source: "audit_log" | "adoption_request";
  id: string;
  created_at: string;
  action: string;
  actor_user_id: string | null;
  actor_email_redacted: string | null;
  organization_id: string | null;
  target_type: string | null;
  target_id: string | null;
  status: string | null;
  responded_at: string | null;
  metadata: Record<string, unknown> | null;
}

export async function listEnterpriseAuditEvents(
  serviceSupabase: EnterpriseToolSupabase,
  enterpriseId: string,
  args: ListEnterpriseAuditEventsArgs,
) {
  const limit = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const organizationFilter =
    typeof args.organization_id === "string" && args.organization_id.length > 0
      ? args.organization_id
      : null;

  const buildAuditQuery = () => {
    let query = serviceSupabase
      .from("enterprise_audit_logs")
      .select(
        "id, action, actor_user_id, actor_email_redacted, enterprise_id, organization_id, target_type, target_id, metadata, created_at",
      )
      .eq("enterprise_id", enterpriseId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (organizationFilter) {
      query = query.eq("organization_id", organizationFilter);
    }
    return query;
  };

  const buildAdoptionQuery = () => {
    let query = serviceSupabase
      .from("enterprise_adoption_requests")
      .select(
        "id, enterprise_id, organization_id, requested_by, requested_at, status, responded_by, responded_at, expires_at",
      )
      .eq("enterprise_id", enterpriseId)
      .order("requested_at", { ascending: false })
      .limit(limit);
    if (organizationFilter) {
      query = query.eq("organization_id", organizationFilter);
    }
    return query;
  };

  const [auditResult, adoptionResult] = await Promise.all([
    buildAuditQuery(),
    buildAdoptionQuery(),
  ]);

  if (auditResult.error) {
    return { data: null, error: auditResult.error };
  }
  if (adoptionResult.error) {
    return { data: null, error: adoptionResult.error };
  }

  const auditRows: AuditLogRow[] = Array.isArray(auditResult.data) ? auditResult.data : [];
  const adoptionRows: AdoptionRequestRow[] = Array.isArray(adoptionResult.data)
    ? adoptionResult.data
    : [];

  const events: AuditVisibilityEvent[] = [
    ...auditRows.map((row): AuditVisibilityEvent => ({
      source: "audit_log",
      id: row.id,
      created_at: row.created_at,
      action: row.action,
      actor_user_id: row.actor_user_id,
      actor_email_redacted: row.actor_email_redacted,
      organization_id: row.organization_id,
      target_type: row.target_type,
      target_id: row.target_id,
      status: null,
      responded_at: null,
      metadata: row.metadata,
    })),
    ...adoptionRows.map((row): AuditVisibilityEvent => ({
      source: "adoption_request",
      id: row.id,
      created_at: row.requested_at,
      action: `adoption_${row.status}`,
      actor_user_id: row.requested_by,
      actor_email_redacted: null,
      organization_id: row.organization_id,
      target_type: "organization",
      target_id: row.organization_id,
      status: row.status,
      responded_at: row.responded_at,
      metadata: {
        requested_by: row.requested_by,
        responded_by: row.responded_by,
        expires_at: row.expires_at,
      },
    })),
  ]
    .sort((a, b) => (b.created_at < a.created_at ? -1 : b.created_at > a.created_at ? 1 : 0))
    .slice(0, limit);

  return {
    data: {
      limit,
      total: events.length,
      events,
    },
    error: null,
  };
}

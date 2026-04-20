import { createServiceClient } from "@/lib/supabase/service";

export type DsrRequestType = "inspect" | "correct" | "delete" | "export";
export type DsrRequestStatus = "received" | "acknowledged" | "in_progress" | "resolved" | "cancelled";
export type DsrRequestSource = "parent_direct" | "school_relay" | "student_self" | "admin_entered";
export type DsrRequestRelationship =
  | "student"
  | "eligible_student"
  | "parent"
  | "guardian"
  | "school_official"
  | "administrator"
  | "other";
export type DsrMethod = "email" | "portal" | "school_relay" | "phone" | "in_person" | "other";
export type DsrIdentifierType = "email" | "student_id" | "alumni_id";

export interface CreateDsrRequestInput {
  organizationId?: string | null;
  schoolOwnerUserId?: string | null;
  subjectUserId?: string | null;
  subjectIdentifier?: string | null;
  subjectIdentifierType?: DsrIdentifierType | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  requesterRelationship: DsrRequestRelationship;
  requestType: DsrRequestType;
  source: DsrRequestSource;
  status?: DsrRequestStatus;
  acknowledgementMethod?: DsrMethod | null;
  resolutionMethod?: DsrMethod | null;
  receivedAt?: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  ackDueAt?: string;
  resolveDueAt?: string;
  resolutionNotes?: string | null;
  linkedDeletionRequestId?: string | null;
  linkedAccessLogId?: string | null;
}

export interface DsrDueSoonRow {
  id: string;
  organization_id: string;
  school_owner_user_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_relationship: DsrRequestRelationship;
  request_type: DsrRequestType;
  source: DsrRequestSource;
  status: Exclude<DsrRequestStatus, "resolved" | "cancelled">;
  received_at: string;
  acknowledged_at: string | null;
  ack_due_at: string;
  resolve_due_at: string;
  due_phase: "acknowledgement" | "resolution";
  due_at: string;
}

export async function createDsrRequest(input: CreateDsrRequestInput): Promise<void> {
  const supabase = createServiceClient();
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const ackDueAt =
    input.ackDueAt ??
    new Date(Date.parse(receivedAt) + (10 * 24 * 60 * 60 * 1000)).toISOString();
  const resolveDueAt =
    input.resolveDueAt ??
    new Date(Date.parse(receivedAt) + (45 * 24 * 60 * 60 * 1000)).toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from("dsr_requests")
    .insert({
      organization_id: input.organizationId ?? null,
      school_owner_user_id: input.schoolOwnerUserId ?? null,
      subject_user_id: input.subjectUserId ?? null,
      subject_identifier: input.subjectIdentifier ?? null,
      subject_identifier_type: input.subjectIdentifierType ?? null,
      requester_name: input.requesterName ?? null,
      requester_email: input.requesterEmail ?? null,
      requester_relationship: input.requesterRelationship,
      request_type: input.requestType,
      source: input.source,
      status: input.status ?? "received",
      acknowledgement_method: input.acknowledgementMethod ?? null,
      resolution_method: input.resolutionMethod ?? null,
      received_at: receivedAt,
      acknowledged_at: input.acknowledgedAt ?? null,
      resolved_at: input.resolvedAt ?? null,
      ack_due_at: ackDueAt,
      resolve_due_at: resolveDueAt,
      resolution_notes: input.resolutionNotes ?? null,
      linked_deletion_request_id: input.linkedDeletionRequestId ?? null,
      linked_access_log_id: input.linkedAccessLogId ?? null,
    });

  if (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "42P01") {
      console.warn("[compliance/dsr] dsr_requests table is not available yet");
      return;
    }

    throw error;
  }
}

export async function getDsrRequestsDueSoon(
  orgId: string,
  windowDays = 7,
): Promise<DsrDueSoonRow[]> {
  const supabase = createServiceClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("get_dsr_requests_due_soon", {
    p_org_id: orgId,
    p_window_days: windowDays,
  });

  if (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "42883") {
      return [];
    }

    throw error;
  }

  return (data ?? []) as DsrDueSoonRow[];
}

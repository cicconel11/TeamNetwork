export type ScheduleFileToolErrorCode =
  | "attachment_required"
  | "invalid_attachment_path"
  | "org_context_failed"
  | "attachment_unavailable"
  | "image_too_large"
  | "image_timeout"
  | "image_unreadable"
  | "image_model_misconfigured"
  | "pdf_unreadable"
  | "pdf_timeout";

export type ToolExecutionErrorCode =
  | ScheduleFileToolErrorCode
  | "enterprise_billing_role_required"
  | "enterprise_invite_role_required"
  | "pending_action_revise_limit"
  | "pending_action_not_pending"
  | "pending_action_conflict";

export type ToolExecutionResult =
  | { kind: "ok"; data: unknown }
  | { kind: "forbidden"; error: "Forbidden" }
  | { kind: "auth_error"; error: "Auth check failed" }
  | { kind: "tool_error"; error: string; code?: ToolExecutionErrorCode }
  | { kind: "timeout"; error: "Tool timed out" };

export function toolError(
  error: string,
  code?: ToolExecutionErrorCode
): ToolExecutionResult {
  return code ? { kind: "tool_error", error, code } : { kind: "tool_error", error };
}

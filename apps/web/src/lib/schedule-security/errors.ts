export type ScheduleSecurityErrorCode =
  | "allowlist_pending"
  | "allowlist_blocked"
  | "allowlist_denied"
  | "invalid_url"
  | "invalid_port"
  | "private_ip"
  | "localhost"
  | "too_many_redirects"
  | "fetch_failed"
  | "response_too_large";

export class ScheduleSecurityError extends Error {
  code: ScheduleSecurityErrorCode;
  constructor(code: ScheduleSecurityErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

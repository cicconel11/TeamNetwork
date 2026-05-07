import type { OrgRole } from "@/lib/auth/role-utils";
import type { EnterpriseRole } from "@/types/enterprise";
import { AI_TOOL_MAP, type ToolName } from "./tools/definitions";

export type AiActorRole = OrgRole;

export interface AiAccessDecisionInput {
  role: AiActorRole;
  enterpriseRole?: EnterpriseRole;
}

export interface AiToolAccessInput extends AiAccessDecisionInput {
  toolName: ToolName;
}

export type AiAccessDenialReason =
  | "member_access_kill_switch"
  | "parent_role_disabled"
  | "role_not_allowed_for_tool"
  | "enterprise_tool_requires_admin";

export type AiAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: AiAccessDenialReason };

const ADMIN_ALLOWED_TOOLS: readonly ToolName[] = Object.freeze(
  Object.keys(AI_TOOL_MAP) as ToolName[],
);

const ACTIVE_MEMBER_ALLOWED_TOOLS: readonly ToolName[] = Object.freeze([
  "list_announcements",
  "list_events",
  "list_discussions",
  "list_job_postings",
  "list_chat_groups",
  "list_philanthropy_events",
  "find_navigation_targets",
  "search_org_content",
]);

const ALUMNI_ALLOWED_TOOLS: readonly ToolName[] = Object.freeze([
  "list_announcements",
  "list_events",
  "find_navigation_targets",
  "search_org_content",
]);

const PARENT_ALLOWED_TOOLS: readonly ToolName[] = Object.freeze([]);

const ENTERPRISE_TOOL_NAMES: ReadonlySet<ToolName> = new Set<ToolName>([
  "list_enterprise_alumni",
  "get_enterprise_stats",
  "list_managed_orgs",
  "get_enterprise_quota",
  "get_enterprise_org_capacity",
  "list_enterprise_audit_events",
  "prepare_enterprise_invite",
  "revoke_enterprise_invite",
]);

function roleAllowlist(role: AiActorRole): readonly ToolName[] {
  switch (role) {
    case "admin":
      return ADMIN_ALLOWED_TOOLS;
    case "active_member":
      return ACTIVE_MEMBER_ALLOWED_TOOLS;
    case "alumni":
      return ALUMNI_ALLOWED_TOOLS;
    case "parent":
      return PARENT_ALLOWED_TOOLS;
  }
}

/**
 * Global kill switch for non-admin AI access. Defaults to ON (non-admin blocked)
 * until member rollout is ready. Flip by setting env `AI_MEMBER_ACCESS_KILL=0`.
 */
export function isMemberAccessKilled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.AI_MEMBER_ACCESS_KILL;
  if (raw == null) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "off") {
    return false;
  }
  return true;
}

function gateNonAdmin(input: AiAccessDecisionInput): AiAccessDecision | null {
  if (input.role === "admin") return null;
  if (isMemberAccessKilled()) {
    return { allowed: false, reason: "member_access_kill_switch" };
  }
  if (input.role === "parent") {
    return { allowed: false, reason: "parent_role_disabled" };
  }
  return null;
}

export function isToolAllowed(input: AiToolAccessInput): AiAccessDecision {
  const gated = gateNonAdmin(input);
  if (gated) return gated;

  if (ENTERPRISE_TOOL_NAMES.has(input.toolName) && input.role !== "admin") {
    return { allowed: false, reason: "enterprise_tool_requires_admin" };
  }

  const allowlist = roleAllowlist(input.role);
  if (!allowlist.includes(input.toolName)) {
    return { allowed: false, reason: "role_not_allowed_for_tool" };
  }

  return { allowed: true };
}

export function getAllowedTools(input: AiAccessDecisionInput): ToolName[] {
  const gated = gateNonAdmin(input);
  if (gated) return [];

  const base = [...roleAllowlist(input.role)];
  if (input.role !== "admin") {
    return base.filter((name) => !ENTERPRISE_TOOL_NAMES.has(name));
  }
  return base;
}

export function filterAllowedTools<T extends { function: { name: string } }>(
  tools: readonly T[] | undefined,
  input: AiAccessDecisionInput,
): T[] | undefined {
  if (!tools) return tools;
  const allowed = new Set(getAllowedTools(input));
  return tools.filter((tool) => allowed.has(tool.function.name as ToolName));
}

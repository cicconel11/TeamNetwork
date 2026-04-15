import type OpenAI from "openai";

/**
 * Enterprise-scope AI tools (Phase 1, read-only).
 *
 * Executor filters all queries by server-validated ctx.enterpriseId. LLM-supplied
 * enterprise_id / actor_user_id fields are stripped by Zod .strict() in the executor.
 */
const TOOL_BY_NAME = {
  get_enterprise_stats: {
    type: "function" as const,
    function: {
      name: "get_enterprise_stats" as const,
      description:
        "Get enterprise-wide aggregate stats: total alumni across all sub-orgs, sub-org count, enterprise-managed org count. Reads from enterprise_alumni_counts view.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  list_enterprise_orgs: {
    type: "function" as const,
    function: {
      name: "list_enterprise_orgs" as const,
      description:
        "List organizations in this enterprise. Returns id, slug, name, relationship type, and adoption timestamp.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 100,
            description: "Max results (default 50)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  search_enterprise_alumni: {
    type: "function" as const,
    function: {
      name: "search_enterprise_alumni" as const,
      description:
        "Search alumni across all orgs in this enterprise. Filters: grad_year, major, company, city. Returns masked name initials plus org and profile metadata.",
      parameters: {
        type: "object" as const,
        properties: {
          graduation_year: { type: "integer" as const },
          major: { type: "string" as const },
          current_company: { type: "string" as const },
          current_city: { type: "string" as const },
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 50,
            description: "Max results (default 20)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  get_subscription_status: {
    type: "function" as const,
    function: {
      name: "get_subscription_status" as const,
      description:
        "Get enterprise billing/subscription status: status, billing_interval, current_period_end, grace_period_ends_at, sub_org_quantity, alumni_bucket_quantity.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  get_enterprise_details: {
    type: "function" as const,
    function: {
      name: "get_enterprise_details" as const,
      description:
        "Get core enterprise details: name, slug, description, billing contact email, created_at.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
  get_enterprise_admins: {
    type: "function" as const,
    function: {
      name: "get_enterprise_admins" as const,
      description:
        "List enterprise admins (owner, billing_admin, org_admin). Returns user_id, email, role, created_at.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
} as const;

export const ENTERPRISE_AI_TOOLS = [
  TOOL_BY_NAME.get_enterprise_stats,
  TOOL_BY_NAME.list_enterprise_orgs,
  TOOL_BY_NAME.search_enterprise_alumni,
  TOOL_BY_NAME.get_subscription_status,
  TOOL_BY_NAME.get_enterprise_details,
  TOOL_BY_NAME.get_enterprise_admins,
] as const satisfies readonly OpenAI.Chat.ChatCompletionTool[];

export type EnterpriseToolName = (typeof ENTERPRISE_AI_TOOLS)[number]["function"]["name"];

export const ENTERPRISE_TOOL_NAMES: ReadonlySet<string> = new Set<EnterpriseToolName>(
  ENTERPRISE_AI_TOOLS.map((t) => t.function.name)
);

export const ENTERPRISE_AI_TOOL_MAP = TOOL_BY_NAME;

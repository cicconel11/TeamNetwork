import type OpenAI from "openai";

export interface ListMembersArgs {
  limit?: number;
}

export interface ListEventsArgs {
  limit?: number;
  upcoming?: boolean;
}

export type GetOrgStatsArgs = Record<string, never>;

export const AI_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_members" as const,
      description:
        "List active organization members. Returns name, email, role, and join date. Use for questions about who is in the org, member counts, or searching for people. Only returns active members — alumni and parents are tracked separately.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 50,
            description: "Max results to return (default 20)",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_events" as const,
      description:
        "List organization events. Returns title, date, location, and description. Use for questions about upcoming or past events.",
      parameters: {
        type: "object" as const,
        properties: {
          limit: {
            type: "integer" as const,
            minimum: 1,
            maximum: 25,
            description: "Max results to return (default 10)",
          },
          upcoming: {
            type: "boolean" as const,
            description:
              "If true, only future events. If false, only past events. Default true.",
          },
        },
        additionalProperties: false as const,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_org_stats" as const,
      description:
        "Get organization statistics: active member count, alumni count, parent count, upcoming event count, and donation totals. Use for overview or dashboard style questions.",
      parameters: {
        type: "object" as const,
        properties: {},
        additionalProperties: false as const,
      },
    },
  },
] as const satisfies readonly OpenAI.Chat.ChatCompletionTool[];

// Derived from AI_TOOLS — no manual union to maintain
export type ToolName = (typeof AI_TOOLS)[number]["function"]["name"];

export const TOOL_NAMES: ReadonlySet<string> = new Set<ToolName>(
  AI_TOOLS.map((t) => t.function.name)
);

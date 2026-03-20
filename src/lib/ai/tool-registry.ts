import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Context passed to every tool execution.
 *
 * SCOPING CONTRACT (enforced by convention + tests):
 * - Every tool's `execute` MUST filter all Supabase queries by `ctx.orgId`.
 * - Every query on tables with `deleted_at` MUST include `.is("deleted_at", null)`.
 * - Tools use the service client which bypasses RLS — `ctx.orgId` is the ONLY
 *   protection against cross-org data leakage.
 * - Tool tests MUST include a cross-org isolation assertion.
 */
export interface AiToolContext {
  orgId: string;
  userId: string;
  serviceSupabase: SupabaseClient;
}

/**
 * The result returned by a tool's `execute` function.
 *
 * - `data`: raw structured data (passed back to the AI as tool output)
 * - `prose`: optional human-readable summary (may be shown in UI)
 * - `error`: if set, execution failed; `data` will be `null`
 */
export interface AiToolResult {
  data: unknown;
  prose?: string;
  error?: string;
}

/**
 * A single AI tool definition.
 *
 * SCOPING CONTRACT: `execute` MUST filter all queries by `ctx.orgId`.
 * See `AiToolContext` for full scoping rules.
 */
export interface AiTool {
  name: string;
  description: string;
  /** JSON Schema object describing the tool's input parameters. */
  parameters: Record<string, unknown>;
  execute: (
    args: Record<string, unknown>,
    ctx: AiToolContext
  ) => Promise<AiToolResult>;
}

/** OpenAI-compatible function definition (no `execute` callback). */
export interface AiFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiToolRegistry {
  /** Register a tool. Overwrites any existing tool with the same name. */
  register(tool: AiTool): void;
  /** Retrieve a tool by name. Returns `null` if not found. */
  get(name: string): AiTool | null;
  /** List all registered tools. */
  list(): AiTool[];
  /**
   * Execute a named tool with the given args and context.
   *
   * Returns `{ data: null, error: "Unknown tool: <name>" }` when the tool is
   * not registered. Throws if the tool's `execute` function throws.
   */
  execute(
    name: string,
    args: Record<string, unknown>,
    ctx: AiToolContext
  ): Promise<AiToolResult>;
  /**
   * Convert registered tools to OpenAI-compatible function definitions.
   * The `execute` callback is intentionally excluded.
   */
  toFunctionDefinitions(): AiFunctionDefinition[];
}

export function createToolRegistry(): AiToolRegistry {
  const tools = new Map<string, AiTool>();

  return {
    register(tool: AiTool): void {
      tools.set(tool.name, tool);
    },

    get(name: string): AiTool | null {
      return tools.get(name) ?? null;
    },

    list(): AiTool[] {
      return Array.from(tools.values());
    },

    async execute(
      name: string,
      args: Record<string, unknown>,
      ctx: AiToolContext
    ): Promise<AiToolResult> {
      const tool = tools.get(name);
      if (!tool) {
        return { data: null, error: `Unknown tool: ${name}` };
      }
      return tool.execute(args, ctx);
    },

    toFunctionDefinitions(): AiFunctionDefinition[] {
      return Array.from(tools.values()).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }));
    },
  };
}

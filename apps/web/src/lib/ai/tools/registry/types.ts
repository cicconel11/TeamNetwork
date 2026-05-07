import type { z } from "zod";
import type { AiLogContext } from "@/lib/ai/logger";
import type { ToolExecutionAuthorization, ToolExecutionContext } from "@/lib/ai/tools/executor";
import type { ToolExecutionResult } from "@/lib/ai/tools/result";

// Mirrors executor.ts local `SB = any` — the supabase query builder relies on
// thenable behavior that the strict client type strips out. Tightening is
// deferred to U12 when the executor's typed boundary is rebuilt.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

/**
 * `ctx.authorization` is a discriminated union on `kind` (see
 * `ToolExecutionAuthorization`); use `kind` in module code when you need
 * preverified role data vs membership validation.
 */
export interface ToolModuleRunContext {
  ctx: ToolExecutionContext;
  sb: SB;
  logContext: AiLogContext;
}

export type { ToolExecutionAuthorization };

export interface ToolModule<A = unknown> {
  name: string;
  /** Input validation schema; outputs are parsed before `execute`. */
  argsSchema: z.ZodType<unknown>;
  /** Optional product hook for which UI surfaces may attach the tool; not yet wired. */
  surfaces?: string[];
  execute(args: A, run: ToolModuleRunContext): Promise<ToolExecutionResult>;
}

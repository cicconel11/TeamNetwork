import type { z } from "zod";
import type { AiLogContext } from "@/lib/ai/logger";
import type { ToolExecutionContext } from "@/lib/ai/tools/executor";
import type { ToolExecutionResult } from "@/lib/ai/tools/result";

// Mirrors executor.ts local `SB = any` — the supabase query builder relies on
// thenable behavior that the strict client type strips out. Tightening is
// deferred to U12 when the executor's typed boundary is rebuilt.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any;

export interface ToolModuleRunContext {
  ctx: ToolExecutionContext;
  sb: SB;
  logContext: AiLogContext;
}

export interface ToolModule<A> {
  name: string;
  argsSchema: z.ZodType<A>;
  execute(args: A, run: ToolModuleRunContext): Promise<ToolExecutionResult>;
}

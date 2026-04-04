export interface AiLogContext {
  requestId: string;
  orgId: string;
  threadId?: string;
  userId?: string;
}

export function aiLog(
  level: "warn" | "error" | "info",
  module: string,
  message: string,
  ctx: AiLogContext,
  extra?: Record<string, unknown>
): void {
  const method = level === "info" ? "log" : level;
  console[method](`[${module}] ${message}`, {
    requestId: ctx.requestId,
    orgId: ctx.orgId,
    ...(ctx.threadId ? { threadId: ctx.threadId } : {}),
    ...(ctx.userId ? { userId: ctx.userId } : {}),
    ...(extra ?? {}),
  });
}

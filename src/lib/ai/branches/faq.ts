import type { SSEEvent } from "../sse";

export async function handleFaqBranch(
  _message: string,
  _threadId: string,
  _ctx: { orgId: string; userId: string; serviceSupabase: any }
): Promise<SSEEvent[]> {
  return [
    { type: "chunk", content: "FAQ features are coming soon. This will help answer questions about platform features and organization policies." },
  ];
}

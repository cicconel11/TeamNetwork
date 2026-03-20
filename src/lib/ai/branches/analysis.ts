import type { SSEEvent } from "../sse";

export async function handleAnalysisBranch(
  _message: string,
  _threadId: string,
  _ctx: { orgId: string; userId: string; serviceSupabase: any }
): Promise<SSEEvent[]> {
  return [
    { type: "chunk", content: "Analysis features are coming soon. This will allow you to query member stats, event data, and organization analytics." },
  ];
}

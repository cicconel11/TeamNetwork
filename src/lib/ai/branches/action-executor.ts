import type { SSEEvent } from "../sse";

export async function handleActionBranch(
  _message: string,
  _threadId: string,
  _ctx: { orgId: string; userId: string; serviceSupabase: any }
): Promise<SSEEvent[]> {
  return [
    { type: "chunk", content: "Action features are coming soon. This will allow you to perform organization management tasks through the assistant." },
  ];
}

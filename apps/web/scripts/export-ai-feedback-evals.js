// Export reviewable AI eval candidates from negative ai_feedback rows.
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... npm run evals:ai:feedback
const { createClient } = require("@supabase/supabase-js");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const limit = Number.parseInt(process.env.AI_FEEDBACK_EVAL_LIMIT || "50", 10);

if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

async function main() {
  const { buildFeedbackEvalCandidates } = await import("../src/lib/ai/feedback-evals.ts");
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: feedbackRows, error } = await supabase
    .from("ai_feedback")
    .select("id, message_id, user_id, rating, comment, created_at")
    .eq("rating", "negative")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = [];
  for (const feedback of feedbackRows || []) {
    const assistantMessage = await maybeSingle(
      supabase
        .from("ai_messages")
        .select("id, thread_id, org_id, user_id, role, content, tool_calls, created_at")
        .eq("id", feedback.message_id)
        .eq("role", "assistant")
        .maybeSingle()
    );
    if (!assistantMessage) continue;

    const thread = await maybeSingle(
      supabase
        .from("ai_threads")
        .select("id, org_id, user_id, surface")
        .eq("id", assistantMessage.thread_id)
        .maybeSingle()
    );
    if (!thread) continue;

    const userMessage = await maybeSingle(
      supabase
        .from("ai_messages")
        .select("id, content, intent, intent_type, context_surface, created_at")
        .eq("thread_id", assistantMessage.thread_id)
        .eq("role", "user")
        .lte("created_at", assistantMessage.created_at)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    const audit = await maybeSingle(
      supabase
        .from("ai_audit_log")
        .select("id, intent, intent_type, context_surface, tool_calls, safety_verdict, rag_grounded, write_action_id, write_action_status")
        .eq("message_id", assistantMessage.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    );

    rows.push({
      feedback,
      thread,
      userMessage,
      assistantMessage,
      audit,
    });
  }

  process.stdout.write(`${JSON.stringify(buildFeedbackEvalCandidates(rows), null, 2)}\n`);
}

async function maybeSingle(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data ?? null;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

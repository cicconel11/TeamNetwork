import { randomUUID } from "node:crypto";
import { buildPromptContext } from "@/lib/ai/context-builder";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { composeResponse } from "@/lib/ai/response-composer";
import { formatActivityLeaderboard, type OrgActivityRow } from "@/lib/ai/smoke-helpers";
import { createServiceClient } from "@/lib/supabase/service";

type RoleRow = {
  user_id: string;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
};

type AuthorRow = {
  author_id: string;
};

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function usage(): never {
  console.error(
    [
      "Usage:",
      "  npm run ai:smoke -- --org <slug-or-id> --question \"What's going on here?\" [--include-activity] [--shared-static] [--dry-run]",
      "",
      "Examples:",
      "  npm run ai:smoke -- --org upenn-sprint-football --question \"What's going on in this organization?\"",
      "  npm run ai:smoke -- --org upenn-sprint-football --question \"Who has been the most active?\" --include-activity",
    ].join("\n")
  );
  process.exit(1);
}

async function fetchOrganization(orgRef: string): Promise<OrganizationRow> {
  const supabase = createServiceClient();

  const query = supabase
    .from("organizations")
    .select("id, name, slug")
    .limit(1);

  const { data, error } = orgRef.includes("-")
    ? await query.or(`id.eq.${orgRef},slug.eq.${orgRef}`)
    : await query.eq("slug", orgRef);

  if (error || !data || data.length === 0) {
    throw new Error(`Could not find organization for "${orgRef}"`);
  }

  return data[0];
}

async function fetchAdminUserId(orgId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("user_organization_roles")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin")
    .eq("status", "active")
    .limit(1)
    .returns<RoleRow[]>();

  if (error) {
    throw new Error(`Failed to load admin user: ${error.message}`);
  }

  return data[0]?.user_id ?? null;
}

function countAuthors(rows: AuthorRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.author_id, (counts.get(row.author_id) ?? 0) + 1);
  }
  return counts;
}

async function fetchActivityRows(orgId: string): Promise<OrgActivityRow[]> {
  const supabase = createServiceClient();

  const [
    feedPosts,
    feedComments,
    chatMessages,
    discussionThreads,
    discussionReplies,
  ] = await Promise.all([
    supabase
      .from("feed_posts")
      .select("author_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .returns<AuthorRow[]>(),
    supabase
      .from("feed_comments")
      .select("author_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .returns<AuthorRow[]>(),
    supabase
      .from("chat_messages")
      .select("author_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .returns<AuthorRow[]>(),
    supabase
      .from("discussion_threads")
      .select("author_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .returns<AuthorRow[]>(),
    supabase
      .from("discussion_replies")
      .select("author_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .returns<AuthorRow[]>(),
  ]);

  for (const result of [feedPosts, feedComments, chatMessages, discussionThreads, discussionReplies]) {
    if (result.error) {
      throw new Error(`Failed to load activity data: ${result.error.message}`);
    }
  }

  const feedPostCounts = countAuthors(feedPosts.data ?? []);
  const feedCommentCounts = countAuthors(feedComments.data ?? []);
  const chatMessageCounts = countAuthors(chatMessages.data ?? []);
  const discussionThreadCounts = countAuthors(discussionThreads.data ?? []);
  const discussionReplyCounts = countAuthors(discussionReplies.data ?? []);

  const userIds = new Set([
    ...feedPostCounts.keys(),
    ...feedCommentCounts.keys(),
    ...chatMessageCounts.keys(),
    ...discussionThreadCounts.keys(),
    ...discussionReplyCounts.keys(),
  ]);

  if (userIds.size === 0) {
    return [];
  }

  const { data: users, error: userError } = await supabase
    .from("users")
    .select("id, name, email")
    .in("id", Array.from(userIds));

  if (userError) {
    throw new Error(`Failed to load user activity labels: ${userError.message}`);
  }

  const usersById = new Map(
    (users ?? []).map((user) => [user.id, user] as const)
  );

  return Array.from(userIds)
    .map((userId) => {
      const user = usersById.get(userId);
      const feed_posts = feedPostCounts.get(userId) ?? 0;
      const feed_comments = feedCommentCounts.get(userId) ?? 0;
      const chat_messages = chatMessageCounts.get(userId) ?? 0;
      const discussion_threads = discussionThreadCounts.get(userId) ?? 0;
      const discussion_replies = discussionReplyCounts.get(userId) ?? 0;
      const total_activity =
        feed_posts +
        feed_comments +
        chat_messages +
        discussion_threads +
        discussion_replies;

      return {
        name: user?.name ?? null,
        email: user?.email ?? null,
        feed_posts,
        feed_comments,
        chat_messages,
        discussion_threads,
        discussion_replies,
        total_activity,
      };
    })
    .sort((a, b) => b.total_activity - a.total_activity || (a.name ?? "").localeCompare(b.name ?? ""));
}

async function main() {
  const orgRef = getArg("--org");
  const question = getArg("--question");

  if (!orgRef || !question) {
    usage();
  }

  const includeActivity = hasFlag("--include-activity");
  const dryRun = hasFlag("--dry-run");
  const requestedSharedStatic = hasFlag("--shared-static");

  const organization = await fetchOrganization(orgRef);
  const adminUserId = await fetchAdminUserId(organization.id);
  const contextMode =
    requestedSharedStatic || !adminUserId ? "shared_static" : "full";

  const { systemPrompt, orgContextMessage } = await buildPromptContext({
    orgId: organization.id,
    userId: adminUserId ?? randomUUID(),
    role: "admin",
    serviceSupabase: createServiceClient(),
    contextMode,
  });

  const activityRows = includeActivity
    ? await fetchActivityRows(organization.id)
    : [];
  const activityMessage = includeActivity
    ? formatActivityLeaderboard(activityRows)
    : null;

  console.log(`Organization: ${organization.name} (${organization.slug})`);
  console.log(`Question: ${question}`);
  console.log(`Context mode: ${contextMode}`);

  if (dryRun || !process.env.ZAI_API_KEY) {
    console.log("");
    console.log("AI request was not sent.");
    if (!process.env.ZAI_API_KEY) {
      console.log("Reason: ZAI_API_KEY is not set.");
    } else {
      console.log("Reason: --dry-run was passed.");
    }
    console.log("");
    console.log("=== SYSTEM PROMPT ===");
    console.log(systemPrompt);
    console.log("");
    console.log("=== ORG CONTEXT ===");
    console.log(orgContextMessage ?? "(none)");

    if (activityMessage) {
      console.log("");
      console.log("=== ACTIVITY SUMMARY ===");
      console.log(activityMessage);
      console.log("");
      console.log("Note: this activity summary is for smoke testing only and is not part of the current in-app AI route.");
    }
    return;
  }

  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

  if (orgContextMessage) {
    messages.push({ role: "user", content: orgContextMessage });
  }

  if (activityMessage) {
    messages.push({ role: "user", content: activityMessage });
  }

  messages.push({ role: "user", content: question });

  let answer = "";
  let streamError: string | null = null;

  for await (const event of composeResponse({
    client: createZaiClient(),
    systemPrompt,
    messages,
  })) {
    if (event.type === "chunk") {
      answer += event.content;
      continue;
    }

    if (event.type === "error") {
      streamError = event.message;
    }
  }

  console.log("");
  console.log(`Model: ${getZaiModel()}`);
  console.log("=== ANSWER ===");
  console.log(answer || "(no content returned)");

  if (activityMessage) {
    console.log("");
    console.log("Note: activity summary was injected for smoke testing and is not part of the current in-app AI route.");
  }

  if (streamError) {
    console.error("");
    console.error(`Stream error: ${streamError}`);
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

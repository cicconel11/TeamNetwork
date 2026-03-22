import { randomUUID } from "node:crypto";
import { buildPromptContext } from "@/lib/ai/context-builder";
import { createZaiClient, getZaiModel } from "@/lib/ai/client";
import { composeResponse } from "@/lib/ai/response-composer";
import { createServiceClient } from "@/lib/supabase/service";

type RoleRow = {
  user_id: string;
};

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
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
      "  npm run ai:smoke -- --org <slug-or-id> --question \"What's going on here?\" [--shared-static] [--dry-run]",
      "",
      "Examples:",
      "  npm run ai:smoke -- --org upenn-sprint-football --question \"What's going on in this organization?\"",
      "  npm run ai:smoke -- --org upenn-sprint-football --question \"Who has been the most active?\"",
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

async function main() {
  const orgRef = getArg("--org");
  const question = getArg("--question");

  if (!orgRef || !question) {
    usage();
  }

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
    return;
  }

  const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];

  if (orgContextMessage) {
    messages.push({ role: "user", content: orgContextMessage });
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

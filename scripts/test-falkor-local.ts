/**
 * Local Falkor people-graph end-to-end test script.
 *
 * Usage: npx tsx scripts/test-falkor-local.ts [orgId] [personType:personId]
 *
 * Examples:
 *   npx tsx scripts/test-falkor-local.ts
 *   npx tsx scripts/test-falkor-local.ts ce2e47f8-... member:7f217239-...
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env.local manually (no dotenv dependency)
const envPath = resolve(import.meta.dirname ?? __dirname, "..", ".env.local");
for (const line of readFileSync(envPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx < 0) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const value = trimmed.slice(eqIdx + 1).trim();
  if (!process.env[key]) process.env[key] = value;
}
import { processGraphSyncQueue } from "../src/lib/falkordb/sync";
import { suggestConnections } from "../src/lib/falkordb/suggestions";
import { falkorClient } from "../src/lib/falkordb/client";
import { buildPersonKey } from "../src/lib/falkordb/people";

const DEFAULT_ORG_ID = "ce2e47f8-388a-4e06-9a2d-6d5b851ee899";

async function main() {
  const orgId = process.argv[2] || DEFAULT_ORG_ID;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(url, key);

  console.log(`\n--- Falkor E2E Test ---`);
  console.log(`Org ID: ${orgId}`);
  console.log(`Falkor available: ${falkorClient.isAvailable()}`);

  // Step 1: Re-backfill queue (embedded FalkorDB is ephemeral per process)
  console.log(`\n[1] Backfilling queue...`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: backfillResult } = await (supabase as any).rpc("backfill_graph_sync_queue", { p_org_id: orgId });
  console.log(`    Enqueued: ${backfillResult?.enqueued ?? 0}`);

  // Step 2: Process the queue (within this same process so Falkor stays alive)
  console.log(`\n[2] Processing graph sync queue...`);
  let totalProcessed = 0;
  let totalFailed = 0;
  let iterations = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const stats = await processGraphSyncQueue(supabase);
    totalProcessed += stats.processed;
    totalFailed += stats.failed;
    iterations++;
    if (stats.processed + stats.skipped + stats.failed === 0) break;
  }

  console.log(`    Processed: ${totalProcessed}, Failed: ${totalFailed}, Iterations: ${iterations}`);

  // Step 3: Pick a source person to test suggestions
  const personArg = process.argv[3];
  let source: { person_type: "member" | "alumni"; person_id: string; label: string } | null = null;

  if (personArg && personArg.includes(":")) {
    const [pType, pId] = personArg.split(":");
    source = { person_type: pType as "member" | "alumni", person_id: pId, label: `${pType} ${pId}` };
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sampleAlumni } = await (supabase as any)
      .from("alumni")
      .select("id, first_name, last_name, user_id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sampleMember } = await (supabase as any)
      .from("members")
      .select("id, first_name, last_name, user_id")
      .eq("organization_id", orgId)
      .eq("status", "active")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    source = sampleAlumni
      ? { person_type: "alumni" as const, person_id: sampleAlumni.id, label: `${sampleAlumni.first_name} ${sampleAlumni.last_name}` }
      : sampleMember
        ? { person_type: "member" as const, person_id: sampleMember.id, label: `${sampleMember.first_name} ${sampleMember.last_name}` }
        : null;
  }

  if (!source) {
    console.log(`\n[3] No members or alumni found for org — nothing to test`);
    await (falkorClient as { close?: () => Promise<void> }).close?.();
    return;
  }

  // Resolve the graph key the same way production code does.
  const sourceTable = source.person_type === "member" ? "members" : "alumni";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sourceRow } = await (supabase as any)
    .from(sourceTable)
    .select("id, user_id, first_name, last_name")
    .eq("organization_id", orgId)
    .eq("id", source.person_id)
    .maybeSingle();

  const expectedKey = buildPersonKey(
    sourceTable,
    source.person_id,
    (sourceRow as { user_id?: string | null } | null)?.user_id ?? null
  );

  if (sourceRow) {
    const namedSource = sourceRow as {
      first_name?: string | null;
      last_name?: string | null;
    };
    const label = [namedSource.first_name ?? "", namedSource.last_name ?? ""].join(" ").trim();
    if (label) {
      source = { ...source, label };
    }
  }

  // Step 3b: Verify Falkor has nodes
  try {
    const nodes = await falkorClient.query<{ personKey: string; name: string }>(
      orgId,
      "MATCH (p:Person) RETURN p.personKey AS personKey, p.name AS name LIMIT 5"
    );
    console.log(`\n[3a] Falkor nodes (first 5): ${nodes.length > 0 ? nodes.map((n) => n.name).join(", ") : "NONE"}`);
  } catch (err) {
    console.log(`\n[3a] Falkor query failed: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`\n[3b] Source: ${source.label} (${expectedKey})`);

  // Check if the source person exists in Falkor
  try {
    const sourceInGraph = await falkorClient.query<{ personKey: string }>(
      orgId,
      "MATCH (p:Person {personKey: $key}) RETURN p.personKey AS personKey LIMIT 1",
      { key: expectedKey }
    );
    console.log(`    Source key "${expectedKey}" in Falkor: ${sourceInGraph.length > 0 ? "YES" : "NO"}`);
  } catch (err) {
    console.log(`    Source lookup failed: ${err instanceof Error ? err.message : err}`);
  }

  // Step 4: Test supported Falkor queries directly
  console.log(`\n[4] Direct Falkor graph queries...`);
  try {
    const candidates = await falkorClient.query<Record<string, unknown>>(
      orgId,
      `MATCH (source:Person {personKey: $sourceKey})
       MATCH (candidate:Person)
       WHERE candidate.personKey <> source.personKey
       RETURN candidate.personKey AS personKey, candidate.name AS name LIMIT 5`,
      { sourceKey: expectedKey }
    );
    console.log(`    Candidates query: ${candidates.length} rows`);
    for (const c of candidates.slice(0, 3)) {
      console.log(`      - ${c.name}`);
    }
  } catch (err) {
    console.log(`    Candidates query FAILED: ${err instanceof Error ? err.message : err}`);
  }

  try {
    const directOutgoing = await falkorClient.query<Record<string, unknown>>(
      orgId,
      `MATCH (source:Person {personKey: $sourceKey})-[:MENTORS]->(candidate:Person)
       RETURN candidate.personKey AS personKey, candidate.name AS name`,
      { sourceKey: expectedKey }
    );
    console.log(`    Direct outgoing edges: ${directOutgoing.length} rows`);
  } catch (err) {
    console.log(`    Direct outgoing query FAILED: ${err instanceof Error ? err.message : err}`);
  }

  try {
    const directIncoming = await falkorClient.query<Record<string, unknown>>(
      orgId,
      `MATCH (source:Person {personKey: $sourceKey})<-[:MENTORS]-(candidate:Person)
       RETURN candidate.personKey AS personKey, candidate.name AS name`,
      { sourceKey: expectedKey }
    );
    console.log(`    Direct incoming edges: ${directIncoming.length} rows`);
  } catch (err) {
    console.log(`    Direct incoming query FAILED: ${err instanceof Error ? err.message : err}`);
  }

  try {
    const sharedMentor = await falkorClient.query<Record<string, unknown>>(
      orgId,
      `MATCH (source:Person {personKey: $sourceKey})<-[:MENTORS]-(:Person)-[:MENTORS]->(candidate:Person)
       WHERE candidate.personKey <> $sourceKey
       RETURN candidate.personKey AS personKey, candidate.name AS name`,
      { sourceKey: expectedKey }
    );
    console.log(`    Mixed second-degree (shared mentor): ${sharedMentor.length} rows`);
  } catch (err) {
    console.log(`    Shared mentor query FAILED: ${err instanceof Error ? err.message : err}`);
  }

  try {
    const sharedMentee = await falkorClient.query<Record<string, unknown>>(
      orgId,
      `MATCH (source:Person {personKey: $sourceKey})-[:MENTORS]->(:Person)<-[:MENTORS]-(candidate:Person)
       WHERE candidate.personKey <> $sourceKey
       RETURN candidate.personKey AS personKey, candidate.name AS name`,
      { sourceKey: expectedKey }
    );
    console.log(`    Mixed second-degree (shared mentee): ${sharedMentee.length} rows`);
  } catch (err) {
    console.log(`    Shared mentee query FAILED: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`\n[5] Testing suggestConnections...`);

  const result = await suggestConnections({
    orgId,
    serviceSupabase: supabase,
    args: { person_type: source.person_type, person_id: source.person_id, limit: 5 },
  });

  console.log(`\n    Mode: ${result.mode}`);
  console.log(`    Freshness: ${result.freshness.state} (as_of: ${result.freshness.as_of})`);
  console.log(`    State: ${result.state}`);
  if (result.source_person) {
    console.log(`    Source: ${result.source_person.name}`);
  }

  if (result.disambiguation_options?.length) {
    console.log(`    Disambiguation options (${result.disambiguation_options.length}):`);
    for (const option of result.disambiguation_options) {
      console.log(`      - ${option.name}${option.subtitle ? ` (${option.subtitle})` : ""}`);
    }
  }

  console.log(`    Suggestions (${result.suggestions.length}):`);
  for (const suggestion of result.suggestions) {
    const reasons = suggestion.reasons.map((reason) => reason.code).join(", ");
    console.log(`      - ${suggestion.name} (score: ${suggestion.score}) [${reasons}]`);
  }

  // Cleanup
  await (falkorClient as { close?: () => Promise<void> }).close?.();
  console.log(`\n--- Done ---\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

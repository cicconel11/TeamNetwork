/**
 * Local Falkor people-graph end-to-end test script.
 *
 * Usage: npx tsx scripts/test-falkor-local.ts [orgId] [personType:personId]
 *
 * Examples:
 *   npx tsx scripts/test-falkor-local.ts
 *   npx tsx scripts/test-falkor-local.ts ce2e47f8-... member:7f217239-...
 *   npx tsx scripts/test-falkor-local.ts ce2e47f8-... --sample
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
import {
  scoreProjectedCandidates,
  suggestConnections,
} from "../src/lib/falkordb/suggestions";
import { falkorClient } from "../src/lib/falkordb/client";
import {
  ALUMNI_PERSON_SELECT,
  buildProjectedPeople,
  buildPersonKey,
  buildSourcePerson,
  MEMBER_PERSON_SELECT,
  type AlumniPersonRow,
  type MemberPersonRow,
  type ProjectedPerson,
} from "../src/lib/falkordb/people";
import { normalizeConnectionText } from "../src/lib/falkordb/scoring";

const DEFAULT_ORG_ID = "ce2e47f8-388a-4e06-9a2d-6d5b851ee899";

type SourceRef = { person_type: "member" | "alumni"; person_id: string; label: string };

function formatReasonList(source: {
  reasons?: Array<{ code?: string; weight?: number }>;
}) {
  return (source.reasons ?? [])
    .map((reason) => `${reason.code ?? "unknown"}${typeof reason.weight === "number" ? `(${reason.weight})` : ""}`)
    .join(", ");
}

function calculateOverlap(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union === 0 ? 0 : intersection / union;
}

async function loadSourceProjection(
  supabase: SupabaseClient,
  orgId: string,
  source: SourceRef
): Promise<ProjectedPerson | null> {
  const sourceTable = source.person_type === "member" ? "members" : "alumni";
  const select = source.person_type === "member" ? MEMBER_PERSON_SELECT : ALUMNI_PERSON_SELECT;

  const { data: sourceRow } = await supabase
    .from(sourceTable)
    .select(select)
    .eq("organization_id", orgId)
    .eq("id", source.person_id)
    .maybeSingle();

  if (!sourceRow) {
    return null;
  }

  if (source.person_type === "member") {
    const memberRow = sourceRow as unknown as MemberPersonRow;
    if (!memberRow.user_id) {
      return buildSourcePerson({ memberRows: [memberRow], alumniRows: [] });
    }

    const { data: alumniRows } = await supabase
      .from("alumni")
      .select(ALUMNI_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("user_id", memberRow.user_id)
      .is("deleted_at", null);

    return buildSourcePerson({
      memberRows: [memberRow],
      alumniRows: (alumniRows as AlumniPersonRow[] | null) ?? [],
    });
  }

  const alumniRow = sourceRow as unknown as AlumniPersonRow;
  if (!alumniRow.user_id) {
    return buildSourcePerson({ memberRows: [], alumniRows: [alumniRow] });
  }

  const { data: memberRows } = await supabase
    .from("members")
    .select(MEMBER_PERSON_SELECT)
    .eq("organization_id", orgId)
    .eq("user_id", alumniRow.user_id)
    .eq("status", "active")
    .is("deleted_at", null);

  return buildSourcePerson({
    memberRows: (memberRows as MemberPersonRow[] | null) ?? [],
    alumniRows: [alumniRow],
  });
}

async function loadProjectedPeopleForOrg(
  supabase: SupabaseClient,
  orgId: string
) {
  const [membersResponse, alumniResponse] = await Promise.all([
    supabase
      .from("members")
      .select(MEMBER_PERSON_SELECT)
      .eq("organization_id", orgId)
      .eq("status", "active")
      .is("deleted_at", null),
    supabase
      .from("alumni")
      .select(ALUMNI_PERSON_SELECT)
      .eq("organization_id", orgId)
      .is("deleted_at", null),
  ]);

  return buildProjectedPeople({
    members: (membersResponse.data as MemberPersonRow[] | null) ?? [],
    alumni: (alumniResponse.data as AlumniPersonRow[] | null) ?? [],
  });
}

async function listSampleSources(
  supabase: SupabaseClient,
  orgId: string,
  limit = 3
) {
  const sources: SourceRef[] = [];

  const { data: members } = await supabase
    .from("members")
    .select("id, first_name, last_name")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .is("deleted_at", null)
    .limit(limit);

  for (const row of (members as Array<{ id: string; first_name?: string; last_name?: string }> | null) ?? []) {
    const label = [row.first_name ?? "", row.last_name ?? ""].join(" ").trim() || row.id;
    sources.push({ person_type: "member", person_id: row.id, label });
  }

  return sources;
}

async function runSuggestionDebug(
  supabase: SupabaseClient,
  orgId: string,
  source: SourceRef
) {
  const projection = await loadSourceProjection(supabase, orgId, source);
  const projectedPeople = await loadProjectedPeopleForOrg(supabase, orgId);
  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();
  const organizationName =
    organization && typeof organization === "object" && typeof organization.name === "string"
      ? organization.name
      : null;
  const result = await suggestConnections({
    orgId,
    serviceSupabase: supabase,
    args: { person_type: source.person_type, person_id: source.person_id, limit: 5 },
  });
  const scoredSuggestions = projection
    ? scoreProjectedCandidates({
        source: projection,
        allPeople: projectedPeople.values(),
        candidates: projectedPeople.values(),
        limit: 5,
        scoringContext: {
          genericCompanyValues: ["TeamNetwork", normalizeConnectionText(organizationName)],
        },
      })
    : [];

  console.log(`\n    Source: ${source.label}`);
  if (projection) {
    console.log(`      company=${projection.currentCompany ?? "—"}`);
    console.log(`      industry=${projection.industry ?? "—"}`);
    console.log(`      roleFamily=${projection.roleFamily ?? "—"}`);
    console.log(`      city=${projection.currentCity ?? "—"}`);
    console.log(`      graduationYear=${projection.graduationYear ?? "—"}`);
  }
  console.log(`      state=${result.state} mode=${result.mode}`);
  console.log(`      suggestions=${result.suggestions.length}`);
  for (const suggestion of scoredSuggestions) {
    console.log(
      `      - ${suggestion.name} (score: ${suggestion.score}) [${formatReasonList(suggestion)}]`
    );
    console.log(
      `        qualifiers=${suggestion.debug?.qualificationCodes.join(", ") ?? "—"} rarity=${JSON.stringify(
        suggestion.debug?.rarityMultipliers ?? {}
      )} exposurePenalty=${suggestion.debug?.exposurePenalty ?? 0}`
    );
  }

  return {
    source,
    projection,
    result,
    suggestionNames: result.suggestions.map((suggestion) => suggestion.name),
  };
}

async function main() {
  const orgId = process.argv[2] || DEFAULT_ORG_ID;
  const modeArg = process.argv[3] ?? null;
  const sampleMode = modeArg === "--sample";

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
  const personArg = sampleMode ? null : modeArg;
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

  // Step 4: Test candidate enumeration directly
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

  console.log(`\n[5] Testing suggestConnections...`);

  if (sampleMode) {
    const sampleSources = await listSampleSources(supabase, orgId, 3);
    const runs = [];
    for (const sampleSource of sampleSources) {
      runs.push(await runSuggestionDebug(supabase, orgId, sampleSource));
    }

    if (runs.length > 1) {
      console.log(`\n    Overlap summary:`);
      for (let index = 0; index < runs.length; index += 1) {
        for (let compareIndex = index + 1; compareIndex < runs.length; compareIndex += 1) {
          const left = runs[index];
          const right = runs[compareIndex];
          const overlap = calculateOverlap(left.suggestionNames, right.suggestionNames);
          console.log(
            `      ${left.source.label} vs ${right.source.label}: ${(overlap * 100).toFixed(0)}%`
          );
        }
      }
    }
  } else {
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
  }

  // Cleanup
  await (falkorClient as { close?: () => Promise<void> }).close?.();
  console.log(`\n--- Done ---\n`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

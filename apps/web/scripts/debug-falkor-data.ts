import { readFileSync } from "fs";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";
import { falkorClient } from "../src/lib/falkordb/client";
import { processGraphSyncQueue } from "../src/lib/falkordb/sync";

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

const orgId = "ce2e47f8-388a-4e06-9a2d-6d5b851ee899";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}
const supabase = createClient(url, key);

async function main() {
  console.log("Falkor available:", falkorClient.isAvailable());

  // Backfill and sync
  console.log("\n[1] Backfilling queue...");
  const { data: backfillResult } = await supabase.rpc("backfill_graph_sync_queue", { p_org_id: orgId });
  console.log("Enqueued:", backfillResult?.enqueued ?? 0);

  console.log("\n[2] Processing queue...");
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const stats = await processGraphSyncQueue(supabase);
    total += stats.processed;
    if (stats.processed + stats.skipped + stats.failed === 0) break;
  }
  console.log("Processed:", total);

  // Check Matt and Louis in Falkor
  console.log("\n[3] Matt and Louis in Falkor:");
  const mattLouis = await falkorClient.query(
    orgId,
    `MATCH (p:Person) 
     WHERE p.name CONTAINS 'Matt' OR p.name CONTAINS 'Louis'
     RETURN p.personKey, p.name, p.currentCompany, p.industry, p.roleFamily, p.graduationYear`
  );
  
  for (const n of mattLouis) {
    console.log(`  ${n.name}: company=${n.currentCompany ?? "NULL"}, industry=${n.industry ?? "NULL"}, roleFamily=${n.roleFamily ?? "NULL"}, grad=${n.graduationYear ?? "NULL"}`);
  }

  // Check Aarav, Adrian, Aisha
  console.log("\n[4] Aarav/Adrian/Aisha in Falkor:");
  const candidates = await falkorClient.query(
    orgId,
    `MATCH (p:Person) 
     WHERE p.name CONTAINS 'Aarav' OR p.name CONTAINS 'Adrian' OR p.name CONTAINS 'Aisha'
     RETURN p.name, p.currentCompany, p.industry, p.roleFamily, p.graduationYear`
  );
  
  for (const c of candidates) {
    console.log(`  ${c.name}: company=${c.currentCompany ?? "NULL"}, industry=${c.industry ?? "NULL"}, roleFamily=${c.roleFamily ?? "NULL"}, grad=${c.graduationYear ?? "NULL"}`);
  }

  // Total count
  const allPeople = await falkorClient.query(orgId, "MATCH (p:Person) RETURN count(p) AS count");
  console.log("\n[5] Total people in graph:", allPeople[0]?.count ?? 0);

  // Sample people with industry/company
  console.log("\n[6] Sample people WITH career data:");
  const withData = await falkorClient.query(
    orgId,
    `MATCH (p:Person) 
     WHERE p.industry IS NOT NULL OR p.currentCompany IS NOT NULL
     RETURN p.name, p.industry, p.currentCompany, p.roleFamily
     LIMIT 10`
  );
  for (const p of withData) {
    console.log(`  ${p.name}: industry=${p.industry ?? "NULL"}, company=${p.currentCompany ?? "NULL"}`);
  }

  await (falkorClient as { close?: () => Promise<void> }).close?.();
}

main().catch(console.error);

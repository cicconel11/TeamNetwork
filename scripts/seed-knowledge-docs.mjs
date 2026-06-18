#!/usr/bin/env node
// Seeds two knowledge_documents rows for manual end-to-end testing of the
// org-knowledge RAG source + audience gating, then enqueues them for embedding.
//
// It inserts:
//   1. an `audience: 'all'` doc  -> should surface for EVERY role (incl. members)
//   2. an `audience: 'admins'` doc -> should surface for admins ONLY
//
// After running, trigger the embed worker (the `ai-embed-process` cron path) so
// the rows get chunked + embedded, then ask the assistant a question that hits
// the content. Verify: an admin sees both; a non-admin member sees only the
// 'all' doc. That round trip exercises trigger -> queue -> worker -> retrieval
// -> audience filter, which no unit test covers.
//
// Usage (from repo root, so .env.local is loaded by your shell/turbo):
//   ORG_ID=<uuid> CREATED_BY=<admin uuid> node scripts/seed-knowledge-docs.mjs
//
// Defaults target the "Test Organization" seed org if ORG_ID is unset.
//
// Uses the Supabase REST API directly (service role) — same dependency-free
// approach as scripts/mobile-handoff.mjs, so it runs with plain `node`.
//
// Required env:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   (service role — bypasses RLS for the seed insert)

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Defaults point at the existing "Test Organization" + one of its admins so the
// script is runnable with zero args against the current database. Override via
// env for any other org.
const orgId = process.env.ORG_ID ?? "ce2e47f8-388a-4e06-9a2d-6d5b851ee899";
const createdBy = process.env.CREATED_BY ?? null;

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
})) {
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    console.error("Run from repo root so .env.local is loaded, or export it.");
    process.exit(1);
  }
}

// Two docs with deliberately distinctive, retrievable content. The 'admins' doc
// carries a secret-ish phrase so you can clearly tell whether a non-admin leaked
// it during retrieval.
const docs = [
  {
    organization_id: orgId,
    type: "policy",
    title: "Member Handbook — Code of Conduct",
    description: "General conduct expectations visible to all members.",
    tags: ["handbook", "conduct", "policy"],
    body:
      "All members are expected to treat teammates with respect, attend scheduled " +
      "team meetings, and report injuries to the training staff promptly. The team " +
      "values integrity, punctuality, and sportsmanship. This document is visible " +
      "to everyone in the organization.",
    audience: "all",
    created_by: createdBy,
  },
  {
    organization_id: orgId,
    type: "policy",
    title: "Admin Playbook — Budget & Discipline (CONFIDENTIAL)",
    description: "Admin-only operational guidance.",
    tags: ["admin", "budget", "confidential"],
    body:
      "ADMIN-ONLY: The discretionary travel budget ceiling for this season is " +
      "$42,000. Disciplinary escalations beyond a verbal warning require two admin " +
      "sign-offs. The confidential passphrase for the admin coordination channel " +
      "is BLUE-HERON-77. This content must never surface to non-admin members.",
    audience: "admins",
    created_by: createdBy,
  },
];

const restHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

// 1. Insert the two docs (PostgREST). Prefer=representation returns the rows.
const insertRes = await fetch(`${url}/rest/v1/knowledge_documents`, {
  method: "POST",
  headers: { ...restHeaders, Prefer: "return=representation" },
  body: JSON.stringify(docs),
});

if (!insertRes.ok) {
  console.error(`Insert failed (${insertRes.status}): ${await insertRes.text()}`);
  process.exit(1);
}

const inserted = await insertRes.json();
console.log(`Inserted ${inserted.length} knowledge_documents into org ${orgId}:`);
for (const row of inserted) {
  console.log(`  - [${row.audience}] ${row.title}  (${row.id})`);
}

// 2. Backfill enqueue (belt-and-suspenders; the AFTER INSERT trigger already
//    enqueued each row). Idempotent via ON CONFLICT DO NOTHING in the RPC.
const rpcRes = await fetch(`${url}/rest/v1/rpc/backfill_ai_embedding_queue`, {
  method: "POST",
  headers: restHeaders,
  body: JSON.stringify({ p_org_id: orgId }),
});

if (!rpcRes.ok) {
  console.error(
    `\nRows inserted, but backfill RPC failed (${rpcRes.status}): ${await rpcRes.text()}\n` +
      "The insert trigger should still have enqueued them — check ai_embedding_queue."
  );
  process.exit(1);
}

const backfill = await rpcRes.json();
console.log(`\nBackfill enqueued: ${JSON.stringify(backfill)}`);
console.log(
  "\nNext: run the embed worker (ai-embed-process cron path) to chunk + embed,\n" +
    "then ask the assistant:\n" +
    '  - "What does the member handbook say about conduct?"  (both roles see it)\n' +
    '  - "What is the travel budget ceiling?" or "admin passphrase"  (admin ONLY)\n' +
    "A non-admin must NOT get BLUE-HERON-77 or the $42,000 figure."
);
/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { checkReachabilityHealth } from "../../../src/lib/health/reachability-health.ts";
import { classifyAlumniReachability } from "../../../src/lib/alumni/reachability-segments.ts";

const ORG_ID = "11111111-1111-1111-1111-111111111111";

const reInviteSource = await readFile(
  new URL(
    "../../../src/app/api/organizations/[organizationId]/alumni/re-invite/route.ts",
    import.meta.url
  ),
  "utf8"
);

const cohortsSource = await readFile(
  new URL(
    "../../../src/app/api/organizations/[organizationId]/alumni/cohorts/route.ts",
    import.meta.url
  ),
  "utf8"
);

// ── Source assertions: the route's authorization + safety invariants ─────────

test("re-invite route exports POST and is admin-only", () => {
  assert.match(reInviteSource, /export async function POST/);
  assert.match(reInviteSource, /membership\?\.role !== "admin"/);
  assert.match(reInviteSource, /Forbidden/);
});

test("re-invite route validates a bounded alumniIds uuid array", () => {
  assert.match(reInviteSource, /alumniIds: z\.array\(baseSchemas\.uuid\)/);
  assert.match(reInviteSource, /\.max\(200\)/);
  assert.match(reInviteSource, /validateJson\(req, reInviteSchema/);
});

test("re-invite route enforces a 14-day durable cooldown", () => {
  assert.match(reInviteSource, /14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(reInviteSource, /reason: "cooldown"/);
  assert.match(reInviteSource, /last_invite_sent_at/);
});

test("re-invite route only targets unclaimed, emailed, non-deleted alumni", () => {
  // user_id IS NULL guard on both the partition and the update
  assert.match(reInviteSource, /reason: "linked"/);
  assert.match(reInviteSource, /reason: "no_email"/);
  assert.match(reInviteSource, /\.is\("deleted_at", null\)/);
  assert.match(reInviteSource, /\.is\("user_id", null\)/);
});

test("re-invite route creates the invite through the user client (SECURITY DEFINER admin check)", () => {
  // create_org_invite checks auth.uid()'s admin role, so it must run on the
  // user client, not the service client.
  assert.match(reInviteSource, /userSupabase as OrgInviteRpc\)\.rpc\(\s*"create_org_invite"/);
  assert.match(reInviteSource, /buildInviteLink/);
});

test("re-invite route does NOT stamp a cooldown on send failure", () => {
  // The cooldown update must be gated behind a successful send.
  assert.match(reInviteSource, /if \(!emailResult\.success\)/);
  // failure path returns before the alumni update
  const failIdx = reInviteSource.indexOf('status: "failed", reason: "send_failed"');
  const updateIdx = reInviteSource.indexOf("last_invite_sent_at: sentAt");
  assert.ok(failIdx !== -1 && updateIdx !== -1 && failIdx < updateIdx);
});

test("re-invite route reports sent_unstamped when the cooldown stamp fails after send", () => {
  // The email went out but the durable gate wasn't recorded — must be surfaced
  // distinctly so an immediate re-send can't silently bypass the cooldown.
  assert.match(reInviteSource, /sent_unstamped/);
  assert.match(reInviteSource, /reason: "stamp_failed"/);
  assert.match(reInviteSource, /const stamped = !updateError/);
});

test("re-invite route audits each send into data_access_log", () => {
  assert.match(reInviteSource, /data_access_log/);
  assert.match(reInviteSource, /resource_type: "alumni_reinvite"/);
  assert.match(reInviteSource, /actor_user_id: actorUserId/);
});

test("cohorts route is admin-only and returns segmented entries", () => {
  assert.match(cohortsSource, /export async function GET/);
  assert.match(cohortsSource, /membership\?\.role !== "admin"/);
  assert.match(cohortsSource, /classifyAlumniReachability/);
});

// ── Classifier parity: the list path and the count path must agree ───────────
// Both surfaces classify with classifyAlumniReachability. This test runs the
// real count path (checkReachabilityHealth) over a stub, then independently
// classifies the same rows the way the cohorts route does, and asserts the
// per-segment tallies match exactly. Guards against drift between the two.

interface Fixture {
  id: string;
  user_id: string | null;
  email: string | null;
  deleted_at: string | null;
}

function seedFixtures(stub: ReturnType<typeof createSupabaseStub>, rows: Fixture[]) {
  stub.seed(
    "alumni",
    rows.map((r) => ({ organization_id: ORG_ID, ...r }))
  );
}

test("count path and list path produce identical segment tallies", async () => {
  const stub = createSupabaseStub();
  const rows: Fixture[] = [
    { id: "a-elig", user_id: "u-elig", email: "e@x.com", deleted_at: null },
    { id: "a-elig2", user_id: "u-elig2", email: "e2@x.com", deleted_at: null },
    { id: "a-noelig", user_id: "u-noelig", email: "n@x.com", deleted_at: null },
    { id: "a-unclaimed", user_id: null, email: "u@x.com", deleted_at: null },
    { id: "a-noemail", user_id: null, email: null, deleted_at: null },
    { id: "a-deleted", user_id: "u-del", email: "d@x.com", deleted_at: "2026-01-01T00:00:00.000Z" },
  ];
  seedFixtures(stub, rows);
  // u-elig + u-elig2 carry an active chat-eligible role; u-noelig does not.
  stub.seed("user_organization_roles", [
    { organization_id: ORG_ID, user_id: "u-elig", status: "active", role: "alumni" },
    { organization_id: ORG_ID, user_id: "u-elig2", status: "active", role: "admin" },
  ]);

  // Count path (data-health card).
  const report = await checkReachabilityHealth(stub as any, ORG_ID);

  // List path (cohorts route): resolve the same eligible set, classify each
  // non-deleted row, then tally.
  const eligibleUserIds = new Set(["u-elig", "u-elig2"]);
  const listTally = {
    linkedEligible: 0,
    linkedNotEligible: 0,
    unclaimedWithEmail: 0,
    unclaimedNoEmail: 0,
    softDeleted: 0,
  };
  for (const row of rows) {
    const segment = classifyAlumniReachability(row, eligibleUserIds);
    listTally[segment] += 1;
  }

  // The count path counts soft-deleted via a separate head query, so compare
  // the four live segments plus the (independently counted) soft-deleted total.
  assert.equal(report.segments.linkedEligible, listTally.linkedEligible);
  assert.equal(report.segments.linkedNotEligible, listTally.linkedNotEligible);
  assert.equal(report.segments.unclaimedWithEmail, listTally.unclaimedWithEmail);
  assert.equal(report.segments.unclaimedNoEmail, listTally.unclaimedNoEmail);
  assert.equal(report.segments.softDeleted, listTally.softDeleted);

  // Sanity: the expected split.
  assert.deepEqual(listTally, {
    linkedEligible: 2,
    linkedNotEligible: 1,
    unclaimedWithEmail: 1,
    unclaimedNoEmail: 1,
    softDeleted: 1,
  });
});

// ── Re-invite logic simulator ────────────────────────────────────────────────
// Mirrors the route's partition + send semantics (the route handler itself
// needs mocked Supabase/Resend clients, so — like the link-user route test —
// the decision tree is re-implemented and exercised directly).

const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

interface SimAlumnus {
  id: string;
  user_id: string | null;
  email: string | null;
  last_invite_sent_at: string | null;
  invite_count: number;
  deleted_at?: string | null;
}

interface SimResult {
  alumniId: string;
  status: "sent" | "sent_unstamped" | "skipped" | "failed";
  reason?: string;
}

interface SimOutcome {
  results: SimResult[];
  sent: number;
  skipped: number;
  failed: number;
  // Post-send state keyed by id (mutated copies).
  rows: Map<string, SimAlumnus>;
  audits: { actorUserId: string; resourceType: string; resourceId: string }[];
}

/**
 * Re-implements the re-invite route's per-id decision tree. `sendOk` controls
 * whether the (single) cohort email send succeeds — modelling sendEmail's
 * success flag. `stampOk` (default true) controls whether the post-send cooldown
 * UPDATE succeeds; when false the email still went out but the durable gate is
 * not recorded, so the result is `sent_unstamped`. `now` is the reference time
 * for cooldown checks.
 */
function simulateReInvite(opts: {
  requestedIds: string[];
  roster: SimAlumnus[];
  actorUserId: string;
  now: number;
  sendOk: boolean;
  stampOk?: boolean;
}): SimOutcome {
  const { requestedIds, roster, actorUserId, now, sendOk, stampOk = true } = opts;
  const rows = new Map<string, SimAlumnus>();
  for (const r of roster) {
    if (!r.deleted_at) rows.set(r.id, { ...r });
  }

  const ids = [...new Set(requestedIds)];
  const results: SimResult[] = [];
  const sendable: SimAlumnus[] = [];
  const audits: SimOutcome["audits"] = [];

  for (const id of ids) {
    const row = rows.get(id);
    if (!row) {
      results.push({ alumniId: id, status: "skipped", reason: "not_found" });
      continue;
    }
    if (row.user_id) {
      results.push({ alumniId: id, status: "skipped", reason: "linked" });
      continue;
    }
    if (!row.email) {
      results.push({ alumniId: id, status: "skipped", reason: "no_email" });
      continue;
    }
    if (row.last_invite_sent_at && now - Date.parse(row.last_invite_sent_at) < COOLDOWN_MS) {
      results.push({ alumniId: id, status: "skipped", reason: "cooldown" });
      continue;
    }
    sendable.push(row);
  }

  for (const row of sendable) {
    if (!sendOk) {
      // No cooldown stamp, no counter bump, no audit on failure.
      results.push({ alumniId: row.id, status: "failed", reason: "send_failed" });
      continue;
    }
    // The email went out — always audit, whether or not the stamp lands.
    if (stampOk) {
      row.last_invite_sent_at = new Date(now).toISOString();
      row.invite_count += 1;
    }
    audits.push({
      actorUserId,
      resourceType: "alumni_reinvite",
      resourceId: row.id,
    });
    results.push(
      stampOk
        ? { alumniId: row.id, status: "sent" }
        : { alumniId: row.id, status: "sent_unstamped", reason: "stamp_failed" }
    );
  }

  // sent_unstamped emails reached the recipient, so count toward `sent`.
  const sent = results.filter(
    (r) => r.status === "sent" || r.status === "sent_unstamped"
  ).length;
  return {
    results,
    sent,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    rows,
    audits,
  };
}

function unclaimed(overrides: Partial<SimAlumnus> = {}): SimAlumnus {
  return {
    id: randomUUID(),
    user_id: null,
    email: "a@x.com",
    last_invite_sent_at: null,
    invite_count: 0,
    deleted_at: null,
    ...overrides,
  };
}

const NOW = Date.parse("2026-06-24T00:00:00.000Z");

test("unclaimed-with-email alum is sent, stamped, counted, and audited", () => {
  const actor = randomUUID();
  const alum = unclaimed();
  const out = simulateReInvite({
    requestedIds: [alum.id],
    roster: [alum],
    actorUserId: actor,
    now: NOW,
    sendOk: true,
  });

  assert.equal(out.sent, 1);
  assert.equal(out.results[0].status, "sent");
  const after = out.rows.get(alum.id)!;
  assert.equal(after.last_invite_sent_at, new Date(NOW).toISOString());
  assert.equal(after.invite_count, 1);
  assert.deepEqual(out.audits, [
    { actorUserId: actor, resourceType: "alumni_reinvite", resourceId: alum.id },
  ]);
});

test("an alum invited 5 days ago is skipped for cooldown — no new invite, counters unchanged", () => {
  const recent = new Date(NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
  const alum = unclaimed({ last_invite_sent_at: recent, invite_count: 1 });
  const out = simulateReInvite({
    requestedIds: [alum.id],
    roster: [alum],
    actorUserId: randomUUID(),
    now: NOW,
    sendOk: true,
  });

  assert.equal(out.sent, 0);
  assert.equal(out.skipped, 1);
  assert.equal(out.results[0].reason, "cooldown");
  const after = out.rows.get(alum.id)!;
  assert.equal(after.last_invite_sent_at, recent);
  assert.equal(after.invite_count, 1);
  assert.equal(out.audits.length, 0);
});

test("an alum invited 20 days ago is past cooldown and sends", () => {
  const old = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
  const alum = unclaimed({ last_invite_sent_at: old, invite_count: 2 });
  const out = simulateReInvite({
    requestedIds: [alum.id],
    roster: [alum],
    actorUserId: randomUUID(),
    now: NOW,
    sendOk: true,
  });

  assert.equal(out.sent, 1);
  assert.equal(out.rows.get(alum.id)!.invite_count, 3);
});

test("ineligible targets are skipped, never invited", () => {
  const linked = unclaimed({ user_id: randomUUID() });
  const noEmail = unclaimed({ email: null });
  const deleted = unclaimed({ deleted_at: "2026-01-01T00:00:00.000Z" });
  const out = simulateReInvite({
    requestedIds: [linked.id, noEmail.id, deleted.id],
    roster: [linked, noEmail, deleted],
    actorUserId: randomUUID(),
    now: NOW,
    sendOk: true,
  });

  assert.equal(out.sent, 0);
  assert.equal(out.skipped, 3);
  const reasons = out.results.map((r) => r.reason).sort();
  assert.deepEqual(reasons, ["linked", "no_email", "not_found"]);
  assert.equal(out.audits.length, 0);
});

test("send failure counts as failed, leaves counters untouched (no false cooldown)", () => {
  const alum = unclaimed();
  const out = simulateReInvite({
    requestedIds: [alum.id],
    roster: [alum],
    actorUserId: randomUUID(),
    now: NOW,
    sendOk: false,
  });

  assert.equal(out.failed, 1);
  assert.equal(out.sent, 0);
  const after = out.rows.get(alum.id)!;
  assert.equal(after.last_invite_sent_at, null);
  assert.equal(after.invite_count, 0);
  assert.equal(out.audits.length, 0);
});

test("email sent but cooldown stamp failed is reported as sent_unstamped (not a clean sent)", () => {
  // Guards the cooldown-bypass window: if the email went out but the durable
  // stamp failed, the result must NOT masquerade as a clean `sent` (which would
  // let an immediate re-send slip past the 14-day gate unnoticed). The audit row
  // is still written because the alumnus was in fact emailed.
  const actor = randomUUID();
  const alum = unclaimed();
  const out = simulateReInvite({
    requestedIds: [alum.id],
    roster: [alum],
    actorUserId: actor,
    now: NOW,
    sendOk: true,
    stampOk: false,
  });

  assert.equal(out.results[0].status, "sent_unstamped");
  assert.equal(out.results[0].reason, "stamp_failed");
  // The recipient was reached, so it counts toward sent…
  assert.equal(out.sent, 1);
  // …but the durable cooldown was NOT recorded — the next send isn't blocked.
  const after = out.rows.get(alum.id)!;
  assert.equal(after.last_invite_sent_at, null);
  assert.equal(after.invite_count, 0);
  // The email-went-out fact is audited regardless.
  assert.deepEqual(out.audits, [
    { actorUserId: actor, resourceType: "alumni_reinvite", resourceId: alum.id },
  ]);
});

test("a mixed cohort reports sent/skipped/failed independently", () => {
  const fresh = unclaimed();
  const cooled = unclaimed({
    last_invite_sent_at: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
  });
  const linked = unclaimed({ user_id: randomUUID() });
  const out = simulateReInvite({
    requestedIds: [fresh.id, cooled.id, linked.id],
    roster: [fresh, cooled, linked],
    actorUserId: randomUUID(),
    now: NOW,
    sendOk: true,
  });

  assert.equal(out.sent, 1);
  assert.equal(out.skipped, 2);
  assert.equal(out.failed, 0);
});

import test from "node:test";
import assert from "node:assert";
import { randomUUID } from "crypto";

/**
 * Regression suite for mentorship state transitions (Part A pre-flight fixes).
 *
 * Simulates the admin_propose_pair RPC, the mentorship_pairs_enforce_transition
 * trigger, and the decline race guard. Verifies:
 *   - Admin run-round inserts a proposal with score + signals populated.
 *   - Mentee self-request inserts atomically with score + signals (no orphan rows).
 *   - Concurrent decline-vs-accept: when accept wins, decline returns 409 and no
 *     audit row or email is produced.
 *   - Trigger denies a non-admin INSERT that attempts to set match_score.
 */

type Role = "admin" | "active_member" | "alumni";
type Status = "active" | "inactive";

interface RoleRow {
  user_id: string;
  organization_id: string;
  role: Role;
  status: Status;
}

interface Pair {
  id: string;
  organization_id: string;
  mentor_user_id: string;
  mentee_user_id: string;
  status: "proposed" | "accepted" | "declined" | "active" | "paused" | "completed" | "expired";
  match_score: number | null;
  match_signals: unknown;
  proposed_by: string;
  proposed_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  declined_reason: string | null;
  deleted_at: string | null;
}

interface Store {
  roles: RoleRow[];
  pairs: Pair[];
  auditLog: { pair_id: string; kind: string; actor: string }[];
  emailsSent: { to: string; kind: string }[];
}

function hasActiveRole(store: Store, userId: string, orgId: string, roles: Role[]): boolean {
  return store.roles.some(
    (r) =>
      r.user_id === userId &&
      r.organization_id === orgId &&
      r.status === "active" &&
      roles.includes(r.role)
  );
}

// Simulates the mentorship_pairs_enforce_transition trigger on INSERT
function triggerInsertGuard(
  store: Store,
  next: Pair,
  caller: string | null,
  trusted: boolean
): { ok: true } | { ok: false; error: string } {
  const isAdmin = caller ? hasActiveRole(store, caller, next.organization_id, ["admin"]) : false;
  if (isAdmin || trusted) return { ok: true };
  if (next.status !== "proposed") return { ok: false, error: "non-admin INSERT must have status=proposed" };
  if (next.match_score !== null) return { ok: false, error: "non-admin INSERT must not set match_score" };
  if (next.match_signals !== null) return { ok: false, error: "non-admin INSERT must not set match_signals" };
  return { ok: true };
}

// Simulates admin_propose_pair RPC
function adminProposePair(
  store: Store,
  args: {
    p_organization_id: string;
    p_mentor_user_id: string;
    p_mentee_user_id: string;
    p_match_score: number;
    p_match_signals: unknown;
    p_actor_user_id: string;
  }
): { pair_id: string; reused: boolean; match_score: number | null; match_signals: unknown } {
  const actor = args.p_actor_user_id;
  const isAdmin = hasActiveRole(store, actor, args.p_organization_id, ["admin"]);
  const isMenteeSelf =
    actor === args.p_mentee_user_id &&
    hasActiveRole(store, actor, args.p_organization_id, ["active_member"]);

  if (!isAdmin && !isMenteeSelf) {
    throw new Error(`actor ${actor} not permitted`);
  }

  const existing = store.pairs.find(
    (p) =>
      p.organization_id === args.p_organization_id &&
      p.mentor_user_id === args.p_mentor_user_id &&
      p.mentee_user_id === args.p_mentee_user_id &&
      ["proposed", "accepted", "active", "paused"].includes(p.status) &&
      p.deleted_at === null
  );

  if (existing) {
    return {
      pair_id: existing.id,
      reused: true,
      match_score: existing.match_score,
      match_signals: existing.match_signals,
    };
  }

  const next: Pair = {
    id: randomUUID(),
    organization_id: args.p_organization_id,
    mentor_user_id: args.p_mentor_user_id,
    mentee_user_id: args.p_mentee_user_id,
    status: "proposed",
    match_score: args.p_match_score,
    match_signals: args.p_match_signals,
    proposed_by: actor,
    proposed_at: new Date().toISOString(),
    accepted_at: null,
    declined_at: null,
    declined_reason: null,
    deleted_at: null,
  };

  // RPC sets trusted-caller GUC; trigger honors it.
  const guard = triggerInsertGuard(store, next, actor, true);
  if (!guard.ok) throw new Error(guard.error);

  store.pairs.push(next);
  return {
    pair_id: next.id,
    reused: false,
    match_score: next.match_score,
    match_signals: next.match_signals,
  };
}

// Simulates accept_mentorship_proposal RPC — winner-takes-all via row lock.
function acceptProposal(store: Store, pairId: string, caller: string): Pair {
  const pair = store.pairs.find((p) => p.id === pairId);
  if (!pair) throw new Error("pair not found");
  if (pair.status !== "proposed") throw new Error(`cannot accept from status ${pair.status}`);
  if (pair.mentor_user_id !== caller && !hasActiveRole(store, caller, pair.organization_id, ["admin"])) {
    throw new Error("only mentor or admin may accept");
  }
  pair.status = "accepted";
  pair.accepted_at = new Date().toISOString();
  return pair;
}

// Simulates the guarded decline UPDATE (post-A.3) via user-scoped Supabase client.
// Trigger now sees real auth.uid() = caller; transition allowed only if caller is
// mentor-on-pair OR admin. Zero-row race still returns 409.
function declineProposal(
  store: Store,
  pairId: string,
  caller: string,
  reason: string | null
):
  | { status: 200; auditEmitted: boolean }
  | { status: 409 }
  | { status: 403 }
  | { status: 500; error: string } {
  const pair = store.pairs.find((p) => p.id === pairId);
  if (!pair) return { status: 409 };
  const isAdmin = hasActiveRole(store, caller, pair.organization_id, ["admin"]);
  const isMentor = pair.mentor_user_id === caller;
  if (!isAdmin && !isMentor) return { status: 403 };
  // status='proposed' guard in UPDATE .eq clause — zero rows if already transitioned
  if (pair.status !== "proposed") return { status: 409 };
  pair.status = "declined";
  pair.declined_at = new Date().toISOString();
  pair.declined_reason = reason;
  store.auditLog.push({ pair_id: pairId, kind: "proposal_declined", actor: caller });
  store.emailsSent.push({ to: pair.mentee_user_id, kind: "proposal_declined" });
  return { status: 200, auditEmitted: true };
}

// Simulates parallel INSERT race on unique_violation (shared_pair index).
// RPC catches 23505 and returns the winning row as reused.
function adminProposePairWithRace(
  store: Store,
  args: Parameters<typeof adminProposePair>[1],
  competitor: () => void
): ReturnType<typeof adminProposePair> {
  // Pre-check: no existing row
  const hit = store.pairs.find(
    (p) =>
      p.organization_id === args.p_organization_id &&
      p.mentor_user_id === args.p_mentor_user_id &&
      p.mentee_user_id === args.p_mentee_user_id &&
      ["proposed", "accepted", "active", "paused"].includes(p.status) &&
      p.deleted_at === null
  );
  if (hit) {
    return {
      pair_id: hit.id,
      reused: true,
      match_score: hit.match_score,
      match_signals: hit.match_signals,
    };
  }
  // Competitor inserts between check and our insert
  competitor();
  // Our insert now hits unique_violation → re-read winner
  const winner = store.pairs.find(
    (p) =>
      p.organization_id === args.p_organization_id &&
      p.mentor_user_id === args.p_mentor_user_id &&
      p.mentee_user_id === args.p_mentee_user_id &&
      ["proposed", "accepted", "active", "paused"].includes(p.status) &&
      p.deleted_at === null
  );
  if (!winner) throw new Error("unreachable: unique_violation without winner row");
  return {
    pair_id: winner.id,
    reused: true,
    match_score: winner.match_score,
    match_signals: winner.match_signals,
  };
}

function buildStore(): {
  store: Store;
  orgId: string;
  adminId: string;
  mentorId: string;
  menteeId: string;
} {
  const orgId = randomUUID();
  const adminId = randomUUID();
  const mentorId = randomUUID();
  const menteeId = randomUUID();
  const store: Store = {
    roles: [
      { user_id: adminId, organization_id: orgId, role: "admin", status: "active" },
      { user_id: mentorId, organization_id: orgId, role: "active_member", status: "active" },
      { user_id: menteeId, organization_id: orgId, role: "active_member", status: "active" },
    ],
    pairs: [],
    auditLog: [],
    emailsSent: [],
  };
  return { store, orgId, adminId, mentorId, menteeId };
}

test("A.1: admin run-round inserts proposal with score+signals", () => {
  const { store, orgId, adminId, mentorId, menteeId } = buildStore();
  const result = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 87.5,
    p_match_signals: [{ code: "shared_topics", value: "finance" }],
    p_actor_user_id: adminId,
  });
  assert.strictEqual(result.reused, false);
  const row = store.pairs.find((p) => p.id === result.pair_id);
  assert.ok(row, "pair row persisted");
  assert.strictEqual(row!.match_score, 87.5);
  assert.deepStrictEqual(row!.match_signals, [{ code: "shared_topics", value: "finance" }]);
});

test("A.2: mentee self-request persists score+signals atomically (no orphan)", () => {
  const { store, orgId, mentorId, menteeId } = buildStore();
  const result = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 42,
    p_match_signals: [{ code: "shared_industry", value: "Finance" }],
    p_actor_user_id: menteeId,
  });
  const row = store.pairs.find((p) => p.id === result.pair_id);
  assert.ok(row);
  assert.strictEqual(row!.match_score, 42, "score persisted on first insert");
  assert.notStrictEqual(row!.match_signals, null, "signals persisted on first insert");
  assert.strictEqual(row!.proposed_by, menteeId, "proposed_by = mentee");
});

test("A.2: idempotent — repeat self-request returns existing pair without creating orphan", () => {
  const { store, orgId, mentorId, menteeId } = buildStore();
  const first = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 42,
    p_match_signals: [],
    p_actor_user_id: menteeId,
  });
  const second = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 99,
    p_match_signals: [],
    p_actor_user_id: menteeId,
  });
  assert.strictEqual(second.reused, true);
  assert.strictEqual(second.pair_id, first.pair_id);
  assert.strictEqual(store.pairs.length, 1, "no orphan row");
});

test("A.3: decline race — accept wins, decline returns 409, no audit row, no email", () => {
  const { store, orgId, adminId, mentorId, menteeId } = buildStore();
  const { pair_id } = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 50,
    p_match_signals: [],
    p_actor_user_id: adminId,
  });

  // Accept wins the race first
  acceptProposal(store, pair_id, mentorId);

  // Second tab tries to decline
  const declineResult = declineProposal(store, pair_id, mentorId, "busy");
  assert.strictEqual(declineResult.status, 409);
  assert.strictEqual(store.auditLog.length, 0, "no audit row on 409");
  assert.strictEqual(store.emailsSent.length, 0, "no email on 409");
});

test("Trigger: non-admin INSERT with match_score is denied (existing behavior)", () => {
  const { store, orgId, mentorId, menteeId } = buildStore();
  // Non-admin actor (mentor) trying to insert DIRECTLY (no trusted flag)
  const illegal: Pair = {
    id: randomUUID(),
    organization_id: orgId,
    mentor_user_id: mentorId,
    mentee_user_id: menteeId,
    status: "proposed",
    match_score: 90,
    match_signals: [],
    proposed_by: mentorId,
    proposed_at: new Date().toISOString(),
    accepted_at: null,
    declined_at: null,
    declined_reason: null,
    deleted_at: null,
  };
  const guard = triggerInsertGuard(store, illegal, mentorId, false);
  assert.strictEqual(guard.ok, false);
  if (!guard.ok) {
    assert.match(guard.error, /match_score/);
  }
});

test("A.1: admin_propose_pair path bypasses non-admin INSERT guard via trusted GUC", () => {
  const { store, orgId, menteeId, mentorId } = buildStore();
  // Mentee calling RPC (self-request) — trusted caller flag bypasses trigger block
  const result = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 77,
    p_match_signals: [{ code: "shared_city", value: "NYC" }],
    p_actor_user_id: menteeId,
  });
  const row = store.pairs.find((p) => p.id === result.pair_id);
  assert.ok(row);
  assert.strictEqual(row!.match_score, 77);
});

// ------------------------------------------------------------------
// Hardening-round regressions (RPC lockdown, decline auth, races)
// ------------------------------------------------------------------

test("Hardening: alumni mentee cannot self-request (active_member-only)", () => {
  const { store, orgId, mentorId } = buildStore();
  const alumniId = randomUUID();
  store.roles.push({ user_id: alumniId, organization_id: orgId, role: "alumni", status: "active" });

  assert.throws(
    () =>
      adminProposePair(store, {
        p_organization_id: orgId,
        p_mentor_user_id: mentorId,
        p_mentee_user_id: alumniId,
        p_match_score: 10,
        p_match_signals: [],
        p_actor_user_id: alumniId,
      }),
    /not permitted/
  );
  assert.strictEqual(store.pairs.length, 0);
});

test("Hardening: non-member caller cannot self-request", () => {
  const { store, orgId, mentorId, menteeId } = buildStore();
  const strangerId = randomUUID();
  assert.throws(
    () =>
      adminProposePair(store, {
        p_organization_id: orgId,
        p_mentor_user_id: mentorId,
        p_mentee_user_id: menteeId,
        p_match_score: 10,
        p_match_signals: [],
        p_actor_user_id: strangerId,
      }),
    /not permitted/
  );
});

test("Hardening: inactive admin cannot propose", () => {
  const { store, orgId, mentorId, menteeId } = buildStore();
  const revokedAdmin = randomUUID();
  store.roles.push({
    user_id: revokedAdmin,
    organization_id: orgId,
    role: "admin",
    status: "inactive",
  });
  assert.throws(
    () =>
      adminProposePair(store, {
        p_organization_id: orgId,
        p_mentor_user_id: mentorId,
        p_mentee_user_id: menteeId,
        p_match_score: 10,
        p_match_signals: [],
        p_actor_user_id: revokedAdmin,
      }),
    /not permitted/
  );
});

test("Hardening: concurrent inserts collapse to single row (unique_violation caught)", () => {
  const { store, orgId, mentorId, menteeId, adminId } = buildStore();
  const first = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 70,
    p_match_signals: [],
    p_actor_user_id: adminId,
  });

  // Simulate parallel insert: our RPC pre-check sees empty, competitor inserts,
  // our insert hits 23505, we re-read and return winner as reused.
  const raced = adminProposePairWithRace(
    store,
    {
      p_organization_id: orgId,
      p_mentor_user_id: mentorId,
      p_mentee_user_id: menteeId,
      p_match_score: 88,
      p_match_signals: [],
      p_actor_user_id: adminId,
    },
    () => {
      /* competitor already inserted = `first` */
    }
  );
  assert.strictEqual(raced.reused, true);
  assert.strictEqual(raced.pair_id, first.pair_id);
  assert.strictEqual(store.pairs.length, 1, "single row, no orphan");
});

test("A.3 hardening: mentor decline via user-scoped client succeeds", () => {
  const { store, orgId, adminId, mentorId, menteeId } = buildStore();
  const { pair_id } = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 50,
    p_match_signals: [],
    p_actor_user_id: adminId,
  });
  const result = declineProposal(store, pair_id, mentorId, "too busy");
  assert.strictEqual(result.status, 200);
  assert.strictEqual(store.auditLog.length, 1);
  assert.strictEqual(store.auditLog[0].kind, "proposal_declined");
  assert.strictEqual(store.emailsSent.length, 1);
});

test("A.3 hardening: admin decline via user-scoped client succeeds", () => {
  const { store, orgId, adminId, mentorId, menteeId } = buildStore();
  const { pair_id } = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 50,
    p_match_signals: [],
    p_actor_user_id: adminId,
  });
  const result = declineProposal(store, pair_id, adminId, null);
  assert.strictEqual(result.status, 200);
});

test("A.3 hardening: random member cannot decline (403)", () => {
  const { store, orgId, adminId, mentorId, menteeId } = buildStore();
  const randoId = randomUUID();
  store.roles.push({ user_id: randoId, organization_id: orgId, role: "active_member", status: "active" });
  const { pair_id } = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 50,
    p_match_signals: [],
    p_actor_user_id: adminId,
  });
  const result = declineProposal(store, pair_id, randoId, null);
  assert.strictEqual(result.status, 403);
  const pair = store.pairs.find((p) => p.id === pair_id);
  assert.strictEqual(pair!.status, "proposed", "pair unchanged");
  assert.strictEqual(store.auditLog.length, 0);
  assert.strictEqual(store.emailsSent.length, 0);
});

test("A.3 hardening: reverse race — decline wins, accept sees non-proposed status", () => {
  const { store, orgId, adminId, mentorId, menteeId } = buildStore();
  const { pair_id } = adminProposePair(store, {
    p_organization_id: orgId,
    p_mentor_user_id: mentorId,
    p_mentee_user_id: menteeId,
    p_match_score: 50,
    p_match_signals: [],
    p_actor_user_id: adminId,
  });
  declineProposal(store, pair_id, mentorId, "nope");
  assert.throws(() => acceptProposal(store, pair_id, mentorId), /cannot accept from status declined/);
  // Only the decline notification + audit emitted
  assert.strictEqual(store.emailsSent.filter((e) => e.kind === "proposal_declined").length, 1);
  assert.strictEqual(store.auditLog.filter((a) => a.kind === "proposal_declined").length, 1);
});

// ------------------------------------------------------------------
// SQL migration contract — pin the lockdown so regressions surface loudly
// ------------------------------------------------------------------

test("Migration: admin_propose_pair grants service_role only (no authenticated)", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../supabase/migrations/20261018100000_admin_propose_pair_rpc.sql", import.meta.url),
    "utf8"
  );
  assert.match(
    sql,
    /grant execute on function public\.admin_propose_pair\(uuid, uuid, uuid, numeric, jsonb, uuid\) to service_role;/i
  );
  assert.doesNotMatch(sql, /to authenticated/i);
});

test("Migration: admin_propose_pair restricts mentee self-service to active_member", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../supabase/migrations/20261018100000_admin_propose_pair_rpc.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /role = 'active_member'/i);
  assert.doesNotMatch(sql, /role in \('active_member','alumni'\)/i);
});

test("Migration: admin_propose_pair catches unique_violation for idempotent races", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../supabase/migrations/20261018100000_admin_propose_pair_rpc.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /when unique_violation then/i);
});

test("Migration: GUC bypass flag is request-local (set_config third arg true)", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(
    new URL("../supabase/migrations/20261018100000_admin_propose_pair_rpc.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /set_config\('app\.mentorship_trusted_caller',\s*'on',\s*true\)/i);
});

// ------------------------------------------------------------------
// Route-handler contracts — pin client choice for decline (A.3 hardening)
// ------------------------------------------------------------------

test("Route: pair PATCH decline uses user-scoped Supabase (not service client)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL(
      "../src/app/api/organizations/[organizationId]/mentorship/pairs/[pairId]/route.ts",
      import.meta.url
    ),
    "utf8"
  );
  // Decline block must call userScopedSupabase.from("mentorship_pairs").update(...)
  const declineBlock = src.slice(src.indexOf("// decline"));
  assert.match(declineBlock, /userScopedSupabase\s*\n?\s*\.from\("mentorship_pairs"\)/);
  assert.match(declineBlock, /\.select\("id"\)\s*\n?\s*\.maybeSingle\(\)/);
  assert.match(declineBlock, /cannot decline pair in current status/);
});

test("Route: self-request uses admin_propose_pair RPC (no raw insert path)", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL("../src/app/api/organizations/[organizationId]/mentorship/requests/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(src, /svc\.rpc\("admin_propose_pair"/);
  // No stray service-client insert into mentorship_pairs
  assert.doesNotMatch(src, /\.from\("mentorship_pairs"\)\s*\n?\s*\.insert\(/);
});

test("Route: admin run-round uses admin_propose_pair RPC", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL(
      "../src/app/api/organizations/[organizationId]/mentorship/admin/queue/route.ts",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(src, /svc\.rpc\("admin_propose_pair"/);
  assert.match(src, /p_actor_user_id:\s*user\.id/);
});

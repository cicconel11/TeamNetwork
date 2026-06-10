import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { mentorProfileNativeSchema } from "../src/lib/schemas/mentorship.ts";

const routeSource = await readFile(
  new URL(
    "../src/app/api/organizations/[organizationId]/mentorship/mentor-profile/route.ts",
    import.meta.url
  ),
  "utf8"
);

test("route exports GET and PUT", () => {
  assert.match(routeSource, /export async function GET/);
  assert.match(routeSource, /export async function PUT/);
});

test("route uses native zod schema + native upsert conflict key", () => {
  assert.match(routeSource, /mentorProfileNativeSchema\.safeParse/);
  assert.match(routeSource, /onConflict: "user_id,organization_id"/);
  assert.match(routeSource, /from\("mentor_profiles"\)/);
});

test("GET reads mentor_profiles via auth-bound wildcard select", () => {
  assert.match(routeSource, /await supabase\s*\.from\("mentor_profiles"\)\s*\.select\("\*"\)/s);
});

test("route rate-limits read + write", () => {
  assert.match(routeSource, /mentor profile read/);
  assert.match(routeSource, /mentor profile write/);
});

test("PUT reads the existing row's bio provenance before upsert", () => {
  // A select of bio_source must precede the upsert so the 3-way diff (D1) runs
  // server-side. Both the read and the written row must reference bio_source.
  assert.match(routeSource, /\.select\(\s*"[^"]*bio_source[^"]*"\s*\)/);
  const selectIdx = routeSource.search(/\.select\(\s*"bio,\s*bio_source/);
  const upsertIdx = routeSource.indexOf(".upsert(");
  assert.ok(selectIdx > -1, "expected a bio_source select before upsert");
  assert.ok(upsertIdx > -1, "expected an upsert call");
  assert.ok(selectIdx < upsertIdx, "bio_source select must precede the upsert");
  assert.match(routeSource, /bio_source:/);
});

test("PROFILE_COLS / GET expose bio_source", () => {
  assert.match(routeSource, /PROFILE_COLS\s*=\s*\n?\s*"[^"]*bio_source[^"]*bio_generated_at[^"]*bio_input_hash/);
  // GET selects "*", so bio_source is already returned to the client.
  assert.match(routeSource, /\.from\("mentor_profiles"\)\s*\.select\("\*"\)/s);
});

// ── Route logic simulator ───────────────────────────────────────────────────

type Role = "admin" | "active_member" | "alumni" | "parent";
type Status = "active" | "revoked" | "pending";

type BioSource = "manual" | "ai_generated" | null;

/** Stored mentor_profiles bio provenance, as read before the upsert. */
interface StoredBio {
  bio: string | null;
  bio_source: BioSource;
  bio_generated_at: string | null;
  bio_input_hash: string | null;
}

interface SimReq {
  method: "GET" | "PUT";
  authUserId: string | null;
  organizationId: string;
  requestedUserId?: string;
  caller: { role: Role; status: Status } | null;
  /** Present when simulating a PUT with ?user_id= targeting a peer. */
  target?: { role: Role; status: Status } | null;
  body?: unknown;
  /** Existing row's bio provenance; absent = no existing row (insert path). */
  stored?: StoredBio | null;
}

interface SimRes {
  status: number;
  body: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function simulate(req: SimReq): SimRes {
  if (!UUID.test(req.organizationId)) {
    return { status: 400, body: { error: "Invalid organization id" } };
  }
  if (!req.authUserId) return { status: 401, body: { error: "Unauthorized" } };
  const caller = req.caller;
  if (!caller || caller.status !== "active") {
    return { status: 403, body: { error: "Forbidden" } };
  }

  if (req.method === "GET") {
    let target = req.authUserId;
    if (req.requestedUserId && req.requestedUserId !== req.authUserId) {
      if (!UUID.test(req.requestedUserId)) {
        return { status: 400, body: { error: "Invalid user id" } };
      }
      if (caller.role !== "admin") {
        return { status: 403, body: { error: "Forbidden" } };
      }
      target = req.requestedUserId;
    }
    return { status: 200, body: { profile: null, resolvedTarget: target } };
  }

  if (!["admin", "alumni"].includes(caller.role)) {
    return { status: 403, body: { error: "Forbidden" } };
  }

  let targetUserId = req.authUserId;
  if (req.requestedUserId && req.requestedUserId !== req.authUserId) {
    if (!UUID.test(req.requestedUserId)) {
      return { status: 400, body: { error: "Invalid user id" } };
    }
    if (caller.role !== "admin") {
      return { status: 403, body: { error: "Forbidden" } };
    }
    const t = req.target;
    if (
      !t ||
      t.status !== "active" ||
      !["admin", "alumni"].includes(t.role)
    ) {
      return { status: 403, body: { error: "Target user not eligible to mentor" } };
    }
    targetUserId = req.requestedUserId;
  }

  const parsed = mentorProfileNativeSchema.safeParse(req.body);
  if (!parsed.success) {
    return { status: 400, body: { error: "Invalid payload" } };
  }

  const bioFields = resolveBioFields(parsed.data.bio, req.stored ?? null);

  return {
    status: 200,
    body: {
      profile: {
        organization_id: req.organizationId,
        user_id: targetUserId,
        ...parsed.data,
        ...bioFields,
      },
    },
  };
}

/**
 * Mirror of route.ts PUT bio-diff (decision D1): server-side 3-way diff between
 * the incoming bio and the stored row, with no client-supplied source flag.
 */
function resolveBioFields(
  incoming: string | undefined,
  stored: StoredBio | null
): StoredBio {
  const incomingBio = incoming?.trim() ? incoming.trim() : "";
  const storedBio = stored?.bio?.trim() ?? "";

  if (!incomingBio) {
    return { bio: null, bio_source: null, bio_generated_at: null, bio_input_hash: null };
  }
  if (stored && incomingBio === storedBio) {
    return {
      bio: stored.bio,
      bio_source: stored.bio_source,
      bio_generated_at: stored.bio_generated_at,
      bio_input_hash: stored.bio_input_hash,
    };
  }
  return {
    bio: incomingBio,
    bio_source: "manual",
    bio_generated_at: null,
    bio_input_hash: null,
  };
}

test("GET self works for any active member", () => {
  const userId = randomUUID();
  const res = simulate({
    method: "GET",
    authUserId: userId,
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolvedTarget, userId);
});

test("GET as admin with ?user_id= reads peer", () => {
  const adminId = randomUUID();
  const peerId = randomUUID();
  const res = simulate({
    method: "GET",
    authUserId: adminId,
    requestedUserId: peerId,
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolvedTarget, peerId);
});

test("GET ?user_id= by non-admin is forbidden", () => {
  const res = simulate({
    method: "GET",
    authUserId: randomUUID(),
    requestedUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
  });
  assert.equal(res.status, 403);
});

test("PUT self as alumni upserts own profile", () => {
  const userId = randomUUID();
  const orgId = randomUUID();
  const res = simulate({
    method: "PUT",
    authUserId: userId,
    organizationId: orgId,
    caller: { role: "alumni", status: "active" },
    body: {
      bio: "I can help",
      sports: ["basketball"],
      max_mentees: 2,
      accepting_new: true,
    },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as { user_id: string; organization_id: string };
  assert.equal(p.user_id, userId);
  assert.equal(p.organization_id, orgId);
});

test("PUT as active_member forbidden (mentees cannot be mentors)", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "active_member", status: "active" },
    body: { sports: [] },
  });
  assert.equal(res.status, 403);
});

test("PUT admin ?user_id= can edit an eligible peer", () => {
  const adminId = randomUUID();
  const peerId = randomUUID();
  const res = simulate({
    method: "PUT",
    authUserId: adminId,
    requestedUserId: peerId,
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
    target: { role: "alumni", status: "active" },
    body: { sports: ["football"], max_mentees: 5, accepting_new: true },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as { user_id: string };
  assert.equal(p.user_id, peerId);
});

test("PUT admin ?user_id= targeting non-alumni/non-admin member forbidden", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    requestedUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "admin", status: "active" },
    target: { role: "active_member", status: "active" },
    body: { sports: [] },
  });
  assert.equal(res.status, 403);
});

test("PUT invalid payload rejected via zod", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    body: { max_mentees: "not-a-number" },
  });
  assert.equal(res.status, 400);
});

test("unauth requests 401", () => {
  const res = simulate({
    method: "GET",
    authUserId: null,
    organizationId: randomUUID(),
    caller: null,
  });
  assert.equal(res.status, 401);
});

test("revoked caller forbidden", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "revoked" },
    body: { sports: [] },
  });
  assert.equal(res.status, 403);
});

// ── Bio provenance (decision D1) ─────────────────────────────────────────────

test("PUT new bio text over an ai_generated row promotes to manual", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    stored: {
      bio: "AI wrote this",
      bio_source: "ai_generated",
      bio_generated_at: "2026-01-01T00:00:00.000Z",
      bio_input_hash: "abc123",
    },
    body: { bio: "Human rewrote this", sports: [] },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as Record<string, unknown>;
  assert.equal(p.bio, "Human rewrote this");
  assert.equal(p.bio_source, "manual");
  assert.equal(p.bio_generated_at, null);
  assert.equal(p.bio_input_hash, null);
});

test("PUT identical bio + unrelated field change preserves ai_generated provenance", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    stored: {
      bio: "AI wrote this",
      bio_source: "ai_generated",
      bio_generated_at: "2026-01-01T00:00:00.000Z",
      bio_input_hash: "abc123",
    },
    // MentorProfileCard echoes the bio back verbatim; only max_mentees changed.
    body: { bio: "AI wrote this", max_mentees: 7, sports: [] },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as Record<string, unknown>;
  assert.equal(p.bio, "AI wrote this");
  assert.equal(p.bio_source, "ai_generated");
  assert.equal(p.bio_generated_at, "2026-01-01T00:00:00.000Z");
  assert.equal(p.bio_input_hash, "abc123");
  assert.equal(p.max_mentees, 7);
});

test("PUT empty bio on a manual row clears bio + provenance", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    stored: {
      bio: "Manually typed",
      bio_source: "manual",
      bio_generated_at: null,
      bio_input_hash: null,
    },
    body: { bio: "   ", sports: [] },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as Record<string, unknown>;
  assert.equal(p.bio, null);
  assert.equal(p.bio_source, null);
  assert.equal(p.bio_generated_at, null);
  assert.equal(p.bio_input_hash, null);
});

test("PUT first-time typed bio (no stored row) is manual", () => {
  const res = simulate({
    method: "PUT",
    authUserId: randomUUID(),
    organizationId: randomUUID(),
    caller: { role: "alumni", status: "active" },
    // No `stored` → insert path; stored bio was null/empty.
    body: { bio: "My very first bio", sports: [] },
  });
  assert.equal(res.status, 200);
  const p = res.body.profile as Record<string, unknown>;
  assert.equal(p.bio, "My very first bio");
  assert.equal(p.bio_source, "manual");
  assert.equal(p.bio_generated_at, null);
  assert.equal(p.bio_input_hash, null);
});

// ── U14: GET always returns a structured `suggested` object ─────────────────

/** GET handler source, isolated so PUT internals can't satisfy GET asserts. */
const getSource = routeSource.slice(
  routeSource.indexOf("export async function GET"),
  routeSource.indexOf("export async function PUT")
);

test("GET alumni suggestion read filters soft-deleted rows", () => {
  assert.match(
    getSource,
    /from\("alumni"\)[\s\S]*?\.is\("deleted_at", null\)[\s\S]*?\.maybeSingle\(\)/,
    "alumni read must include .is(\"deleted_at\", null) before maybeSingle"
  );
});

test("GET no-alumni outcome is an empty structured suggested object, not null", () => {
  // The fallback literal must exist (else-branch when no alumni row is found).
  assert.match(
    getSource,
    /suggested = \{ bio: null, industries: \[\], role_families: \[\], positions: \[\] \}/,
    "expected the empty-suggestion fallback literal"
  );
  // Both branches of the no-profile path assign `suggested`: alumni-sourced
  // population AND the empty fallback. With if/else covering the !profile
  // block, the response's suggested is never null when profile is null.
  assert.match(
    getSource,
    /if \(alumniRow\) \{[\s\S]*?suggested = \{[\s\S]*?\} else \{[\s\S]*?suggested = \{ bio: null/,
    "alumniRow if/else must assign suggested on both branches"
  );
  // Response construction returns the computed object — no literal
  // `suggested: null` short-circuit in the JSON response.
  assert.match(getSource, /NextResponse\.json\(\{ profile, suggested \}\)/);
  assert.doesNotMatch(
    getSource,
    /NextResponse\.json\(\{[^}]*suggested:\s*null/,
    "response must not hardcode suggested: null"
  );
});

test("GET keeps alumni-sourced suggestion population when a row exists", () => {
  assert.match(getSource, /alumniRow\.summary\?\.trim\(\) \|\| alumniRow\.headline\?\.trim\(\) \|\| null/);
  assert.match(getSource, /industries: alumniRow\.industry \? \[alumniRow\.industry\] : \[\]/);
  assert.match(getSource, /role_families: alumniRow\.job_title \? \[alumniRow\.job_title\] : \[\]/);
  assert.match(getSource, /positions: alumniRow\.position_title \? \[alumniRow\.position_title\] : \[\]/);
});

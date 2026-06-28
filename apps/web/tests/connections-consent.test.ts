/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(rel: string): Promise<string> {
  return readFile(new URL(rel, import.meta.url), "utf8");
}

const migration = await read(
  "../../../supabase/migrations/20261227000000_open_to_networking_flag.sql"
);
const consentRoute = await read(
  "../src/app/api/organizations/[organizationId]/connections/networking-consent/route.ts"
);
const toggle = await read("../src/components/connections/NetworkingConsentToggle.tsx");
const directChat = await read("../src/lib/chat/profile-direct-chat.ts");

// ── Migration: one flag on all three tables + owner-only trigger ──────────────

test("migration adds open_to_networking to members, alumni, AND parents", () => {
  for (const tbl of ["members", "alumni", "parents"]) {
    assert.match(
      migration,
      new RegExp(`ALTER TABLE public\\.${tbl}[\\s\\S]*?open_to_networking boolean NOT NULL DEFAULT false`),
      `${tbl} should get the column`
    );
  }
});

test("migration enforces owner-only changes via a trigger (admins can't flip another's consent)", () => {
  // The guard requires auth.uid() = NEW.user_id; a NULL user_id (unclaimed) or a
  // NULL auth.uid() (service role / admin acting on another row) is rejected.
  assert.match(migration, /enforce_open_to_networking_owner/);
  assert.match(migration, /NEW\.user_id IS NULL OR auth\.uid\(\) IS NULL OR auth\.uid\(\) <> NEW\.user_id/);
  assert.match(migration, /RAISE EXCEPTION/);
  for (const tbl of ["members", "alumni", "parents"]) {
    assert.match(
      migration,
      new RegExp(`CREATE TRIGGER ${tbl}_open_to_networking_owner`),
      `${tbl} should have the trigger`
    );
  }
});

test("migration is additive and idempotent (IF NOT EXISTS, no backfill)", () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS open_to_networking/);
  assert.doesNotMatch(migration, /UPDATE public\.(members|alumni|parents) SET open_to_networking = true/);
});

// ── Consent route: owner-only, member-gated, user-client write ────────────────

test("consent route is gated on chat-eligible roles (normalized), not admin-only", () => {
  assert.match(consentRoute, /CHAT_ELIGIBLE_ORG_ROLES/);
  assert.match(consentRoute, /normalizeRole/);
  assert.doesNotMatch(consentRoute, /role !== "admin"/);
  assert.match(consentRoute, /Forbidden/);
});

test("consent PATCH writes the viewer's OWN rows only, on the user (RLS) client", () => {
  // Scoped by user_id = viewer; the update runs on the cookie-bound `supabase`
  // (user/RLS) client so auth.uid() is present for the DB trigger.
  assert.match(consentRoute, /\.eq\("user_id", user\.id\)/);
  assert.match(consentRoute, /\(supabase as any\)\s*\n\s*\.from\(table\)\s*\n\s*\.update\(\{ open_to_networking: body\.open_to_networking \}\)/);
  // The service client exists solely to verify membership — its only use is the
  // getOrgMembership call; it is never chained to a write.
  assert.match(consentRoute, /getOrgMembership\(serviceSupabase/);
  assert.doesNotMatch(consentRoute, /serviceSupabase\b[^;]*\.update\(/);
  assert.doesNotMatch(consentRoute, /\(serviceSupabase as any\)/);
});

test("consent PATCH validates a boolean body and reports no-profile distinctly", () => {
  assert.match(consentRoute, /open_to_networking: z\.boolean\(\)/);
  assert.match(consentRoute, /code: "no_profile"/);
});

// ── Toggle UI: optimistic with rollback, graceful 409 ─────────────────────────

test("toggle PATCHes the consent endpoint and rolls back on failure", () => {
  assert.match(toggle, /networking-consent/);
  assert.match(toggle, /method: "PATCH"/);
  assert.match(toggle, /setChecked\(previous\)/); // rollback
});

test("toggle handles the no-profile 409 gracefully instead of flipping", () => {
  assert.match(toggle, /res\.status === 409/);
  assert.match(toggle, /noProfileMessage/);
});

// ── Direct chat: parent profile type + server-side consent re-check ───────────

test("direct-chat accepts the parent profile type and re-checks consent server-side", () => {
  assert.match(directChat, /ProfileDirectChatType = "member" \| "alumni" \| "parent"/);
  assert.match(directChat, /input\.profileType === "parent" && profile\.open_to_networking !== true/);
});

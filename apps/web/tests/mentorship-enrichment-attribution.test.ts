import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveEnrichedProfiles } from "@/lib/profile/enriched-fields";
import { createSupabaseStub } from "./utils/supabaseStub";

const ORG = "11111111-1111-1111-1111-111111111111";
// Reproduces the real "CHSFL" collision: a member (Keoleian) and a DIFFERENT
// person's alumni record (Marcus Reed, Goldman Sachs) sharing one user_id.
const KEOLEIAN = "79c0c61f-ff37-44e5-868d-bc676be69115";

type Stub = ReturnType<typeof createSupabaseStub>;
const asClient = (stub: Stub) => stub as never;

test("cross-person collision: mentor card shows the member's OWN profile, not the colliding alumni's", async () => {
  const stub = createSupabaseStub();
  // Member Keoleian — his own profile has no enriched company yet.
  stub.seed("members", [
    {
      organization_id: ORG,
      user_id: KEOLEIAN,
      first_name: "Michael",
      last_name: "Keoleian",
      current_company: null,
      industry: null,
      current_city: null,
      deleted_at: null,
    },
  ]);
  // A different person's alumni record wrongly stamped with Keoleian's user_id.
  stub.seed("alumni", [
    {
      organization_id: ORG,
      user_id: KEOLEIAN,
      first_name: "Marcus",
      last_name: "Reed",
      current_company: "Goldman Sachs",
      industry: "Finance",
      current_city: "New York",
      deleted_at: null,
    },
  ]);

  const resolved = await resolveEnrichedProfiles(asClient(stub), ORG, [KEOLEIAN]);
  const fields = resolved.get(KEOLEIAN);

  assert.ok(fields, "expected resolved fields for the mentor");
  // The bug: card rendered "Goldman Sachs / Finance" (Marcus Reed's data).
  // The fix: the member's own row wins — no foreign data bleeds in.
  assert.equal(fields.current_company, null);
  assert.equal(fields.industry, null);
  assert.notEqual(fields.current_company, "Goldman Sachs");
});

test("alumni-only person (no member row) still resolves from their own alumni record", async () => {
  const stub = createSupabaseStub();
  const alum = "22222222-2222-2222-2222-222222222222";
  stub.seed("alumni", [
    {
      organization_id: ORG,
      user_id: alum,
      first_name: "Jane",
      last_name: "Doe",
      current_company: "Acme Corp",
      industry: "Manufacturing",
      job_title: "Engineer",
      deleted_at: null,
    },
  ]);

  const resolved = await resolveEnrichedProfiles(asClient(stub), ORG, [alum]);
  const fields = resolved.get(alum);

  assert.equal(fields?.current_company, "Acme Corp");
  assert.equal(fields?.industry, "Manufacturing");
  assert.equal(fields?.job_title, "Engineer");
});

test("members row is preferred over a same-user alumni row (profile-page consistency)", async () => {
  const stub = createSupabaseStub();
  const user = "33333333-3333-3333-3333-333333333333";
  stub.seed("members", [
    {
      organization_id: ORG,
      user_id: user,
      current_company: "Current Employer",
      industry: "Tech",
      deleted_at: null,
    },
  ]);
  stub.seed("alumni", [
    {
      organization_id: ORG,
      user_id: user,
      current_company: "Old Employer",
      industry: "Other",
      deleted_at: null,
    },
  ]);

  const resolved = await resolveEnrichedProfiles(asClient(stub), ORG, [user]);
  assert.equal(resolved.get(user)?.current_company, "Current Employer");
  assert.equal(resolved.get(user)?.industry, "Tech");
});

test("soft-deleted rows are ignored", async () => {
  const stub = createSupabaseStub();
  const user = "44444444-4444-4444-4444-444444444444";
  stub.seed("members", [
    {
      organization_id: ORG,
      user_id: user,
      current_company: "Deleted Co",
      industry: "Gone",
      deleted_at: "2026-01-01T00:00:00Z",
    },
  ]);

  const resolved = await resolveEnrichedProfiles(asClient(stub), ORG, [user]);
  // No live row → empty fields, never the soft-deleted company.
  assert.equal(resolved.get(user)?.current_company, null);
});

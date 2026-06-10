import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

import {
  GLOBAL_FROM_EMAIL,
  invalidateSenderCache,
  resolveOrgSender,
} from "@/lib/notifications/sender";
import { createSupabaseStub } from "./utils/supabaseStub";

function asClient(stub: ReturnType<typeof createSupabaseStub>): SupabaseClient<Database> {
  return stub as never;
}

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const ORG_C = "33333333-3333-4333-8333-333333333333";
const ORG_D = "44444444-4444-4444-8444-444444444444";
const ORG_E = "55555555-5555-4555-8555-555555555555";

test("verified domain resolves to a branded from address", async () => {
  invalidateSenderCache();
  const stub = createSupabaseStub();
  stub.seed("organization_email_domains", [
    {
      organization_id: ORG_A,
      domain: "villanova.edu",
      status: "verified",
      sender_local_part: "noreply",
      sender_display_name: "Villanova Football",
    },
  ]);

  const sender = await resolveOrgSender(asClient(stub), ORG_A);
  assert.equal(sender.from, "Villanova Football <noreply@villanova.edu>");
  assert.equal(sender.isCustomDomain, true);
});

test("missing or unverified rows fall back to the global sender", async () => {
  invalidateSenderCache();
  const stub = createSupabaseStub();
  stub.seed("organization_email_domains", [
    {
      organization_id: ORG_B,
      domain: "pending.edu",
      status: "pending",
      sender_local_part: "noreply",
      sender_display_name: null,
    },
  ]);

  const pending = await resolveOrgSender(asClient(stub), ORG_B);
  assert.equal(pending.from, GLOBAL_FROM_EMAIL);
  assert.equal(pending.isCustomDomain, false);

  const missing = await resolveOrgSender(asClient(stub), ORG_C);
  assert.equal(missing.from, GLOBAL_FROM_EMAIL);
  assert.equal(missing.isCustomDomain, false);
});

test("display name falls back to org name and is sanitized", async () => {
  invalidateSenderCache();
  const stub = createSupabaseStub();
  stub.seed("organizations", [{ id: ORG_D, slug: "spoofy", name: 'Spoofy <evil@bad.com>\r\n"Org"' }]);
  stub.seed("organization_email_domains", [
    {
      organization_id: ORG_D,
      domain: "spoofy.edu",
      status: "verified",
      sender_local_part: "hello",
      sender_display_name: null,
    },
  ]);

  const sender = await resolveOrgSender(asClient(stub), ORG_D);
  assert.equal(sender.from, "Spoofy evil@bad.comOrg <hello@spoofy.edu>");
  assert.ok(!/[<>"\r\n]/.test(sender.from.split(" <")[0]));
});

test("results are cached per org and invalidation clears them", async () => {
  invalidateSenderCache();
  const stub = createSupabaseStub();
  stub.seed("organization_email_domains", [
    {
      organization_id: ORG_E,
      domain: "cached.edu",
      status: "verified",
      sender_local_part: "noreply",
      sender_display_name: "Cached U",
    },
  ]);

  const first = await resolveOrgSender(asClient(stub), ORG_E);
  assert.equal(first.from, "Cached U <noreply@cached.edu>");

  // Mutate underlying data; cache should still serve the old value...
  stub.clear("organization_email_domains");
  const cached = await resolveOrgSender(asClient(stub), ORG_E);
  assert.equal(cached.from, "Cached U <noreply@cached.edu>");

  // ...until invalidated.
  invalidateSenderCache(ORG_E);
  const fresh = await resolveOrgSender(asClient(stub), ORG_E);
  assert.equal(fresh.from, GLOBAL_FROM_EMAIL);
});

test("query errors fall back to the global sender without caching", async () => {
  invalidateSenderCache();
  const stub = createSupabaseStub();
  stub.simulateError("organization_email_domains", { message: "boom" });

  const sender = await resolveOrgSender(asClient(stub), ORG_A);
  assert.equal(sender.from, GLOBAL_FROM_EMAIL);
  assert.equal(sender.isCustomDomain, false);
});

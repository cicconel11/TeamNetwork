import test from "node:test";
import assert from "node:assert";
import {
  checkHostStatus,
} from "../src/lib/schedule-security/allowlist.ts";

// Minimal Supabase stub for schedule_allowed_domains
function createAllowlistStub(domains: Array<{
  id: string;
  hostname: string;
  vendor_id: string;
  status: string;
  verified_by_org_id: string | null;
}>) {
  return {
    from: (table: string) => {
      if (table === "schedule_domain_rules") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      if (table === "schedule_allowed_domains") {
        return {
          select: () => ({
            eq: (col: string, val: string) => ({
              in: () => ({
                maybeSingle: () => {
                  const match = domains.find((d) => d.hostname === val);
                  return Promise.resolve({ data: match ?? null, error: null });
                },
              }),
              maybeSingle: () => {
                const match = domains.find((d) => d.hostname === val);
                return Promise.resolve({ data: match ?? null, error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("checkHostStatus returns verifiedByOrgId for pending domains", async () => {
  const stub = createAllowlistStub([
    {
      id: "domain-1",
      hostname: "athletics.example.edu",
      vendor_id: "sidearmsports",
      status: "pending",
      verified_by_org_id: "org-a",
    },
  ]);

  const result = await checkHostStatus(
    "athletics.example.edu",
    undefined,
    stub as never
  );

  assert.strictEqual(result.status, "pending");
  assert.strictEqual(result.source, "domain");
  assert.strictEqual(result.verifiedByOrgId, "org-a");
  assert.strictEqual(result.domainId, "domain-1");
});

test("checkHostStatus returns undefined verifiedByOrgId for active domains", async () => {
  const stub = createAllowlistStub([
    {
      id: "domain-2",
      hostname: "sports.example.edu",
      vendor_id: "sidearmsports",
      status: "active",
      verified_by_org_id: "org-b",
    },
  ]);

  const result = await checkHostStatus(
    "sports.example.edu",
    undefined,
    stub as never
  );

  assert.strictEqual(result.status, "active");
  assert.strictEqual(result.verifiedByOrgId, undefined);
});

test("checkHostStatus returns denied for unknown hosts", async () => {
  const stub = createAllowlistStub([]);

  const result = await checkHostStatus(
    "unknown.example.com",
    undefined,
    stub as never
  );

  assert.strictEqual(result.status, "denied");
  assert.strictEqual(result.source, "none");
});

test("pending domain from org-a allows org-b to see verifiedByOrgId", async () => {
  // Simulates the scenario: Org A created pending, Org B checks status
  const stub = createAllowlistStub([
    {
      id: "domain-3",
      hostname: "calendar.school.edu",
      vendor_id: "ics",
      status: "pending",
      verified_by_org_id: "org-a",
    },
  ]);

  const result = await checkHostStatus(
    "calendar.school.edu",
    undefined,
    stub as never
  );

  // Org B can now check: result.verifiedByOrgId !== "org-b"
  // and decide to re-verify instead of getting blocked
  assert.strictEqual(result.status, "pending");
  assert.strictEqual(result.verifiedByOrgId, "org-a");
  assert.notStrictEqual(result.verifiedByOrgId, "org-b");
});

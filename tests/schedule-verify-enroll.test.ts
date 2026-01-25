import test from "node:test";
import assert from "node:assert";

type DomainRow = {
  id: string;
  hostname: string;
  vendor_id: string;
  status: "active" | "pending" | "blocked";
  verified_by_org_id: string | null;
  verified_by_user_id: string | null;
  verified_at: string | null;
  verification_method: string | null;
  fingerprint: object | null;
  last_seen_at: string | null;
};

type UpdatePayload = {
  vendor_id?: string;
  status?: string;
  verified_by_org_id?: string;
  verified_by_user_id?: string | null;
  verified_at?: string | null;
  verification_method?: string;
  fingerprint?: object;
  last_seen_at?: string;
};

/**
 * Creates a stub Supabase client for testing verifyAndEnroll behavior.
 * Tracks update calls to verify the correct status filter is applied.
 */
function createVerifyEnrollStub(
  domains: DomainRow[],
  hooks?: {
    onUpdate?: (hostname: string, payload: UpdatePayload, statusFilter: string[]) => DomainRow | null;
    onInsert?: (payload: DomainRow) => DomainRow | null | { error: { code: string } };
  }
) {
  const store = new Map(domains.map((d) => [d.hostname, { ...d }]));
  const updateCalls: Array<{ hostname: string; payload: UpdatePayload; statusFilter: string[] }> = [];
  const insertCalls: Array<{ payload: object }> = [];

  const stub = {
    store,
    updateCalls,
    insertCalls,
    from: (table: string) => {
      if (table !== "schedule_allowed_domains") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select: () => ({
          eq: (col: string, val: string) => ({
            maybeSingle: () => {
              const match = store.get(val);
              return Promise.resolve({ data: match ?? null, error: null });
            },
          }),
        }),
        update: (payload: UpdatePayload) => ({
          eq: (col: string, val: string) => {
            let hostname = "";
            if (col === "hostname") {
              hostname = val;
            }
            return {
              neq: () => ({
                in: (_statusCol: string, statusFilter: string[]) => ({
                  select: () => ({
                    maybeSingle: () => {
                      updateCalls.push({ hostname, payload, statusFilter });

                      const existing = store.get(hostname);
                      if (!existing) {
                        return Promise.resolve({ data: null, error: null });
                      }

                      // Check if current status is in the allowed filter
                      if (!statusFilter.includes(existing.status)) {
                        return Promise.resolve({ data: null, error: null });
                      }

                      // Apply custom hook or default behavior
                      if (hooks?.onUpdate) {
                        const result = hooks.onUpdate(hostname, payload, statusFilter);
                        if (result) {
                          store.set(hostname, result);
                        }
                        return Promise.resolve({ data: result, error: null });
                      }

                      // Default: apply update
                      const updated = { ...existing, ...payload } as DomainRow;
                      store.set(hostname, updated);
                      return Promise.resolve({ data: updated, error: null });
                    },
                  }),
                }),
              }),
            };
          },
        }),
        insert: (payload: DomainRow) => ({
          select: () => ({
            maybeSingle: () => {
              insertCalls.push({ payload });

              if (hooks?.onInsert) {
                const result = hooks.onInsert(payload);
                if (result && "error" in result) {
                  return Promise.resolve({ data: null, error: result.error });
                }
                if (result) {
                  store.set(payload.hostname, result);
                }
                return Promise.resolve({ data: result, error: null });
              }

              store.set(payload.hostname, payload);
              return Promise.resolve({ data: payload, error: null });
            },
          }),
        }),
      };
    },
  };

  return stub;
}

test("update with pending nextStatus only allows updating pending domains", async () => {
  // Scenario: Domain is active, but verification returns low confidence (pending)
  // The update should NOT downgrade from active to pending
  const domains: DomainRow[] = [
    {
      id: "domain-1",
      hostname: "athletics.example.edu",
      vendor_id: "sidearmsports",
      status: "active",
      verified_by_org_id: "org-a",
      verified_by_user_id: "user-a",
      verified_at: "2025-01-01T00:00:00Z",
      verification_method: "fingerprint",
      fingerprint: { evidence: ["host_match"], confidence: 0.97 },
      last_seen_at: "2025-01-01T00:00:00Z",
    },
  ];

  const stub = createVerifyEnrollStub(domains);

  // Simulate what verifyAndEnroll does when nextStatus is "pending"
  const nextStatus = "pending";
  const statusFilter = nextStatus === "pending" ? ["pending"] : ["pending", "active"];

  // Attempt to update
  const result = await stub
    .from("schedule_allowed_domains")
    .update({ status: nextStatus, vendor_id: "sidearmsports" })
    .eq("hostname", "athletics.example.edu")
    .neq("status", "blocked")
    .in("status", statusFilter)
    .select()
    .maybeSingle();

  // Update should return null because active is not in ["pending"]
  assert.strictEqual(result.data, null);
  assert.strictEqual(stub.updateCalls.length, 1);
  assert.deepStrictEqual(stub.updateCalls[0].statusFilter, ["pending"]);

  // Domain should remain active (not downgraded)
  const storedDomain = stub.store.get("athletics.example.edu");
  assert.strictEqual(storedDomain?.status, "active");
});

test("update with active nextStatus allows updating both pending and active domains", async () => {
  // Scenario: Domain is pending, verification returns high confidence (active)
  // The update should upgrade from pending to active
  const domains: DomainRow[] = [
    {
      id: "domain-2",
      hostname: "sports.example.edu",
      vendor_id: "prestosports",
      status: "pending",
      verified_by_org_id: "org-b",
      verified_by_user_id: null,
      verified_at: null,
      verification_method: "fingerprint",
      fingerprint: { evidence: ["html_marker"], confidence: 0.85 },
      last_seen_at: "2025-01-01T00:00:00Z",
    },
  ];

  const stub = createVerifyEnrollStub(domains);

  // Simulate what verifyAndEnroll does when nextStatus is "active"
  const nextStatus = "active";
  const statusFilter = nextStatus === "pending" ? ["pending"] : ["pending", "active"];

  // Attempt to update
  const result = await stub
    .from("schedule_allowed_domains")
    .update({ status: nextStatus, vendor_id: "prestosports" })
    .eq("hostname", "sports.example.edu")
    .neq("status", "blocked")
    .in("status", statusFilter)
    .select()
    .maybeSingle();

  // Update should succeed because pending is in ["pending", "active"]
  assert.notStrictEqual(result.data, null);
  assert.strictEqual(result.data?.status, "active");
  assert.strictEqual(stub.updateCalls.length, 1);
  assert.deepStrictEqual(stub.updateCalls[0].statusFilter, ["pending", "active"]);

  // Domain should now be active
  const storedDomain = stub.store.get("sports.example.edu");
  assert.strictEqual(storedDomain?.status, "active");
});

test("update with active nextStatus allows refreshing already-active domains", async () => {
  // Scenario: Domain is already active, new verification also returns active
  // The update should be allowed (refreshes last_seen_at)
  const domains: DomainRow[] = [
    {
      id: "domain-3",
      hostname: "calendar.example.edu",
      vendor_id: "ics",
      status: "active",
      verified_by_org_id: "org-c",
      verified_by_user_id: "user-c",
      verified_at: "2025-01-01T00:00:00Z",
      verification_method: "fingerprint",
      fingerprint: { evidence: ["ics_content"], confidence: 0.99 },
      last_seen_at: "2025-01-01T00:00:00Z",
    },
  ];

  const stub = createVerifyEnrollStub(domains);

  const nextStatus = "active";
  const statusFilter = nextStatus === "pending" ? ["pending"] : ["pending", "active"];
  const newLastSeen = "2025-06-15T12:00:00Z";

  // Attempt to update (refresh)
  const result = await stub
    .from("schedule_allowed_domains")
    .update({ status: nextStatus, last_seen_at: newLastSeen })
    .eq("hostname", "calendar.example.edu")
    .neq("status", "blocked")
    .in("status", statusFilter)
    .select()
    .maybeSingle();

  // Update should succeed because active is in ["pending", "active"]
  assert.notStrictEqual(result.data, null);
  assert.strictEqual(result.data?.status, "active");
  assert.strictEqual(result.data?.last_seen_at, newLastSeen);
});

test("blocked domains are never updated regardless of nextStatus", async () => {
  const domains: DomainRow[] = [
    {
      id: "domain-4",
      hostname: "blocked.example.com",
      vendor_id: "unknown",
      status: "blocked",
      verified_by_org_id: null,
      verified_by_user_id: null,
      verified_at: null,
      verification_method: null,
      fingerprint: null,
      last_seen_at: null,
    },
  ];

  const stub = createVerifyEnrollStub(domains);

  // Try with active nextStatus
  const statusFilter = ["pending", "active"];

  const result = await stub
    .from("schedule_allowed_domains")
    .update({ status: "active", vendor_id: "ics" })
    .eq("hostname", "blocked.example.com")
    .neq("status", "blocked")
    .in("status", statusFilter)
    .select()
    .maybeSingle();

  // Update should return null because blocked is not in ["pending", "active"]
  assert.strictEqual(result.data, null);

  // Domain should remain blocked
  const storedDomain = stub.store.get("blocked.example.com");
  assert.strictEqual(storedDomain?.status, "blocked");
});

test("concurrent insert race returns existing row status", async () => {
  // Scenario: Two requests try to insert the same domain simultaneously
  // The second request should handle the unique constraint violation gracefully
  const domains: DomainRow[] = [];

  const stub = createVerifyEnrollStub(domains, {
    onInsert: (payload) => {
      // First insert succeeds
      if (!stub.store.has(payload.hostname)) {
        const row = { ...payload, status: "active" as const };
        stub.store.set(payload.hostname, row);
        return row;
      }
      // Second insert fails with unique constraint violation
      return { error: { code: "23505" } };
    },
  });

  // First insert succeeds
  const firstResult = await stub
    .from("schedule_allowed_domains")
    .insert({
      id: "new-1",
      hostname: "new.example.edu",
      vendor_id: "ics",
      status: "pending",
      verified_by_org_id: "org-a",
      verified_by_user_id: null,
      verified_at: null,
      verification_method: "fingerprint",
      fingerprint: null,
      last_seen_at: new Date().toISOString(),
    } as DomainRow)
    .select()
    .maybeSingle();

  assert.notStrictEqual(firstResult.data, null);

  // Second insert gets unique constraint error
  const secondResult = await stub
    .from("schedule_allowed_domains")
    .insert({
      id: "new-2",
      hostname: "new.example.edu",
      vendor_id: "ics",
      status: "pending",
      verified_by_org_id: "org-b",
      verified_by_user_id: null,
      verified_at: null,
      verification_method: "fingerprint",
      fingerprint: null,
      last_seen_at: new Date().toISOString(),
    } as DomainRow)
    .select()
    .maybeSingle();

  assert.strictEqual(secondResult.data, null);
  assert.strictEqual(secondResult.error?.code, "23505");

  // The stored domain should be from the first insert
  const storedDomain = stub.store.get("new.example.edu");
  assert.strictEqual(storedDomain?.verified_by_org_id, "org-a");
});

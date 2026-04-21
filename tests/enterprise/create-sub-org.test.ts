import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createEnterpriseSubOrg,
  ensureEnterpriseSlugAvailable,
} from "@/lib/enterprise/create-sub-org";

type TableRow = { id: string } | null;

function createSlugCheckSupabase(params: {
  organization?: TableRow;
  enterprise?: TableRow;
  organizationError?: { message?: string } | null;
  enterpriseError?: { message?: string } | null;
}) {
  return {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => {
                  if (table === "organizations") {
                    return {
                      data: params.organization ?? null,
                      error: params.organizationError ?? null,
                    };
                  }

                  return {
                    data: params.enterprise ?? null,
                    error: params.enterpriseError ?? null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function createRpcSupabase(params: {
  rpcResult?: Array<{ out_slug: string; out_org_id: string | null; out_status: string }> | null;
  rpcError?: { code?: string; message?: string } | null;
  fetchedOrg?: Record<string, unknown> | null;
}) {
  return {
    async rpc() {
      return {
        data: params.rpcResult ?? null,
        error: params.rpcError ?? null,
      };
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => ({ data: params.fetchedOrg ?? null }),
              };
            },
          };
        },
      };
    },
  };
}

describe("ensureEnterpriseSlugAvailable", () => {
  it("rejects slugs already used by enterprises", async () => {
    const result = await ensureEnterpriseSlugAvailable(
      createSlugCheckSupabase({
        enterprise: { id: "ent-1" },
      }),
      "shared-slug"
    );

    assert.equal(result.available, false);
    assert.equal(result.status, 409);
    assert.equal(result.error, "Slug is already taken");
  });

  it("returns a verification error when slug lookup fails", async () => {
    const result = await ensureEnterpriseSlugAvailable(
      createSlugCheckSupabase({
        organizationError: { message: "network" },
      }),
      "shared-slug"
    );

    assert.equal(result.available, false);
    assert.equal(result.status, 500);
    assert.equal(result.error, "Failed to verify slug availability");
  });
});

describe("createEnterpriseSubOrg", () => {
  const baseParams = {
    enterpriseId: "ent-1",
    userId: "user-1",
    name: "Alpha Org",
    slug: "alpha-org",
    enterprisePrimaryColor: "#1e3a5f",
  };

  it("maps shared-namespace slug conflicts to a 409", async () => {
    const result = await createEnterpriseSubOrg({
      ...baseParams,
      serviceSupabase: createRpcSupabase({
        rpcError: {
          code: "23505",
          message: 'Slug "alpha-org" is already taken',
        },
      }),
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected slug conflict");
    assert.equal(result.kind, "slug_conflict");
    assert.equal(result.status, 409);
    assert.equal(result.error, "Slug is already taken");
  });

  it("maps RPC org-cap failures to upgrade-needed metadata", async () => {
    const result = await createEnterpriseSubOrg({
      ...baseParams,
      serviceSupabase: createRpcSupabase({
        rpcError: {
          code: "23514",
          message: "Batch would exceed org limit: 4 existing + 1 new > 4 allowed",
        },
      }),
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("expected org limit failure");
    assert.equal(result.kind, "org_limit");
    assert.equal(result.status, 402);
    assert.deepEqual(result.quota, {
      currentCount: 4,
      maxAllowed: 4,
      remaining: 0,
    });
  });

  it("returns the fetched organization after a successful single-item batch RPC", async () => {
    const result = await createEnterpriseSubOrg({
      ...baseParams,
      serviceSupabase: createRpcSupabase({
        rpcResult: [
          {
            out_slug: "alpha-org",
            out_org_id: "org-1",
            out_status: "created",
          },
        ],
        fetchedOrg: {
          id: "org-1",
          slug: "alpha-org",
          name: "Alpha Org",
        },
      }),
    });

    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("expected success");
    assert.equal(result.orgId, "org-1");
    assert.equal(result.slug, "alpha-org");
    assert.deepEqual(result.org, {
      id: "org-1",
      slug: "alpha-org",
      name: "Alpha Org",
    });
  });
});

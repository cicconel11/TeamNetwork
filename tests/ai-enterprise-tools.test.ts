/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../src/lib/ai/tools/executor.ts";
import type { ToolExecutionContext } from "../src/lib/ai/tools/executor.ts";

function createEnterpriseToolSupabaseStub() {
  const directoryRows = [
    {
      id: "alum-1",
      enterprise_id: "ent-1",
      organization_id: "org-1",
      organization_name: "Home Org",
      organization_slug: "home-org",
      first_name: "Jane",
      last_name: "Doe",
      graduation_year: 2018,
      industry: "Finance",
      current_company: "Acme Capital",
      current_city: "New York",
      position_title: "Analyst",
      job_title: null,
      linkedin_url: null,
      email: "jane@example.com",
      phone_number: "555-1000",
    },
    {
      id: "alum-2",
      enterprise_id: "ent-1",
      organization_id: "org-2",
      organization_name: "North Org",
      organization_slug: "north-org",
      first_name: "John",
      last_name: "Smith",
      graduation_year: 2019,
      industry: "Tech",
      current_company: "North Systems",
      current_city: "Boston",
      position_title: null,
      job_title: "Engineer",
      linkedin_url: null,
      email: null,
      phone_number: null,
    },
  ];
  const managedOrganizations = [
    {
      id: "org-1",
      enterprise_id: "ent-1",
      name: "Home Org",
      slug: "home-org",
      enterprise_relationship_type: "owner",
      enterprise_adopted_at: null,
    },
    {
      id: "org-2",
      enterprise_id: "ent-1",
      name: "North Org",
      slug: "north-org",
      enterprise_relationship_type: "managed",
      enterprise_adopted_at: "2026-01-10T00:00:00Z",
    },
  ];

  const applyFilters = (rows: any[], filters: Array<{ type: string; column: string; value?: unknown }>) =>
    rows.filter((row) =>
      filters.every((filter) => {
        switch (filter.type) {
          case "eq":
            return row[filter.column] === filter.value;
          case "in":
            return Array.isArray(filter.value) && filter.value.includes(row[filter.column]);
          case "ilike":
            return String(row[filter.column] ?? "")
              .toLowerCase()
              .includes(String(filter.value ?? "").toLowerCase());
          case "is":
            return filter.value === null ? row[filter.column] == null : row[filter.column] === filter.value;
          case "not_is":
            return filter.value === null ? row[filter.column] != null : row[filter.column] !== filter.value;
          case "or":
            return String(row.position_title ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase()) ||
              String(row.job_title ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
          default:
            return true;
        }
      }),
    );

  return {
    from(table: string) {
      const filters: Array<{ type: string; column: string; value?: unknown }> = [];
      let limitStart = 0;
      let limitEnd: number | null = null;
      const builder: Record<string, any> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ type: "eq", column, value });
          return builder;
        },
        in(column: string, value: unknown[]) {
          filters.push({ type: "in", column, value });
          return builder;
        },
        ilike(column: string, value: string) {
          filters.push({ type: "ilike", column, value: value.replace(/%/g, "") });
          return builder;
        },
        or(expression: string) {
          filters.push({
            type: "or",
            column: "position_title",
            value: expression.split(".ilike.%")[1]?.split("%,")[0] ?? "",
          });
          return builder;
        },
        is(column: string, value: unknown) {
          filters.push({ type: "is", column, value });
          return builder;
        },
        not(column: string, operator: string, value: unknown) {
          if (operator === "is") {
            filters.push({ type: "not_is", column, value });
          }
          return builder;
        },
        order() {
          return builder;
        },
        range(start: number, end: number) {
          limitStart = start;
          limitEnd = end;
          return builder;
        },
        async maybeSingle() {
          if (table === "enterprise_subscriptions") {
            return {
              data: {
                billing_interval: "month",
                alumni_bucket_quantity: 2,
                sub_org_quantity: null,
                status: "active",
              },
              error: null,
            };
          }
          if (table === "enterprise_alumni_counts") {
            return {
              data: {
                total_alumni_count: 180,
                sub_org_count: 3,
                enterprise_managed_org_count: 2,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };

      builder.then = (resolve: (value: unknown) => void) => {
        if (table === "organizations") {
          resolve({
            data: applyFilters(managedOrganizations, filters),
            error: null,
          });
          return;
        }

        if (table === "enterprise_alumni_directory") {
          const filtered = applyFilters(directoryRows, filters);
          const sliced =
            limitEnd == null ? filtered : filtered.slice(limitStart, limitEnd + 1);
          resolve({
            data: sliced,
            count: filtered.length,
            error: null,
          });
          return;
        }

        resolve({ data: [], count: 0, error: null });
      };

      return builder;
    },
    async rpc(name: string) {
      if (name === "get_enterprise_alumni_stats") {
        return {
          data: {
            total_count: 180,
            org_stats: [
              { organization_id: "org-1", organization_name: "Home Org", alumni_count: 100 },
              { organization_id: "org-2", organization_name: "North Org", alumni_count: 80 },
            ],
            top_industries: [
              { industry: "Finance", count: 60 },
              { industry: "Tech", count: 50 },
            ],
            filter_options: {
              industries: ["Finance", "Tech"],
              graduation_years: [2018, 2019],
            },
          },
          error: null,
        };
      }

      return { data: null, error: { message: `missing rpc ${name}` } };
    },
  };
}

function createContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  return {
    orgId: "org-1",
    userId: "user-1",
    serviceSupabase: createEnterpriseToolSupabaseStub() as any,
    authorization: { kind: "preverified_admin", source: "ai_org_context" },
    ...overrides,
  };
}

describe("enterprise AI tools", () => {
  it("short-circuits enterprise tools when the thread has no enterprise context", async () => {
    for (const name of [
      "list_enterprise_alumni",
      "get_enterprise_stats",
      "list_managed_orgs",
      "get_enterprise_quota",
    ] as const) {
      const result = await executeToolCall(createContext(), { name, args: {} });
      assert.equal(result.kind, "tool_error");
      if (result.kind === "tool_error") {
        assert.match(result.error, /does not have enterprise context/i);
      }
    }
  });

  it("lists enterprise alumni with cross-org filters", async () => {
    const result = await executeToolCall(
      createContext({ enterpriseId: "ent-1", enterpriseRole: "owner" }),
      {
        name: "list_enterprise_alumni",
        args: { org: "home-org", graduation_year: 2018, has_email: true },
      },
    );

    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      const payload = result.data as any;
      assert.equal(payload.total, 1);
      assert.equal(payload.results[0].name, "Jane Doe");
      assert.equal(payload.results[0].organization_slug, "home-org");
    }
  });

  it("returns enterprise stats, quota, and managed orgs", async () => {
    const ctx = createContext({ enterpriseId: "ent-1", enterpriseRole: "owner" });

    const stats = await executeToolCall(ctx, { name: "get_enterprise_stats", args: {} });
    const quota = await executeToolCall(ctx, { name: "get_enterprise_quota", args: {} });
    const organizations = await executeToolCall(ctx, { name: "list_managed_orgs", args: {} });

    assert.equal(stats.kind, "ok");
    assert.equal(quota.kind, "ok");
    assert.equal(organizations.kind, "ok");

    if (stats.kind === "ok") {
      assert.equal((stats.data as any).total_count, 180);
      assert.equal((stats.data as any).org_stats[0].organization_name, "Home Org");
    }
    if (quota.kind === "ok") {
      assert.equal((quota.data as any).alumni.used, 180);
      assert.equal((quota.data as any).sub_orgs.total, 3);
    }
    if (organizations.kind === "ok") {
      assert.equal((organizations.data as any).total, 2);
      assert.equal((organizations.data as any).organizations[1].slug, "north-org");
    }
  });

  it("blocks get_enterprise_quota for org_admin role", async () => {
    const ctx = createContext({ enterpriseId: "ent-1", enterpriseRole: "org_admin" });
    const result = await executeToolCall(ctx, { name: "get_enterprise_quota", args: {} });

    assert.equal(result.kind, "tool_error");
    if (result.kind === "tool_error") {
      assert.match(result.error, /owner or billing admin/i);
    }
  });

  it("allows get_enterprise_quota for billing_admin role", async () => {
    const ctx = createContext({ enterpriseId: "ent-1", enterpriseRole: "billing_admin" });
    const result = await executeToolCall(ctx, { name: "get_enterprise_quota", args: {} });
    assert.equal(result.kind, "ok");
  });

  it("allows non-billing enterprise tools for org_admin role", async () => {
    const ctx = createContext({ enterpriseId: "ent-1", enterpriseRole: "org_admin" });
    const stats = await executeToolCall(ctx, { name: "get_enterprise_stats", args: {} });
    const orgs = await executeToolCall(ctx, { name: "list_managed_orgs", args: {} });
    const alumni = await executeToolCall(ctx, { name: "list_enterprise_alumni", args: {} });

    assert.equal(stats.kind, "ok");
    assert.equal(orgs.kind, "ok");
    assert.equal(alumni.kind, "ok");
  });

  it("short-circuits when enterpriseId set but enterpriseRole missing", async () => {
    const ctx = createContext({ enterpriseId: "ent-1" });
    const result = await executeToolCall(ctx, { name: "list_managed_orgs", args: {} });
    assert.equal(result.kind, "tool_error");
    if (result.kind === "tool_error") {
      assert.match(result.error, /does not have enterprise context/i);
    }
  });
});

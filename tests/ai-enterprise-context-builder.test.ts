/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

interface MockOverrides {
  alumniBucketQuantity?: number;
  totalAlumniCount?: number;
  subOrgCount?: number;
  enterpriseManagedOrgCount?: number;
}

function createMockServiceSupabase(overrides: MockOverrides = {}) {
  const alumniBucketQuantity = overrides.alumniBucketQuantity ?? 2;
  const totalAlumniCount = overrides.totalAlumniCount ?? 180;
  const subOrgCount = overrides.subOrgCount ?? 3;
  const enterpriseManagedOrgCount = overrides.enterpriseManagedOrgCount ?? 2;
  return {
    from(table: string) {
      const filters = new Map<string, unknown>();
      const builder: Record<string, any> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return builder;
        },
        is() {
          return builder;
        },
        gte() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === "organizations" && filters.get("id") === "org-1") {
            return {
              data: {
                name: "Home Org",
                slug: "home-org",
                org_type: "chapter",
                description: null,
              },
              error: null,
            };
          }
          if (table === "enterprises") {
            return { data: { name: "Acme Enterprise", slug: "acme-ent" }, error: null };
          }
          if (table === "enterprise_subscriptions") {
            return { data: { alumni_bucket_quantity: alumniBucketQuantity }, error: null };
          }
          if (table === "enterprise_alumni_counts") {
            return {
              data: {
                total_alumni_count: totalAlumniCount,
                sub_org_count: subOrgCount,
                enterprise_managed_org_count: enterpriseManagedOrgCount,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
      };

      builder.then = (resolve: (value: unknown) => void) => {
        if (table === "organizations" && filters.get("enterprise_id") === "ent-1") {
          resolve({
            data: [
              {
                name: "Home Org",
                slug: "home-org",
                enterprise_relationship_type: "owner",
                enterprise_adopted_at: null,
              },
              {
                name: "North Org",
                slug: "north-org",
                enterprise_relationship_type: "managed",
                enterprise_adopted_at: "2026-01-10T00:00:00Z",
              },
            ],
            error: null,
          });
          return;
        }

        if (table === "users") {
          resolve({ data: { name: "Enterprise Admin" }, error: null });
          return;
        }

        resolve({ data: [], count: 0, error: null });
      };

      return builder;
    },
  };
}

describe("enterprise AI prompt context", () => {
  it("includes enterprise overview details in the untrusted context and enterprise guidance in the system prompt", async () => {
    const { buildPromptContext } = await import("../src/lib/ai/context-builder.ts");
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      enterpriseId: "ent-1",
      enterpriseRole: "owner",
      currentPath: "/enterprise/acme-ent/alumni",
      availableTools: ["get_enterprise_stats", "list_enterprise_alumni", "list_managed_orgs"],
      serviceSupabase: createMockServiceSupabase() as any,
    });

    assert.match(result.systemPrompt, /enterprise access for Acme Enterprise/i);
    assert.match(result.systemPrompt, /enterprise-wide alumni, quota, managed organizations/i);
    assert.match(result.orgContextMessage ?? "", /## Enterprise Overview/);
    assert.match(result.orgContextMessage ?? "", /Enterprise alumni: 180/);
    assert.match(result.orgContextMessage ?? "", /Managed orgs: 3/);
    assert.match(result.orgContextMessage ?? "", /Home Org/);
    assert.match(result.orgContextMessage ?? "", /North Org/);
  });

  it("omits enterprise billing and quota details for org_admin role", async () => {
    const { buildPromptContext } = await import("../src/lib/ai/context-builder.ts");
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      enterpriseId: "ent-1",
      enterpriseRole: "org_admin",
      currentPath: "/enterprise/acme-ent/billing",
      availableTools: ["get_enterprise_quota", "get_enterprise_stats", "list_managed_orgs"],
      serviceSupabase: createMockServiceSupabase() as any,
    });

    assert.match(result.orgContextMessage ?? "", /## Enterprise Overview/);
    assert.match(result.orgContextMessage ?? "", /Enterprise alumni: 180/);
    assert.match(result.orgContextMessage ?? "", /Managed orgs: 3/);
    assert.doesNotMatch(result.orgContextMessage ?? "", /Alumni capacity:/);
    assert.doesNotMatch(result.orgContextMessage ?? "", /Alumni seats remaining:/);
    assert.doesNotMatch(result.orgContextMessage ?? "", /Free sub-org slots included:/);
    assert.doesNotMatch(result.orgContextMessage ?? "", /Free sub-org slots remaining:/);
    assert.doesNotMatch(result.orgContextMessage ?? "", /Enterprise-managed orgs billed for seats:/);
    assert.match(
      result.systemPrompt,
      /only enterprise owners and billing admins can access quota details/i
    );
    assert.doesNotMatch(
      result.systemPrompt,
      /enterprise-wide data \(alumni, quota, managed orgs, cross-org stats\)/i
    );
  });

  it("includes alumni capacity alert on turn 1 when usage >= 80%", async () => {
    const { buildPromptContext } = await import("../src/lib/ai/context-builder.ts");
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      enterpriseId: "ent-1",
      enterpriseRole: "owner",
      availableTools: ["get_enterprise_stats"],
      threadTurnCount: 1,
      serviceSupabase: createMockServiceSupabase({
        alumniBucketQuantity: 1,
        totalAlumniCount: 2125,
        subOrgCount: 1,
      }) as any,
    });

    assert.match(
      result.orgContextMessage ?? "",
      /Capacity alert: alumni usage at 85% — approaching your alumni limit\./
    );
  });

  it("omits alumni capacity alert on turn 2 even when usage >= 80%", async () => {
    const { buildPromptContext } = await import("../src/lib/ai/context-builder.ts");
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      enterpriseId: "ent-1",
      enterpriseRole: "owner",
      availableTools: ["get_enterprise_stats"],
      threadTurnCount: 2,
      serviceSupabase: createMockServiceSupabase({
        alumniBucketQuantity: 1,
        totalAlumniCount: 2125,
        subOrgCount: 1,
      }) as any,
    });

    assert.doesNotMatch(result.orgContextMessage ?? "", /Capacity alert:/);
  });

  it("omits capacity alert on turn 1 when usage is 50%", async () => {
    const { buildPromptContext } = await import("../src/lib/ai/context-builder.ts");
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      enterpriseId: "ent-1",
      enterpriseRole: "owner",
      availableTools: ["get_enterprise_stats"],
      threadTurnCount: 1,
      serviceSupabase: createMockServiceSupabase({
        alumniBucketQuantity: 1,
        totalAlumniCount: 1250,
        subOrgCount: 1,
      }) as any,
    });

    assert.doesNotMatch(result.orgContextMessage ?? "", /Capacity alert:/);
  });
});

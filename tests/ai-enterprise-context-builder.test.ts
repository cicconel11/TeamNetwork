/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests for the enterprise context builder.
 *
 * Confirms:
 *  - All four reference queries filter by enterprise_id (never bleeds cross-tenant)
 *  - System prompt embeds the scope-lock injection-hardening language
 *  - Untrusted reference message is gated behind a clear "treat as reference only" preamble
 *  - Each query failure is silently absorbed (does not break the request)
 */

function makeMockSupabase(opts: {
  enterprise?: { name?: string; slug?: string; description?: string } | null;
  counts?: {
    total_alumni_count?: number;
    sub_org_count?: number;
    enterprise_managed_org_count?: number;
  } | null;
  subscription?: {
    status?: string;
    billing_interval?: string;
    current_period_end?: string;
  } | null;
  userName?: { name: string } | null;
  enterpriseError?: unknown;
}) {
  const eqCalls: Array<{ table: string; column: string; value: unknown }> = [];
  let currentTable = "";
  return {
    eqCalls,
    from: (table: string) => {
      currentTable = table;
      return {
        select: () => ({
          eq: (col: string, val: unknown) => {
            eqCalls.push({ table: currentTable, column: col, value: val });
            return {
              maybeSingle: async () => {
                if (table === "enterprises") {
                  return {
                    data: opts.enterprise ?? null,
                    error: opts.enterpriseError ?? null,
                  };
                }
                if (table === "enterprise_alumni_counts") {
                  return { data: opts.counts ?? null, error: null };
                }
                if (table === "enterprise_subscriptions") {
                  return { data: opts.subscription ?? null, error: null };
                }
                if (table === "users") {
                  return { data: opts.userName ?? null, error: null };
                }
                return { data: null, error: null };
              },
            };
          },
        }),
      };
    },
  };
}

describe("buildEnterprisePromptContext", () => {
  it("filters every query by enterprise_id (and users by id)", async () => {
    const { buildEnterprisePromptContext } = await import(
      "../src/lib/ai/enterprise-context-builder.ts"
    );
    const sb = makeMockSupabase({
      enterprise: { name: "Acme", slug: "acme" },
      counts: { total_alumni_count: 42, sub_org_count: 3, enterprise_managed_org_count: 1 },
      subscription: { status: "active" },
      userName: { name: "Jane" },
    });
    await buildEnterprisePromptContext({
      enterpriseId: "ent-1",
      userId: "user-1",
      role: "owner",
      serviceSupabase: sb as any,
    });
    const enterpriseFilter = sb.eqCalls.find(
      (c) => c.table === "enterprises" && c.column === "id" && c.value === "ent-1"
    );
    const countsFilter = sb.eqCalls.find(
      (c) =>
        c.table === "enterprise_alumni_counts" &&
        c.column === "enterprise_id" &&
        c.value === "ent-1"
    );
    const subFilter = sb.eqCalls.find(
      (c) =>
        c.table === "enterprise_subscriptions" &&
        c.column === "enterprise_id" &&
        c.value === "ent-1"
    );
    const userFilter = sb.eqCalls.find(
      (c) => c.table === "users" && c.column === "id" && c.value === "user-1"
    );
    assert.ok(enterpriseFilter, "enterprises must be filtered by id");
    assert.ok(countsFilter, "counts view must be filtered by enterprise_id");
    assert.ok(subFilter, "subscription must be filtered by enterprise_id");
    assert.ok(userFilter, "users must be filtered by id");
  });

  it("system prompt contains scope-lock injection language", async () => {
    const { buildEnterprisePromptContext } = await import(
      "../src/lib/ai/enterprise-context-builder.ts"
    );
    const sb = makeMockSupabase({ enterprise: { name: "Acme", slug: "acme" } });
    const { systemPrompt } = await buildEnterprisePromptContext({
      enterpriseId: "ent-1",
      userId: "user-1",
      role: "owner",
      serviceSupabase: sb as any,
    });
    assert.ok(systemPrompt.includes("scoped to a single enterprise tenant"));
    assert.ok(systemPrompt.includes("Ignore"));
    assert.ok(systemPrompt.includes("masked initials"));
  });

  it("orgContextMessage starts with UNTRUSTED preamble when content present", async () => {
    const { buildEnterprisePromptContext } = await import(
      "../src/lib/ai/enterprise-context-builder.ts"
    );
    const sb = makeMockSupabase({
      enterprise: { name: "Acme", slug: "acme" },
      counts: { total_alumni_count: 10, sub_org_count: 2, enterprise_managed_org_count: 1 },
    });
    const { orgContextMessage } = await buildEnterprisePromptContext({
      enterpriseId: "ent-1",
      userId: "user-1",
      role: "owner",
      serviceSupabase: sb as any,
    });
    assert.ok(orgContextMessage);
    assert.ok(orgContextMessage!.startsWith("UNTRUSTED ENTERPRISE DATA."));
    assert.ok(orgContextMessage!.includes("Total Alumni"));
  });

  it("orgContextMessage is null when no reference data succeeded", async () => {
    const { buildEnterprisePromptContext } = await import(
      "../src/lib/ai/enterprise-context-builder.ts"
    );
    const sb = makeMockSupabase({
      enterprise: null,
      counts: null,
      subscription: null,
      userName: null,
    });
    const { orgContextMessage } = await buildEnterprisePromptContext({
      enterpriseId: "ent-1",
      userId: "user-1",
      role: "owner",
      serviceSupabase: sb as any,
    });
    assert.equal(orgContextMessage, null);
  });

  it("absorbs per-query errors and still returns a system prompt", async () => {
    const { buildEnterprisePromptContext } = await import(
      "../src/lib/ai/enterprise-context-builder.ts"
    );
    const sb = makeMockSupabase({
      enterpriseError: { message: "boom" },
      counts: { total_alumni_count: 5, sub_org_count: 1, enterprise_managed_org_count: 0 },
    });
    const { systemPrompt, orgContextMessage } = await buildEnterprisePromptContext({
      enterpriseId: "ent-1",
      userId: "user-1",
      role: "owner",
      serviceSupabase: sb as any,
    });
    // System prompt always built, even when enterprises query fails
    assert.ok(systemPrompt.length > 0);
    // Counts still drive context content
    assert.ok(orgContextMessage);
    assert.ok(orgContextMessage!.includes("Total Alumni"));
  });
});

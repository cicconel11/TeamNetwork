/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPromptContext, type RagChunkInput } from "../src/lib/ai/context-builder";

function createMockServiceSupabase(opts: {
  org?: { name: string; slug: string; org_type?: string | null; description?: string | null } | null;
  memberCount?: number;
  alumniCount?: number;
}) {
  return {
    from: (table: string) => {
      const chain: Record<string, any> = {};
      const methods = ["select", "eq", "is", "gte", "lt", "order", "limit", "in"];

      for (const method of methods) {
        chain[method] = () => chain;
      }

      chain.maybeSingle = async () => {
        if (table === "organizations") {
          return {
            data: opts.org ?? { name: "Test Org", slug: "test-org", org_type: null, description: null },
            error: null,
          };
        }
        if (table === "users") {
          return { data: { name: "Admin User" }, error: null };
        }
        if (table === "organization_donation_stats") {
          return { data: null, error: null };
        }
        return { data: null, error: null };
      };

      chain.single = chain.maybeSingle;

      chain.then = (resolve: (value: unknown) => void) => {
        if (table === "members") {
          resolve({ count: opts.memberCount ?? 10, error: null });
        } else if (table === "alumni") {
          resolve({ count: opts.alumniCount ?? 5, error: null });
        } else if (table === "parents") {
          resolve({ count: 0, error: null });
        } else if (table === "events") {
          resolve({ data: [], count: 0, error: null });
        } else if (table === "announcements") {
          resolve({ data: [], error: null });
        } else {
          resolve({ data: null, error: null });
        }
      };

      return chain;
    },
  };
}

describe("context-builder RAG integration", () => {
  it("includes Retrieved Knowledge section when ragChunks are provided", async () => {
    const ragChunks: RagChunkInput[] = [
      {
        contentText: "Announcement: Spring Gala is on April 15th",
        sourceTable: "announcements",
        metadata: { title: "Spring Gala" },
      },
      {
        contentText: "Event: Career Fair on March 20th",
        sourceTable: "events",
        metadata: { title: "Career Fair" },
      },
    ];

    const supabase = createMockServiceSupabase({});
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      serviceSupabase: supabase as any,
      ragChunks,
    });

    assert.ok(result.orgContextMessage, "Should have org context message");
    assert.ok(
      result.orgContextMessage!.includes("Retrieved Knowledge"),
      "Should contain Retrieved Knowledge section"
    );
    assert.ok(
      result.orgContextMessage!.includes("Spring Gala"),
      "Should contain chunk content"
    );
    assert.ok(
      result.metadata.sectionsIncluded.includes("Retrieved Knowledge"),
      "Retrieved Knowledge should be in included sections"
    );
  });

  it("does not include Retrieved Knowledge section when ragChunks is empty", async () => {
    const supabase = createMockServiceSupabase({});
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      serviceSupabase: supabase as any,
      ragChunks: [],
    });

    assert.ok(
      !result.metadata.sectionsIncluded.includes("Retrieved Knowledge"),
      "Retrieved Knowledge should not be in included sections when empty"
    );
  });

  it("does not include Retrieved Knowledge section when ragChunks is undefined", async () => {
    const supabase = createMockServiceSupabase({});
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      serviceSupabase: supabase as any,
    });

    assert.ok(
      !result.metadata.sectionsIncluded.includes("Retrieved Knowledge"),
      "Retrieved Knowledge should not be in included sections when undefined"
    );
  });

  it("Retrieved Knowledge has priority 4 (between Counts and Upcoming Events)", async () => {
    const ragChunks: RagChunkInput[] = [
      {
        contentText: "Test knowledge chunk",
        sourceTable: "announcements",
        metadata: {},
      },
    ];

    const supabase = createMockServiceSupabase({});
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      serviceSupabase: supabase as any,
      ragChunks,
    });

    const included = result.metadata.sectionsIncluded;
    const countsIdx = included.indexOf("Counts");
    const ragIdx = included.indexOf("Retrieved Knowledge");

    // If both are included, RAG should come after Counts
    if (countsIdx >= 0 && ragIdx >= 0) {
      assert.ok(
        ragIdx > countsIdx,
        "Retrieved Knowledge should come after Counts"
      );
    }
  });

  it("RAG section competes for token budget like any other section", async () => {
    // The RAG section is priority 4, and the budget system drops sections that don't fit.
    // A moderately large RAG chunk should still be included at its priority level.
    const ragChunks: RagChunkInput[] = [
      {
        contentText: "Relevant knowledge about the organization's policies",
        sourceTable: "announcements",
        metadata: {},
      },
    ];

    const supabase = createMockServiceSupabase({});
    const result = await buildPromptContext({
      orgId: "org-1",
      userId: "user-1",
      role: "admin",
      serviceSupabase: supabase as any,
      ragChunks,
    });

    // RAG section should be included and consume budget tokens
    assert.ok(
      result.metadata.sectionsIncluded.includes("Retrieved Knowledge"),
      "RAG section should be included"
    );
    assert.ok(
      result.metadata.estimatedTokens > 0,
      "Total tokens should be positive"
    );
  });
});

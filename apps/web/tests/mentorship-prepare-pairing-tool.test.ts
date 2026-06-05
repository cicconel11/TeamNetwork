import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { prepareMentorshipPairingModule } from "@/lib/ai/tools/registry/prepare-mentorship-pairing";
import { formatPrepareMentorshipPairingResponse } from "@/app/api/ai/[orgId]/chat/handler/formatters/prepares";

describe("prepare_mentorship_pairing tool schema", () => {
  it("requires a mentee identifier and a mentor identifier", () => {
    assert.equal(prepareMentorshipPairingModule.name, "prepare_mentorship_pairing");
    const schema = prepareMentorshipPairingModule.argsSchema;
    // Missing both → invalid
    assert.equal(schema.safeParse({}).success, false);
    // Mentee only → invalid (mentor required too)
    assert.equal(schema.safeParse({ mentee_query: "Jane" }).success, false);
    // Mentor only → invalid (mentee required too)
    assert.equal(schema.safeParse({ mentor_query: "John" }).success, false);
    // Both present → valid (by query or id)
    assert.equal(schema.safeParse({ mentee_query: "Jane", mentor_query: "John" }).success, true);
    assert.equal(
      schema.safeParse({
        mentee_id: "11111111-1111-4111-8111-111111111111",
        mentor_id: "22222222-2222-4222-8222-222222222222",
      }).success,
      true
    );
    // Unknown keys rejected (strict)
    assert.equal(
      schema.safeParse({ mentee_query: "Jane", mentor_query: "John", foo: 1 }).success,
      false
    );
  });
});

describe("prepare_mentorship_pairing authorization + thread guards", () => {
  const run = (overrides: Record<string, unknown>) =>
    prepareMentorshipPairingModule.execute(
      { mentee_query: "Jane", mentor_query: "John" } as never,
      {
        ctx: {
          orgId: "org-1",
          userId: "user-1",
          threadId: "thread-1",
          authorization: { kind: "preverified_admin" },
          ...overrides,
        },
        sb: {} as never,
        logContext: {} as never,
      } as never
    );

  it("is admin-only", async () => {
    const result = await run({ authorization: { kind: "verify_membership" } });
    assert.equal(result.kind, "ok");
    const data = (result as { data: { state?: string } }).data;
    assert.equal(data.state, "unauthorized");
  });

  it("requires a thread context", async () => {
    const result = await run({ threadId: undefined });
    // toolError → kind "error"
    assert.notEqual(result.kind, "ok");
  });
});

describe("formatPrepareMentorshipPairingResponse", () => {
  it("renders the confirmation prompt for needs_confirmation", () => {
    const out = formatPrepareMentorshipPairingResponse({
      state: "needs_confirmation",
      draft: {
        mentee: { name: "Jane Doe" },
        mentor: { name: "John Smith" },
        confidence: 92,
        why: "Both worked at Goldman Sachs.",
      },
    });
    assert.ok(out);
    assert.match(out!, /Jane Doe/);
    assert.match(out!, /John Smith/);
    assert.match(out!, /confidence 92\/100/i);
    assert.match(out!, /Confirm below/i);
  });

  it("handles unauthorized, not-found, ineligible, and ambiguous states", () => {
    assert.match(
      formatPrepareMentorshipPairingResponse({ state: "unauthorized" })!,
      /admin/i
    );
    assert.match(
      formatPrepareMentorshipPairingResponse({ state: "mentee_not_found" })!,
      /couldn't find that student/i
    );
    assert.match(
      formatPrepareMentorshipPairingResponse({
        state: "mentor_ineligible",
        message: "That mentor isn't an eligible match for this student right now.",
      })!,
      /eligible match/i
    );
    const ambiguous = formatPrepareMentorshipPairingResponse({
      state: "mentor_ambiguous",
      disambiguation_options: [
        { name: "John Smith", subtitle: "VP at Goldman" },
        { name: "John Smithson", subtitle: "PM at Google" },
      ],
    });
    assert.ok(ambiguous);
    assert.match(ambiguous!, /which one did you mean/i);
    assert.match(ambiguous!, /John Smith/);
    assert.match(ambiguous!, /John Smithson/);
  });
});

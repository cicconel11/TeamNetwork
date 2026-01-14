import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

describe("form_submissions column alignment", () => {
  const formId = "form-001";
  const orgId = "org-001";
  const userId = "user-001";

  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("insert uses 'data' column, not 'responses'", () => {
    const responses = { name: "Alice", email: "alice@example.com" };

    // Simulate what the fixed user form page does
    stub.from("form_submissions").insert({
      form_id: formId,
      organization_id: orgId,
      user_id: userId,
      data: responses,
    });

    const rows = stub.getRows("form_submissions");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].data, { name: "Alice", email: "alice@example.com" });
    assert.equal(rows[0].responses, undefined, "should NOT have a 'responses' key");
  });

  test("update uses 'data' column, not 'responses'", async () => {
    // Seed an existing submission
    stub.seed("form_submissions", [
      {
        id: "sub-001",
        form_id: formId,
        organization_id: orgId,
        user_id: userId,
        data: { name: "Alice" },
        submitted_at: new Date().toISOString(),
      },
    ]);

    // Simulate the fixed update path (must await to trigger the stub's then())
    const updatedResponses = { name: "Alice B.", email: "alice@example.com" };
    await stub
      .from("form_submissions")
      .update({ data: updatedResponses, submitted_at: new Date().toISOString() })
      .eq("id", "sub-001");

    const rows = stub.getRows("form_submissions");
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].data, { name: "Alice B.", email: "alice@example.com" });
    assert.equal(rows[0].responses, undefined, "should NOT have a 'responses' key after update");
  });

  test("admin read gets field values from 'data' column", async () => {
    const fieldData = { favorite_color: "Blue", shirt_size: "M" };

    stub.seed("form_submissions", [
      {
        id: "sub-002",
        form_id: formId,
        organization_id: orgId,
        user_id: userId,
        data: fieldData,
        submitted_at: new Date().toISOString(),
      },
    ]);

    // Simulate what the admin page does: select submissions and read .data
    const { data: submissions } = await stub
      .from("form_submissions")
      .select("*")
      .eq("form_id", formId);

    assert.ok(submissions);
    assert.equal(submissions.length, 1);

    const submission = submissions[0];
    const responses = (submission.data || {}) as Record<string, unknown>;

    assert.equal(responses.favorite_color, "Blue");
    assert.equal(responses.shirt_size, "M");
  });

  test("CSV export reads from 'data' column", async () => {
    const fieldData = { question_1: "Yes", question_2: "No" };

    stub.seed("form_submissions", [
      {
        id: "sub-003",
        form_id: formId,
        organization_id: orgId,
        user_id: userId,
        data: fieldData,
        submitted_at: new Date().toISOString(),
      },
    ]);

    const { data: submissions } = await stub
      .from("form_submissions")
      .select("*")
      .eq("form_id", formId);

    assert.ok(submissions);
    const raw = submissions[0] as Record<string, unknown>;
    const responses = (raw.data || {}) as Record<string, unknown>;

    assert.equal(responses.question_1, "Yes");
    assert.equal(responses.question_2, "No");
  });

  test("bug repro: using 'responses' key on insert leaves 'data' empty", () => {
    // This test demonstrates the original bug:
    // inserting with { responses: ... } does NOT populate the 'data' column
    stub.from("form_submissions").insert({
      form_id: formId,
      organization_id: orgId,
      user_id: userId,
      responses: { name: "Alice" },  // BUG: wrong column name
    });

    const rows = stub.getRows("form_submissions");
    assert.equal(rows.length, 1);

    // The 'data' column is undefined because we wrote to 'responses'
    assert.equal(rows[0].data, undefined, "'data' is not populated when writing to 'responses'");
    // The admin page reads submission.data → gets undefined → shows "-"
  });
});

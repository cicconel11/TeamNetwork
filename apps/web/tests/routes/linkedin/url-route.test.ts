import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import {
  parseLinkedInUrlPatchBody,
  saveLinkedInUrlForUser,
} from "@/lib/linkedin/settings";

const USER_ID = "22222222-2222-4222-8222-222222222222";

test("save helper updates a parent-only account", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: null,
    deleted_at: null,
  }]);
  serviceSupabase.registerRpc("save_user_linkedin_url", async ({ p_user_id, p_linkedin_url }) => {
    const { data } = await serviceSupabase
      .from("parents")
      .update({ linkedin_url: p_linkedin_url })
      .eq("user_id", p_user_id)
      .is("deleted_at", null);

    return { updated_count: data?.length ?? 0 };
  });

  const result = await saveLinkedInUrlForUser(
    serviceSupabase as never,
    USER_ID,
    "https://www.linkedin.com/in/parent-only",
  );

  assert.deepEqual(result, { success: true });
  assert.equal(
    serviceSupabase.getRows("parents")[0]?.linkedin_url,
    "https://www.linkedin.com/in/parent-only",
  );
});

test("save helper returns a failure when any table update fails", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.registerRpc("save_user_linkedin_url", () => {
    throw new Error("save failed");
  });

  const result = await saveLinkedInUrlForUser(
    serviceSupabase as never,
    USER_ID,
    "https://www.linkedin.com/in/failure-case",
  );

  assert.deepEqual(result, {
    success: false,
    reason: "db_error",
    error: "Failed to save LinkedIn URL",
  });
});

test("save helper ignores soft-deleted rows during updates", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: null,
    deleted_at: "2026-03-01T12:00:00.000Z",
  }]);
  serviceSupabase.registerRpc("save_user_linkedin_url", async ({ p_user_id, p_linkedin_url }) => {
    const { data } = await serviceSupabase
      .from("parents")
      .update({ linkedin_url: p_linkedin_url })
      .eq("user_id", p_user_id)
      .is("deleted_at", null);

    return { updated_count: data?.length ?? 0 };
  });

  const result = await saveLinkedInUrlForUser(
    serviceSupabase as never,
    USER_ID,
    "https://www.linkedin.com/in/active-only",
  );

  assert.deepEqual(result, {
    success: false,
    reason: "not_found",
    error: "No profile found to update",
  });
  assert.equal(serviceSupabase.getRows("parents")[0]?.linkedin_url, null);
});

test("save helper succeeds when some profile tables have no matching rows", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: null,
    deleted_at: null,
  }]);
  serviceSupabase.registerRpc("save_user_linkedin_url", async ({ p_user_id, p_linkedin_url }) => {
    const { data } = await serviceSupabase
      .from("parents")
      .update({ linkedin_url: p_linkedin_url })
      .eq("user_id", p_user_id)
      .is("deleted_at", null);

    return { updated_count: data?.length ?? 0 };
  });

  const result = await saveLinkedInUrlForUser(
    serviceSupabase as never,
    USER_ID,
    "https://www.linkedin.com/in/partial-presence",
  );

  assert.deepEqual(result, { success: true });
});

test("save helper fails when the user has no profile rows to update", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.registerRpc("save_user_linkedin_url", () => ({ updated_count: 0 }));

  const result = await saveLinkedInUrlForUser(
    serviceSupabase as never,
    USER_ID,
    "https://www.linkedin.com/in/no-profile",
  );

  assert.deepEqual(result, {
    success: false,
    reason: "not_found",
    error: "No profile found to update",
  });
});

test("save helper normalizes empty strings to null before invoking the RPC", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/existing-profile",
    deleted_at: null,
  }]);

  serviceSupabase.registerRpc("save_user_linkedin_url", async ({ p_user_id, p_linkedin_url }) => {
    assert.equal(p_linkedin_url, null);

    const { data } = await serviceSupabase
      .from("parents")
      .update({ linkedin_url: p_linkedin_url })
      .eq("user_id", p_user_id)
      .is("deleted_at", null);

    return { updated_count: data?.length ?? 0 };
  });

  const result = await saveLinkedInUrlForUser(
    serviceSupabase as never,
    USER_ID,
    "",
  );

  assert.deepEqual(result, { success: true });
  assert.equal(serviceSupabase.getRows("parents")[0]?.linkedin_url, null);
});

test("parseLinkedInUrlPatchBody rejects omitted linkedin_url", () => {
  const result = parseLinkedInUrlPatchBody({});

  assert.deepEqual(result, {
    success: false,
    error: "linkedin_url is required",
  });
});

test("parseLinkedInUrlPatchBody still allows explicit empty-string clears", () => {
  const result = parseLinkedInUrlPatchBody({ linkedin_url: "" });

  assert.deepEqual(result, {
    success: true,
    linkedinUrl: "",
  });
});

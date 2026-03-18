import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  getLatestLinkedInUrl,
  getOrgProfileLinkedInUrl,
  resolveLinkedInUrlForEnrichment,
} from "@/lib/linkedin/url-resolver";

const USER_ID = "22222222-2222-4222-8222-222222222222";

test("resolveLinkedInUrlForEnrichment picks the most recently updated org URL", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/member-user",
    deleted_at: null,
    updated_at: "2026-03-10T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }]);
  stub.seed("alumni", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/alumni-user",
    deleted_at: null,
    updated_at: "2026-03-11T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }]);
  stub.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/parent-user",
    deleted_at: null,
    updated_at: "2026-03-12T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }]);

  const result = await resolveLinkedInUrlForEnrichment(
    stub as never,
    USER_ID,
    "https://www.linkedin.com/in/connection-user",
  );

  // Parent has the newest updated_at (2026-03-12), so it wins
  assert.equal(result, "https://www.linkedin.com/in/parent-user");
});

test("getOrgProfileLinkedInUrl does not throw when member and alumni have the same updated_at", async () => {
  const stub = createSupabaseStub();
  stub.seed("members", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/member-user",
    deleted_at: null,
    updated_at: "2026-03-10T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }]);
  stub.seed("alumni", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/alumni-user",
    deleted_at: null,
    updated_at: "2026-03-10T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }]);

  const result = await getOrgProfileLinkedInUrl(stub as never, USER_ID);

  // Either URL is acceptable when timestamps tie
  assert.ok(
    result === "https://www.linkedin.com/in/member-user" ||
    result === "https://www.linkedin.com/in/alumni-user",
  );
});

test("getLatestLinkedInUrl ignores soft-deleted rows and returns the latest non-deleted URL", async () => {
  const stub = createSupabaseStub();
  stub.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/deleted-parent",
    deleted_at: "2026-03-01T00:00:00.000Z",
    updated_at: "2026-03-12T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }, {
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/live-parent",
    deleted_at: null,
    updated_at: "2026-03-10T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }]);

  const result = await getLatestLinkedInUrl(stub as never, "parents", USER_ID);

  assert.equal(result?.url, "https://www.linkedin.com/in/live-parent");
  assert.equal(result?.updatedAt, "2026-03-10T00:00:00.000Z");
});

test("resolveLinkedInUrlForEnrichment falls back to the connection URL when org rows have no LinkedIn URL", async () => {
  const stub = createSupabaseStub();

  const result = await resolveLinkedInUrlForEnrichment(
    stub as never,
    USER_ID,
    "https://www.linkedin.com/in/connection-user",
  );

  assert.equal(result, "https://www.linkedin.com/in/connection-user");
});

test("resolveLinkedInUrlForEnrichment loads the connection URL when no fallback value was provided", async () => {
  const stub = createSupabaseStub();
  stub.seed("user_linkedin_connections", [{
    user_id: USER_ID,
    linkedin_profile_url: "https://www.linkedin.com/in/connection-user",
    status: "connected",
  }]);

  const result = await resolveLinkedInUrlForEnrichment(stub as never, USER_ID);

  assert.equal(result, "https://www.linkedin.com/in/connection-user");
});

test("getOrgProfileLinkedInUrl throws when the highest-priority member lookup fails", async () => {
  const stub = createSupabaseStub();
  stub.simulateError("members", {
    message: "members table unavailable",
  });
  stub.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/parent-user",
    deleted_at: null,
    updated_at: "2026-03-10T00:00:00.000Z",
    created_at: "2026-03-01T00:00:00.000Z",
  }]);

  await assert.rejects(
    () => getOrgProfileLinkedInUrl(stub as never, USER_ID),
    /Failed to fetch LinkedIn URL from members: members table unavailable/,
  );
});

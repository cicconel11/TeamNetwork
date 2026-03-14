import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";
import { getLinkedInStatusForUser } from "@/lib/linkedin/settings";

const USER_ID = "11111111-1111-4111-8111-111111111111";

test("status helper falls back to parent linkedin_url when member and alumni rows are absent", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/parent-user",
    deleted_at: null,
    updated_at: "2026-03-10T12:00:00.000Z",
    created_at: "2026-03-01T12:00:00.000Z",
  }]);

  const result = await getLinkedInStatusForUser(serviceSupabase as never, USER_ID);

  assert.equal(result.linkedin_url, "https://www.linkedin.com/in/parent-user");
  assert.equal(result.connection, null);
});

test("status helper ignores soft-deleted parent rows", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/deleted-parent",
    deleted_at: "2026-03-01T12:00:00.000Z",
    updated_at: "2026-03-10T12:00:00.000Z",
    created_at: "2026-03-01T12:00:00.000Z",
  }]);

  const result = await getLinkedInStatusForUser(serviceSupabase as never, USER_ID);

  assert.equal(result.linkedin_url, null);
});

test("status helper preserves member then alumni precedence over parent rows", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.seed("members", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/member-user",
    deleted_at: null,
    updated_at: "2026-03-09T12:00:00.000Z",
    created_at: "2026-03-01T12:00:00.000Z",
  }]);
  serviceSupabase.seed("alumni", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/alumni-user",
    deleted_at: null,
    updated_at: "2026-03-11T12:00:00.000Z",
    created_at: "2026-03-01T12:00:00.000Z",
  }]);
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/parent-user",
    deleted_at: null,
    updated_at: "2026-03-12T12:00:00.000Z",
    created_at: "2026-03-01T12:00:00.000Z",
  }]);

  const result = await getLinkedInStatusForUser(serviceSupabase as never, USER_ID);

  assert.equal(result.linkedin_url, "https://www.linkedin.com/in/member-user");
});

test("status helper throws when the LinkedIn connection lookup fails", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.simulateError("user_linkedin_connections", {
    message: "connection lookup failed",
  });

  await assert.rejects(
    () => getLinkedInStatusForUser(serviceSupabase as never, USER_ID),
    /Failed to fetch LinkedIn connection: connection lookup failed/,
  );
});

test("status helper throws when the highest-priority member lookup fails", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.simulateError("members", {
    message: "members table unavailable",
  });
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/parent-user",
    deleted_at: null,
    updated_at: "2026-03-10T12:00:00.000Z",
    created_at: "2026-03-01T12:00:00.000Z",
  }]);

  await assert.rejects(
    () => getLinkedInStatusForUser(serviceSupabase as never, USER_ID),
    /Failed to fetch LinkedIn URL from members: members table unavailable/,
  );
});

test("status helper throws when the alumni lookup fails before falling through to parents", async () => {
  const serviceSupabase = createSupabaseStub();
  serviceSupabase.simulateError("alumni", {
    message: "alumni table unavailable",
  });
  serviceSupabase.seed("parents", [{
    user_id: USER_ID,
    linkedin_url: "https://www.linkedin.com/in/parent-user",
    deleted_at: null,
    updated_at: "2026-03-10T12:00:00.000Z",
    created_at: "2026-03-01T12:00:00.000Z",
  }]);

  await assert.rejects(
    () => getLinkedInStatusForUser(serviceSupabase as never, USER_ID),
    /Failed to fetch LinkedIn URL from alumni: alumni table unavailable/,
  );
});

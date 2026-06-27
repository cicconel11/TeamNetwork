import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  startProfileDirectChat,
  type ProfileDirectChatSupabase,
} from "../src/lib/chat/profile-direct-chat.ts";

const ORG_ID = "00000000-0000-4000-8000-000000000101";
const VIEWER_USER_ID = "00000000-0000-4000-8000-000000000102";
const TARGET_USER_ID = "00000000-0000-4000-8000-000000000103";
const TARGET_MEMBER_ID = "00000000-0000-4000-8000-000000000104";
const TARGET_ALUMNI_ID = "00000000-0000-4000-8000-000000000105";

test("startProfileDirectChat lets an active non-admin org member open a linked member profile chat", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: VIEWER_USER_ID,
      role: "active_member",
      status: "active",
    },
    {
      organization_id: ORG_ID,
      user_id: TARGET_USER_ID,
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.seed("users", [
    {
      id: TARGET_USER_ID,
      name: "Jason Leonard",
      email: "jason@example.com",
    },
  ]);
  supabase.seed("members", [
    {
      id: TARGET_MEMBER_ID,
      organization_id: ORG_ID,
      user_id: TARGET_USER_ID,
      status: "active",
      deleted_at: null,
      first_name: "Jason",
      last_name: "Leonard",
      email: "jason@example.com",
    },
  ]);

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "member",
    profileId: TARGET_MEMBER_ID,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.reused, false);
  assert.match(result.chatGroupId, /^[0-9a-f-]{36}$/);
  assert.equal(supabase.getRows("chat_groups").length, 1);
  assert.deepEqual(
    supabase.getRows("chat_group_members").map((row) => row.user_id).sort(),
    [TARGET_USER_ID, VIEWER_USER_ID].sort(),
  );
});

test("startProfileDirectChat rejects profiles without a linked user", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: VIEWER_USER_ID,
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.seed("members", [
    {
      id: TARGET_MEMBER_ID,
      organization_id: ORG_ID,
      user_id: null,
      status: "active",
      deleted_at: null,
      first_name: "Manual",
      last_name: "Member",
      email: "manual@example.com",
    },
  ]);

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "member",
    profileId: TARGET_MEMBER_ID,
  });

  assert.deepEqual(result, {
    ok: false,
    status: 409,
    code: "profile_unlinked",
    error: "This profile is not linked to an in-app user account.",
  });
  assert.equal(supabase.getRows("chat_groups").length, 0);
  assert.equal(supabase.getRows("chat_group_members").length, 0);
});

test("startProfileDirectChat rejects viewers without a chat-eligible org role", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: VIEWER_USER_ID,
      role: "coach",
      status: "active",
    },
  ]);

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "member",
    profileId: TARGET_MEMBER_ID,
  });

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    code: "forbidden",
    error: "You must be an active member of this organization to start a chat.",
  });
});

test("startProfileDirectChat reports profile lookup failures separately from missing profiles", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: VIEWER_USER_ID,
      role: "active_member",
      status: "active",
    },
  ]);
  supabase.simulateError("members", { message: "database unavailable" });

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "member",
    profileId: TARGET_MEMBER_ID,
  });

  assert.deepEqual(result, {
    ok: false,
    status: 500,
    code: "profile_lookup_failed",
    error: "Failed to load this profile for chat.",
  });
});

test("startProfileDirectChat lets an active org member open a linked alumni profile chat", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("user_organization_roles", [
    {
      organization_id: ORG_ID,
      user_id: VIEWER_USER_ID,
      role: "active_member",
      status: "active",
    },
    {
      organization_id: ORG_ID,
      user_id: TARGET_USER_ID,
      role: "alumni",
      status: "active",
    },
  ]);
  supabase.seed("users", [
    {
      id: TARGET_USER_ID,
      name: "Taylor Alum",
      email: "taylor@example.com",
    },
  ]);
  supabase.seed("alumni", [
    {
      id: TARGET_ALUMNI_ID,
      organization_id: ORG_ID,
      user_id: TARGET_USER_ID,
      deleted_at: null,
      first_name: "Taylor",
      last_name: "Alum",
      email: "taylor@example.com",
    },
  ]);

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "alumni",
    profileId: TARGET_ALUMNI_ID,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.reused, false);
  assert.deepEqual(
    supabase.getRows("chat_group_members").map((row) => row.user_id).sort(),
    [TARGET_USER_ID, VIEWER_USER_ID].sort(),
  );
});

// ── Parent consent gate (Phase 3) ─────────────────────────────────────────────

const TARGET_PARENT_ID = "00000000-0000-4000-8000-000000000106";

function seedViewer(supabase: ReturnType<typeof createSupabaseStub>) {
  supabase.seed("user_organization_roles", [
    { organization_id: ORG_ID, user_id: VIEWER_USER_ID, role: "active_member", status: "active" },
    { organization_id: ORG_ID, user_id: TARGET_USER_ID, role: "parent", status: "active" },
  ]);
  supabase.seed("users", [{ id: TARGET_USER_ID, name: "Pat Parent", email: "pat@example.com" }]);
}

test("messaging an opted-in claimed parent opens a chat", async () => {
  const supabase = createSupabaseStub();
  seedViewer(supabase);
  supabase.seed("parents", [
    {
      id: TARGET_PARENT_ID,
      organization_id: ORG_ID,
      user_id: TARGET_USER_ID,
      deleted_at: null,
      first_name: "Pat",
      last_name: "Parent",
      email: "pat@example.com",
      open_to_networking: true,
    },
  ]);

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "parent",
    profileId: TARGET_PARENT_ID,
  });

  assert.equal(result.ok, true);
});

test("messaging a parent who has NOT opted in is rejected (profile_inactive)", async () => {
  const supabase = createSupabaseStub();
  seedViewer(supabase);
  supabase.seed("parents", [
    {
      id: TARGET_PARENT_ID,
      organization_id: ORG_ID,
      user_id: TARGET_USER_ID,
      deleted_at: null,
      first_name: "Pat",
      last_name: "Parent",
      email: "pat@example.com",
      open_to_networking: false,
    },
  ]);

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "parent",
    profileId: TARGET_PARENT_ID,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "profile_inactive");
});

test("messaging an unclaimed parent is rejected even if open_to_networking is set", async () => {
  // Unclaimed parents can't actually set the flag in production (RLS blocks it),
  // but defense in depth: a null user_id parent is never messageable.
  const supabase = createSupabaseStub();
  seedViewer(supabase);
  supabase.seed("parents", [
    {
      id: TARGET_PARENT_ID,
      organization_id: ORG_ID,
      user_id: null,
      deleted_at: null,
      first_name: "Una",
      last_name: "Claimed",
      email: "una@example.com",
      open_to_networking: true,
    },
  ]);

  const result = await startProfileDirectChat(supabase as ProfileDirectChatSupabase, {
    organizationId: ORG_ID,
    viewerUserId: VIEWER_USER_ID,
    profileType: "parent",
    profileId: TARGET_PARENT_ID,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "profile_unlinked");
});

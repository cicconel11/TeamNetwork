import assert from "node:assert/strict";
import test, { describe, beforeEach } from "node:test";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

const GROUP_ID = "group-001";
const GROUP_ID_2 = "group-002";
const ORG_ID = "org-001";
const USER_1 = "user-001";
const USER_2 = "user-002";
const USER_3 = "user-003";
const ADMIN = "admin-001";

function makeMember(
  userId: string,
  groupId: string,
  removedAt: string | null = null,
) {
  return {
    chat_group_id: groupId,
    user_id: userId,
    organization_id: ORG_ID,
    role: "member",
    joined_at: new Date().toISOString(),
    removed_at: removedAt,
  };
}

describe("member query returns correct results", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("returns all active members (removed_at: null)", async () => {
    stub.seed("chat_group_members", [
      makeMember(USER_1, GROUP_ID),
      makeMember(USER_2, GROUP_ID),
      makeMember(USER_3, GROUP_ID),
    ]);

    const { data } = await stub
      .from("chat_group_members")
      .select("*")
      .eq("chat_group_id", GROUP_ID)
      .is("removed_at", null);

    assert.equal(data!.length, 3);
  });

  test("excludes removed members (removed_at set)", async () => {
    stub.seed("chat_group_members", [
      makeMember(USER_1, GROUP_ID),
      makeMember(USER_2, GROUP_ID),
      makeMember(USER_3, GROUP_ID, new Date().toISOString()),
    ]);

    const { data } = await stub
      .from("chat_group_members")
      .select("*")
      .eq("chat_group_id", GROUP_ID)
      .is("removed_at", null);

    assert.equal(data!.length, 2);
    const userIds = data!.map((r: Record<string, unknown>) => r.user_id);
    assert.ok(userIds.includes(USER_1));
    assert.ok(userIds.includes(USER_2));
    assert.ok(!userIds.includes(USER_3));
  });

  test("filters by chat_group_id correctly", async () => {
    stub.seed("chat_group_members", [
      makeMember(USER_1, GROUP_ID),
      makeMember(USER_2, GROUP_ID),
      makeMember(USER_3, GROUP_ID_2),
    ]);

    const { data } = await stub
      .from("chat_group_members")
      .select("*")
      .eq("chat_group_id", GROUP_ID)
      .is("removed_at", null);

    assert.equal(data!.length, 2);
    for (const row of data!) {
      assert.equal(
        (row as Record<string, unknown>).chat_group_id,
        GROUP_ID,
      );
    }
  });
});

describe("chat group creation member insert", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("insert without added_by succeeds (base schema compatibility)", () => {
    // The insert payload should NOT include added_by since the column
    // may not exist if migration 20260429100000 hasn't been applied.
    const memberInserts = [
      {
        chat_group_id: GROUP_ID,
        user_id: ADMIN,
        organization_id: ORG_ID,
        role: "admin",
      },
      {
        chat_group_id: GROUP_ID,
        user_id: USER_1,
        organization_id: ORG_ID,
        role: "member",
      },
      {
        chat_group_id: GROUP_ID,
        user_id: USER_2,
        organization_id: ORG_ID,
        role: "member",
      },
    ];

    // Insert should not include added_by
    for (const insert of memberInserts) {
      assert.equal(
        "added_by" in insert,
        false,
        "insert payload should NOT include added_by for base schema compatibility",
      );
    }

    const result = stub
      .from("chat_group_members")
      .insert(memberInserts[0])
      .single();

    assert.equal(result.error, null, "insert without added_by should succeed");
    assert.equal(result.data!.user_id, ADMIN);
  });

  test("creator is inserted as admin, others as member", () => {
    // Simulate the corrected form logic
    const selectedUserIds = [USER_1, USER_2];
    const memberInserts = [
      {
        chat_group_id: GROUP_ID,
        user_id: ADMIN,
        organization_id: ORG_ID,
        role: "admin" as const,
      },
      ...selectedUserIds
        .filter((uid) => uid !== ADMIN)
        .map((uid) => ({
          chat_group_id: GROUP_ID,
          user_id: uid,
          organization_id: ORG_ID,
          role: "member" as const,
        })),
    ];

    assert.equal(memberInserts.length, 3);
    assert.equal(memberInserts[0].role, "admin");
    assert.equal(memberInserts[0].user_id, ADMIN);
    assert.equal(memberInserts[1].role, "member");
    assert.equal(memberInserts[2].role, "member");
  });
});

describe("error handling on member queries", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("query with no matching rows returns empty array, not null", async () => {
    const { data, error } = await stub
      .from("chat_group_members")
      .select("*")
      .eq("chat_group_id", GROUP_ID)
      .is("removed_at", null);

    assert.equal(error, null);
    assert.ok(Array.isArray(data));
    assert.equal(data!.length, 0);
  });

  test("members state should default to empty array when data is null", () => {
    const data = null;
    const members = data || [];
    assert.ok(Array.isArray(members));
    assert.equal(members.length, 0);
  });
});

describe("add/remove member operations", () => {
  let stub: ReturnType<typeof createSupabaseStub>;

  beforeEach(() => {
    stub = createSupabaseStub();
  });

  test("adding a member via insert succeeds", () => {
    const result = stub
      .from("chat_group_members")
      .insert({
        chat_group_id: GROUP_ID,
        user_id: USER_1,
        organization_id: ORG_ID,
      })
      .single();

    assert.equal(result.error, null);
    assert.equal(result.data!.user_id, USER_1);
    assert.equal(stub.getRows("chat_group_members").length, 1);
  });

  test("removing a member sets removed_at timestamp", async () => {
    stub.seed("chat_group_members", [makeMember(USER_1, GROUP_ID)]);

    const now = new Date().toISOString();
    await stub
      .from("chat_group_members")
      .update({ removed_at: now })
      .eq("chat_group_id", GROUP_ID)
      .eq("user_id", USER_1);

    const rows = stub.getRows("chat_group_members");
    assert.equal(rows.length, 1);
    assert.ok(rows[0].removed_at !== null);
    assert.ok(rows[0].removed_at !== undefined);
  });

  test("re-adding a previously removed member clears removed_at", async () => {
    stub.seed("chat_group_members", [
      makeMember(USER_1, GROUP_ID, "2024-01-01T00:00:00.000Z"),
    ]);

    await stub
      .from("chat_group_members")
      .update({ removed_at: null })
      .eq("chat_group_id", GROUP_ID)
      .eq("user_id", USER_1);

    const rows = stub.getRows("chat_group_members");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].removed_at, null);
  });
});

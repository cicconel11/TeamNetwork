import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("listUserChatGroups", () => {
  interface MockGroup {
    id: string;
    name: string;
    description: string | null;
    require_approval: boolean;
    updated_at: string | null;
    deleted_at: string | null;
  }

  interface MockMembership {
    chat_group_id: string;
    role: "admin" | "moderator" | "member";
    chat_groups: MockGroup;
  }

  function createMockSupabase(opts: { memberships?: MockMembership[]; error?: { message: string } }) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({
                order: () => ({
                  limit: async () => {
                    if (opts.error) return { data: null, error: opts.error };
                    return { data: opts.memberships ?? [], error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      }),
    };
  }

  it("returns user chat groups", async () => {
    const { listUserChatGroups } = await import("../src/lib/chat/group-chat.ts");
    const memberships: MockMembership[] = [
      {
        chat_group_id: "g1",
        role: "admin",
        chat_groups: {
          id: "g1",
          name: "General",
          description: "Main channel",
          require_approval: false,
          updated_at: "2026-04-13T12:00:00Z",
          deleted_at: null,
        },
      },
      {
        chat_group_id: "g2",
        role: "member",
        chat_groups: {
          id: "g2",
          name: "Announcements",
          description: null,
          require_approval: true,
          updated_at: "2026-04-12T12:00:00Z",
          deleted_at: null,
        },
      },
    ];
    const mock = createMockSupabase({ memberships });
    const result = await listUserChatGroups(mock, {
      organizationId: "org1",
      userId: "user1",
    });

    assert.equal(result.error, null);
    assert.equal(result.data?.length, 2);
    assert.equal(result.data?.[0].name, "General");
    assert.equal(result.data?.[0].role, "admin");
    assert.equal(result.data?.[1].name, "Announcements");
    assert.equal(result.data?.[1].role, "member");
  });

  it("filters out soft-deleted groups", async () => {
    const { listUserChatGroups } = await import("../src/lib/chat/group-chat.ts");
    const memberships: MockMembership[] = [
      {
        chat_group_id: "g1",
        role: "admin",
        chat_groups: {
          id: "g1",
          name: "Active",
          description: null,
          require_approval: false,
          updated_at: "2026-04-13T12:00:00Z",
          deleted_at: null,
        },
      },
      {
        chat_group_id: "g2",
        role: "member",
        chat_groups: {
          id: "g2",
          name: "Deleted",
          description: null,
          require_approval: false,
          updated_at: "2026-04-12T12:00:00Z",
          deleted_at: "2026-04-11T12:00:00Z",
        },
      },
    ];
    const mock = createMockSupabase({ memberships });
    const result = await listUserChatGroups(mock, {
      organizationId: "org1",
      userId: "user1",
    });

    assert.equal(result.error, null);
    assert.equal(result.data?.length, 1);
    assert.equal(result.data?.[0].name, "Active");
  });

  it("returns error on query failure", async () => {
    const { listUserChatGroups } = await import("../src/lib/chat/group-chat.ts");
    const mock = createMockSupabase({ error: { message: "DB error" } });
    const result = await listUserChatGroups(mock, {
      organizationId: "org1",
      userId: "user1",
    });

    assert.notEqual(result.error, null);
    assert.equal(result.data, null);
  });
});

describe("resolveGroupChatTarget", () => {
  interface MockGroup {
    id: string;
    name: string;
    require_approval: boolean;
    deleted_at: string | null;
  }

  interface MockMembership {
    role: "admin" | "moderator" | "member";
    chat_groups: MockGroup;
  }

  function createMockSupabase(opts: {
    membership?: MockMembership | null;
    memberships?: MockMembership[];
    error?: { message: string };
  }) {
    return {
      from: () => ({
        select: () => ({
          eq: (col: string) => {
            // For explicit group ID lookup (maybeSingle)
            if (col === "chat_group_id") {
              return {
                eq: () => ({
                  eq: () => ({
                    is: () => ({
                      maybeSingle: async () => {
                        if (opts.error) return { data: null, error: opts.error };
                        return { data: opts.membership ?? null, error: null };
                      },
                    }),
                  }),
                }),
              };
            }
            // For name search (returns array)
            return {
              eq: () => ({
                is: async () => {
                  if (opts.error) return { data: null, error: opts.error };
                  return { data: opts.memberships ?? [], error: null };
                },
              }),
            };
          },
        }),
      }),
    };
  }

  it("returns group_required when no identifiers provided", async () => {
    const { resolveGroupChatTarget } = await import("../src/lib/chat/group-chat.ts");
    const mock = createMockSupabase({});
    const result = await resolveGroupChatTarget(mock, {
      organizationId: "org1",
      userId: "user1",
    });

    assert.equal(result.kind, "group_required");
  });

  it("resolves group by explicit ID", async () => {
    const { resolveGroupChatTarget } = await import("../src/lib/chat/group-chat.ts");
    const membership: MockMembership = {
      role: "admin",
      chat_groups: {
        id: "g1",
        name: "General",
        require_approval: false,
        deleted_at: null,
      },
    };
    const mock = createMockSupabase({ membership });
    const result = await resolveGroupChatTarget(mock, {
      organizationId: "org1",
      userId: "user1",
      chatGroupId: "g1",
    });

    assert.equal(result.kind, "resolved");
    if (result.kind === "resolved") {
      assert.equal(result.chatGroupId, "g1");
      assert.equal(result.groupName, "General");
      assert.equal(result.messageStatus, "approved");
    }
  });

  it("returns approved status for admin in approval-required group", async () => {
    const { resolveGroupChatTarget } = await import("../src/lib/chat/group-chat.ts");
    const membership: MockMembership = {
      role: "admin",
      chat_groups: {
        id: "g1",
        name: "Moderated",
        require_approval: true,
        deleted_at: null,
      },
    };
    const mock = createMockSupabase({ membership });
    const result = await resolveGroupChatTarget(mock, {
      organizationId: "org1",
      userId: "user1",
      chatGroupId: "g1",
    });

    assert.equal(result.kind, "resolved");
    if (result.kind === "resolved") {
      assert.equal(result.messageStatus, "approved");
    }
  });

  it("returns pending status for member in approval-required group", async () => {
    const { resolveGroupChatTarget } = await import("../src/lib/chat/group-chat.ts");
    const membership: MockMembership = {
      role: "member",
      chat_groups: {
        id: "g1",
        name: "Moderated",
        require_approval: true,
        deleted_at: null,
      },
    };
    const mock = createMockSupabase({ membership });
    const result = await resolveGroupChatTarget(mock, {
      organizationId: "org1",
      userId: "user1",
      chatGroupId: "g1",
    });

    assert.equal(result.kind, "resolved");
    if (result.kind === "resolved") {
      assert.equal(result.messageStatus, "pending");
    }
  });

  it("returns unavailable for non-member", async () => {
    const { resolveGroupChatTarget } = await import("../src/lib/chat/group-chat.ts");
    const mock = createMockSupabase({ membership: null });
    const result = await resolveGroupChatTarget(mock, {
      organizationId: "org1",
      userId: "user1",
      chatGroupId: "g1",
    });

    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.equal(result.reason, "not_a_member");
    }
  });

  it("returns unavailable for deleted group", async () => {
    const { resolveGroupChatTarget } = await import("../src/lib/chat/group-chat.ts");
    const membership: MockMembership = {
      role: "admin",
      chat_groups: {
        id: "g1",
        name: "Deleted",
        require_approval: false,
        deleted_at: "2026-04-11T12:00:00Z",
      },
    };
    const mock = createMockSupabase({ membership });
    const result = await resolveGroupChatTarget(mock, {
      organizationId: "org1",
      userId: "user1",
      chatGroupId: "g1",
    });

    assert.equal(result.kind, "unavailable");
    if (result.kind === "unavailable") {
      assert.equal(result.reason, "group_deleted");
    }
  });
});

describe("sendAiAssistedGroupChatMessage", () => {
  interface MockGroup {
    id: string;
    name: string;
    require_approval: boolean;
    deleted_at: string | null;
  }

  interface MockMembership {
    role: "admin" | "moderator" | "member";
    chat_groups: MockGroup;
  }

  interface MockMessage {
    id: string;
  }

  function createMockSupabase(opts: {
    membership?: MockMembership | null;
    messageId?: string;
    messageError?: { message: string };
  }) {
    return {
      from: (table: string) => {
        if (table === "chat_group_members") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    is: () => ({
                      maybeSingle: async () => {
                        return { data: opts.membership ?? null, error: null };
                      },
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "chat_messages") {
          return {
            insert: () => ({
              select: () => ({
                single: async () => {
                  if (opts.messageError) return { data: null, error: opts.messageError };
                  return { data: { id: opts.messageId ?? "msg1" } as MockMessage, error: null };
                },
              }),
            }),
          };
        }
        return {};
      },
    };
  }

  it("sends message successfully", async () => {
    const { sendAiAssistedGroupChatMessage } = await import("../src/lib/chat/group-chat.ts");
    const membership: MockMembership = {
      role: "admin",
      chat_groups: {
        id: "g1",
        name: "General",
        require_approval: false,
        deleted_at: null,
      },
    };
    const mock = createMockSupabase({ membership, messageId: "msg123" });
    const result = await sendAiAssistedGroupChatMessage(mock, {
      organizationId: "org1",
      senderUserId: "user1",
      chatGroupId: "g1",
      groupName: "General",
      messageStatus: "approved",
      body: "Hello group!",
    });

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.chatGroupId, "g1");
      assert.equal(result.messageId, "msg123");
      assert.equal(result.messageStatus, "approved");
    }
  });

  it("returns error when no longer a member", async () => {
    const { sendAiAssistedGroupChatMessage } = await import("../src/lib/chat/group-chat.ts");
    const mock = createMockSupabase({ membership: null });
    const result = await sendAiAssistedGroupChatMessage(mock, {
      organizationId: "org1",
      senderUserId: "user1",
      chatGroupId: "g1",
      groupName: "General",
      messageStatus: "approved",
      body: "Hello group!",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "not_a_member");
      assert.equal(result.status, 403);
    }
  });

  it("returns error on message insert failure", async () => {
    const { sendAiAssistedGroupChatMessage } = await import("../src/lib/chat/group-chat.ts");
    const membership: MockMembership = {
      role: "admin",
      chat_groups: {
        id: "g1",
        name: "General",
        require_approval: false,
        deleted_at: null,
      },
    };
    const mock = createMockSupabase({ membership, messageError: { message: "Insert failed" } });
    const result = await sendAiAssistedGroupChatMessage(mock, {
      organizationId: "org1",
      senderUserId: "user1",
      chatGroupId: "g1",
      groupName: "General",
      messageStatus: "approved",
      body: "Hello group!",
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "message_insert_failed");
      assert.equal(result.status, 500);
    }
  });
});

// Schema tests are skipped because they require TSX/alias resolution unavailable in node:test
// The schemas are validated via TypeScript compilation in tsc --noEmit

describe("buildPendingActionSummary for send_group_chat_message", () => {
  it("returns correct summary for group chat message action", async () => {
    const { buildPendingActionSummary } = await import("../src/lib/ai/pending-actions.ts");

    const mockRecord = {
      id: "action1",
      organization_id: "org1",
      user_id: "user1",
      thread_id: "thread1",
      action_type: "send_group_chat_message" as const,
      payload: {
        chat_group_id: "g1",
        group_name: "General",
        message_status: "approved" as const,
        body: "Hello",
      },
      status: "pending" as const,
      expires_at: "2026-04-13T12:00:00Z",
      created_at: "2026-04-13T11:00:00Z",
      updated_at: "2026-04-13T11:00:00Z",
      executed_at: null,
      result_entity_type: null,
      result_entity_id: null,
    };

    const summary = buildPendingActionSummary(mockRecord);

    assert.equal(summary.title, "Review group chat message");
    assert.ok(summary.description.includes("chat group"));
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";
import {
  type DirectChatSupabase,
  findExactDirectChatGroup,
  resolveChatMessageRecipient,
  sendAiAssistedDirectChatMessage,
} from "../src/lib/chat/direct-chat.ts";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const SENDER_USER_ID = "00000000-0000-4000-8000-000000000002";
const RECIPIENT_USER_ID = "00000000-0000-4000-8000-000000000003";
const RECIPIENT_MEMBER_ID = "00000000-0000-4000-8000-000000000004";

test("findExactDirectChatGroup reuses an active exact two-person chat", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("chat_groups", [
    {
      id: "00000000-0000-4000-8000-000000000010",
      organization_id: ORG_ID,
      deleted_at: null,
      updated_at: "2026-04-13T00:00:00.000Z",
    },
  ]);
  supabase.seed("chat_group_members", [
    {
      chat_group_id: "00000000-0000-4000-8000-000000000010",
      organization_id: ORG_ID,
      user_id: SENDER_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000010",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      removed_at: null,
    },
  ]);

  const result = await findExactDirectChatGroup(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientUserId: RECIPIENT_USER_ID,
  });

  assert.deepEqual(result, {
    chatGroupId: "00000000-0000-4000-8000-000000000010",
    error: null,
  });
});

test("findExactDirectChatGroup refuses chats with extra active members or removed membership history", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("chat_groups", [
    {
      id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      deleted_at: null,
      updated_at: "2026-04-13T00:00:00.000Z",
    },
    {
      id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      deleted_at: null,
      updated_at: "2026-04-12T00:00:00.000Z",
    },
  ]);
  supabase.seed("chat_group_members", [
    {
      chat_group_id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      user_id: SENDER_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000011",
      organization_id: ORG_ID,
      user_id: "00000000-0000-4000-8000-000000000099",
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      user_id: SENDER_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      removed_at: null,
    },
    {
      chat_group_id: "00000000-0000-4000-8000-000000000012",
      organization_id: ORG_ID,
      user_id: "00000000-0000-4000-8000-000000000098",
      removed_at: "2026-04-01T00:00:00.000Z",
    },
  ]);

  const result = await findExactDirectChatGroup(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientUserId: RECIPIENT_USER_ID,
  });

  assert.deepEqual(result, {
    chatGroupId: null,
    error: null,
  });
});

test("sendAiAssistedDirectChatMessage creates a new 1:1 chat and records ai_assisted metadata", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("members", [
    {
      id: RECIPIENT_MEMBER_ID,
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      status: "active",
      deleted_at: null,
      first_name: "Jason",
      last_name: "Leonard",
      email: "jason@example.com",
    },
  ]);

  const result = await sendAiAssistedDirectChatMessage(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    recipientMemberId: RECIPIENT_MEMBER_ID,
    recipientUserId: RECIPIENT_USER_ID,
    recipientDisplayName: "Jason Leonard",
    body: "Can you join the alumni panel next Thursday?",
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const groups = supabase.getRows("chat_groups");
  const memberships = supabase.getRows("chat_group_members");
  const messages = supabase.getRows("chat_messages");

  assert.equal(groups.length, 1);
  assert.equal(memberships.length, 2);
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.author_id, SENDER_USER_ID);
  assert.equal(messages[0]?.status, "approved");
  assert.deepEqual(messages[0]?.metadata, { ai_assisted: true });
});

test("resolveChatMessageRecipient ignores duplicate org rows that are not chat-eligible", async () => {
  const supabase = createSupabaseStub();
  supabase.seed("members", [
    {
      id: "00000000-0000-4000-8000-000000000020",
      organization_id: ORG_ID,
      user_id: RECIPIENT_USER_ID,
      status: "active",
      deleted_at: null,
      first_name: "Louis",
      last_name: "Ciccone",
      email: "cicconel@myteamnetwork.com",
    },
    {
      id: "00000000-0000-4000-8000-000000000021",
      organization_id: ORG_ID,
      user_id: null,
      status: "active",
      deleted_at: null,
      first_name: "Louis",
      last_name: "Ciccone",
      email: "lociccone11@gmail.com",
    },
  ]);

  const result = await resolveChatMessageRecipient(supabase as DirectChatSupabase, {
    organizationId: ORG_ID,
    senderUserId: SENDER_USER_ID,
    personQuery: "Louis Ciccone",
  });

  assert.deepEqual(result, {
    kind: "resolved",
    memberId: "00000000-0000-4000-8000-000000000020",
    userId: RECIPIENT_USER_ID,
    displayName: "Louis Ciccone",
    existingChatGroupId: null,
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";

const ORG_ID = "org-uuid-1";
const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const ADMIN_USER = { id: "admin-user", email: "admin@example.com" };
let requestCounter = 1;

const { createAiPendingActionConfirmHandler } = await import(
  "../../../src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts"
);
const { createAiPendingActionCancelHandler } = await import(
  "../../../src/app/api/ai/[orgId]/pending-actions/[actionId]/cancel/handler.ts"
);

function buildRequest() {
  return new Request(`http://localhost/api/ai/${ORG_ID}/pending-actions/${ACTION_ID}/confirm`, {
    method: "POST",
    headers: {
      "x-forwarded-for": `127.0.0.${requestCounter++}`,
    },
  });
}

test("confirm executes create_job_posting and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedMessages.push(payload);
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_job_posting",
        payload: {
          title: "Senior Product Designer",
          company: "Acme Corp",
          location: "San Francisco, CA",
          industry: "SaaS",
          experience_level: "senior",
          description: "Lead product design across our platform.",
          application_url: "https://example.com/jobs/senior-product-designer",
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createJobPosting: async () =>
      ({
        ok: true,
        status: 201,
        job: {
          id: "job-123",
          title: "Senior Product Designer",
        },
      }) as any,
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.match(String(insertedMessages[0].content), /Created job posting/);
  assert.match(String(insertedMessages[0].content), /upenn-sprint-football\/jobs\/job-123/);
});

test("confirm executes send_chat_message and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedMessages.push(payload);
                  return Promise.resolve({ error: null });
                },
              };
            }
            if (table === "ai_threads") {
              return {
                update() {
                  return {
                    eq() {
                      return Promise.resolve({ error: null });
                    },
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "send_chat_message",
        payload: {
          recipient_member_id: "11111111-1111-4111-8111-111111111111",
          recipient_user_id: "22222222-2222-4222-8222-222222222222",
          recipient_display_name: "Jason Leonard",
          existing_chat_group_id: "chat-123",
          body: "Can you join the alumni panel next Thursday?",
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    sendAiAssistedDirectChatMessage: async () =>
      ({
        ok: true,
        chatGroupId: "chat-123",
        messageId: "message-123",
        reusedExistingChat: true,
      }) as any,
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(updatedStatuses[1].resultEntityType, "chat_message");
  assert.equal(updatedStatuses[1].resultEntityId, "message-123");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.equal(insertedMessages[0].org_id, ORG_ID);
  assert.match(String(insertedMessages[0].content), /Sent chat message to/);
  assert.match(String(insertedMessages[0].content), /upenn-sprint-football\/messages\/chat\/chat-123/);
});

test("confirm executes create_discussion_thread and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedMessages.push(payload);
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_discussion_thread",
        payload: {
          title: "Spring Fundraising Volunteers",
          body: "Let's organize volunteer assignments for the spring fundraiser.",
          mediaIds: ["11111111-1111-4111-8111-111111111111"],
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createDiscussionThread: async () =>
      ({
        ok: true,
        status: 201,
        thread: {
          id: "thread-123",
          title: "Spring Fundraising Volunteers",
        },
        threadUrl: "/upenn-sprint-football/messages/threads/thread-123",
      }) as any,
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(updatedStatuses[1].resultEntityType, "discussion_thread");
  assert.equal(updatedStatuses[1].resultEntityId, "thread-123");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.match(String(insertedMessages[0].content), /Created discussion thread/);
  assert.match(
    String(insertedMessages[0].content),
    /upenn-sprint-football\/messages\/threads\/thread-123/
  );
});

test("confirm executes create_announcement and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedMessages.push(payload);
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_announcement",
        payload: {
          title: "Practice moved indoors",
          body: "Meet in Weight Room B at 6pm.",
          audience: "all",
          is_pinned: true,
          send_notification: false,
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createAnnouncement: async () =>
      ({
        ok: true,
        status: 201,
        announcement: {
          id: "announcement-123",
          title: "Practice moved indoors",
        },
      }) as any,
    clearDraftSession: async () => {},
  } as any);

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(updatedStatuses[1].resultEntityType, "announcement");
  assert.equal(updatedStatuses[1].resultEntityId, "announcement-123");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.match(String(insertedMessages[0].content), /Created announcement/);
  assert.match(
    String(insertedMessages[0].content),
    /upenn-sprint-football\/announcements/
  );
});

test("confirm create_announcement sends notifications server-side without internal auth fetches", async () => {
  const insertedMessages: any[] = [];
  const insertedNotifications: any[] = [];
  const updatedNotificationIds: string[] = [];
  const updatedStatuses: any[] = [];
  const blasts: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedMessages.push(payload);
                  return Promise.resolve({ error: null });
                },
              };
            }
            if (table === "notifications") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedNotifications.push(payload);
                  return {
                    select() {
                      return {
                        single() {
                          return Promise.resolve({
                            data: { id: "notification-123", ...payload },
                            error: null,
                          });
                        },
                      };
                    },
                  };
                },
                update(payload: Record<string, unknown>) {
                  return {
                    eq(_column: string, id: string) {
                      updatedNotificationIds.push(id);
                      return Promise.resolve({ data: { id, ...payload }, error: null });
                    },
                  };
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_announcement",
        payload: {
          title: "Practice moved indoors",
          body: "Meet in Weight Room B at 6pm.",
          audience: "all",
          is_pinned: true,
          send_notification: true,
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createAnnouncement: async () =>
      ({
        ok: true,
        status: 201,
        announcement: {
          id: "announcement-123",
          title: "Practice moved indoors",
        },
      }) as any,
    sendNotificationBlast: async (input) => {
      blasts.push(input);
      return {
        total: 3,
        emailCount: 3,
        smsCount: 0,
        skippedMissingContact: 0,
        errors: [],
      };
    },
    clearDraftSession: async () => {},
  } as any);

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(insertedNotifications.length, 1);
  assert.equal(insertedNotifications[0].organization_id, ORG_ID);
  assert.equal(blasts.length, 1);
  assert.equal(blasts[0].organizationId, ORG_ID);
  assert.equal(blasts[0].title, "Practice moved indoors");
  assert.equal(blasts[0].body, "Meet in Weight Room B at 6pm.");
  assert.equal(blasts[0].category, "announcement");
  assert.deepEqual(updatedNotificationIds, ["notification-123"]);
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
});

test("confirm executes create_discussion_reply and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];
  const discussionThreadId = "33333333-3333-4333-8333-333333333333";

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedMessages.push(payload);
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_discussion_reply",
        payload: {
          discussion_thread_id: discussionThreadId,
          thread_title: "Spring Fundraising Volunteers",
          body: "I can cover the alumni outreach shift.",
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createDiscussionReply: async () =>
      ({
        ok: true,
        status: 201,
        reply: {
          id: "reply-123",
          body: "I can cover the alumni outreach shift.",
        },
        thread: {
          id: discussionThreadId,
          title: "Spring Fundraising Volunteers",
        },
      }) as any,
    clearDraftSession: async () => {},
  } as any);

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(updatedStatuses[1].resultEntityType, "discussion_reply");
  assert.equal(updatedStatuses[1].resultEntityId, "reply-123");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.match(String(insertedMessages[0].content), /Posted reply in discussion thread/);
  assert.match(
    String(insertedMessages[0].content),
    /upenn-sprint-football\/messages\/threads\/33333333-3333-4333-8333-333333333333/
  );
});

test("confirm executes create_event and appends assistant message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];
  const syncedEvents: any[] = [];
  const outlookSyncedEvents: any[] = [];
  const blasts: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert(payload: Record<string, unknown>) {
                  insertedMessages.push(payload);
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_event",
        payload: {
          title: "Sprint Football Practice",
          description: "Film and conditioning",
          start_date: "2026-04-10",
          start_time: "18:00",
          end_date: "2026-04-10",
          end_time: "20:00",
          location: "Franklin Field",
          event_type: "class",
          is_philanthropy: false,
          orgSlug: "upenn-sprint-football",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createEvent: async () =>
      ({
        ok: true,
        status: 201,
        event: {
          id: "event-123",
          title: "Sprint Football Practice",
        },
        eventUrl: "/upenn-sprint-football/calendar/events/event-123",
      }) as any,
    syncEventToUsers: async (_supabase, organizationId, eventId, operation) => {
      syncedEvents.push({ organizationId, eventId, operation });
    },
    syncOutlookEventToUsers: async (_supabase, organizationId, eventId, operation) => {
      outlookSyncedEvents.push({ organizationId, eventId, operation });
    },
    sendNotificationBlast: async (input) => {
      blasts.push(input);
      return {
        total: 4,
        emailCount: 4,
        smsCount: 0,
        skippedMissingContact: 0,
        errors: [],
      };
    },
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.event.id, "event-123");
  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.equal(updatedStatuses[1].resultEntityType, "event");
  assert.equal(updatedStatuses[1].resultEntityId, "event-123");
  assert.equal(insertedMessages[0].thread_id, THREAD_ID);
  assert.match(String(insertedMessages[0].content), /Created event/);
  assert.match(
    String(insertedMessages[0].content),
    /upenn-sprint-football\/calendar\/events\/event-123/
  );
  assert.deepEqual(syncedEvents, [{ organizationId: ORG_ID, eventId: "event-123", operation: "create" }]);
  assert.deepEqual(outlookSyncedEvents, [{ organizationId: ORG_ID, eventId: "event-123", operation: "create" }]);
  assert.equal(blasts.length, 1);
  assert.equal(blasts[0].organizationId, ORG_ID);
  assert.equal(blasts[0].title, "New Event: Sprint Football Practice");
  assert.equal(blasts[0].category, "event");
});

test("confirm create_event rolls back and returns structured event_type errors", async () => {
  const updatedStatuses: any[] = [];
  const logged: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => logged.push(args);

  try {
    const handler = createAiPendingActionConfirmHandler({
      createClient: async () =>
        ({
          auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
        }) as any,
      getAiOrgContext: async () =>
        ({
          ok: true,
          orgId: ORG_ID,
          userId: ADMIN_USER.id,
          role: "admin",
          supabase: null,
          serviceSupabase: {
            from(table: string) {
              if (table === "ai_messages") {
                return {
                  insert() {
                    return Promise.resolve({ error: null });
                  },
                };
              }
              throw new Error(`unexpected table ${table}`);
            },
          },
        }) as any,
      getPendingAction: async () =>
        ({
          id: ACTION_ID,
          organization_id: ORG_ID,
          user_id: ADMIN_USER.id,
          thread_id: THREAD_ID,
          action_type: "create_event",
          payload: {
            title: "Chemistry 101",
            start_date: "2026-04-10",
            start_time: "18:00",
            end_date: "2026-04-10",
            end_time: "20:00",
            location: "Franklin Field",
            event_type: "class",
            is_philanthropy: false,
            orgSlug: "upenn-sprint-football",
          },
          status: "pending",
          expires_at: "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          executed_at: null,
          result_entity_type: null,
          result_entity_id: null,
        }) as any,
      updatePendingActionStatus: async (_supabase, _actionId, payload) => {
        updatedStatuses.push(payload);
        return { updated: true };
      },
      createEvent: async () =>
        ({
          ok: false,
          status: 500,
          code: "event_type_unavailable",
          error:
            "This environment does not support the selected event type yet. Apply the latest database migrations and try again.",
          internalError: {
            code: "22P02",
            message: 'invalid input value for enum event_type: "class"',
            details: null,
            hint: null,
          },
        }) as any,
      clearDraftSession: async () => {},
    });

    const response = await handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error, "This environment does not support the selected event type yet. Apply the latest database migrations and try again.");
    assert.equal(body.code, "event_type_unavailable");
    assert.equal(updatedStatuses[0].status, "confirmed");
    assert.equal(updatedStatuses[1].status, "pending");
    assert.equal(updatedStatuses[1].expectedStatus, "confirmed");

    const failureLog = logged.find(
      (entry) => typeof entry[0] === "string" && entry[0].includes("create_event confirmation failed")
    );
    assert.ok(failureLog, "should log the structured create_event failure");
    assert.equal(failureLog[1].actionId, ACTION_ID);
    assert.equal(failureLog[1].attemptedEventType, "class");
    assert.equal(failureLog[1].eventErrorCode, "event_type_unavailable");
  } finally {
    console.error = originalError;
  }
});

test("confirm allows a 25-event AI batch confirmation for the same user", async () => {
  let createEventCalls = 0;

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert() {
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    getPendingAction: async (_supabase, actionId) =>
      ({
        id: actionId,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_event",
        payload: {
          title: `Fordham Baseball ${actionId}`,
          start_date: "2026-04-10",
          start_time: "18:00",
          end_date: "2026-04-10",
          end_time: "20:00",
          location: "Moglia Stadium",
          event_type: "game",
          is_philanthropy: false,
          orgSlug: "fordham-prep",
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async () => ({ updated: true }),
    createEvent: async ({ input }) => {
      createEventCalls += 1;
      return {
        ok: true,
        status: 201,
        event: {
          id: `event-${createEventCalls}`,
          title: input.title,
        },
        eventUrl: `/fordham-prep/calendar/events/event-${createEventCalls}`,
      } as any;
    },
    clearDraftSession: async () => {},
  });

  const responses = await Promise.all(
    Array.from({ length: 25 }, async (_, index) => {
      const response = await handler(buildRequest() as any, {
        params: Promise.resolve({ orgId: ORG_ID, actionId: `action-${index + 1}` }),
      });
      return {
        status: response.status,
        body: await response.json(),
      };
    })
  );

  assert.equal(createEventCalls, 25);
  assert.ok(
    responses.every((response) => response.status === 200 && response.body.ok === true),
    `expected all 25 confirmations to succeed, got ${JSON.stringify(responses)}`
  );
});

test("cancel marks the pending action cancelled", async () => {
  const updatedStatuses: any[] = [];

  const handler = createAiPendingActionCancelHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from() {
            return {
              insert() {
                return Promise.resolve({ error: null });
              },
            };
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_job_posting",
        payload: {},
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedStatuses[0].status, "cancelled");
});

// --- Regression tests ---

function buildPendingAction(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTION_ID,
    organization_id: ORG_ID,
    user_id: ADMIN_USER.id,
    thread_id: THREAD_ID,
    action_type: "create_job_posting",
    payload: {
      title: "Senior Product Designer",
      company: "Acme Corp",
      location: "San Francisco, CA",
      industry: "SaaS",
      experience_level: "senior",
      description: "Lead product design across our platform.",
      application_url: "https://example.com/jobs/senior-product-designer",
      orgSlug: "upenn-sprint-football",
    },
    status: "pending",
    expires_at: "2099-01-01T00:00:00.000Z",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    executed_at: null,
    result_entity_type: null,
    result_entity_id: null,
    ...overrides,
  };
}

function buildBaseDeps(overrides: Record<string, unknown> = {}) {
  return {
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from(table: string) {
            if (table === "ai_messages") {
              return {
                insert() {
                  return Promise.resolve({ error: null });
                },
              };
            }
            throw new Error(`unexpected table ${table}`);
          },
        },
      }) as any,
    clearDraftSession: async () => {},
    ...overrides,
  };
}

test("CAS race: second concurrent confirm gets idempotent replay", async () => {
  let casCallCount = 0;
  const handler = createAiPendingActionConfirmHandler({
    ...buildBaseDeps(),
    getPendingAction: async () => {
      // On re-read after CAS failure, return executed state
      if (casCallCount > 0) {
        return buildPendingAction({
          status: "executed",
          result_entity_type: "job_posting",
          result_entity_id: "job-123",
        }) as any;
      }
      return buildPendingAction() as any;
    },
    updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
      casCallCount++;
      if (payload.status === "confirmed" && payload.expectedStatus === "pending") {
        // Simulate CAS failure — another request claimed the row first
        return { updated: false };
      }
      return { updated: true };
    },
    createJobPosting: async () => {
      throw new Error("should not be called on CAS failure");
    },
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.replayed, true);
  assert.equal(body.resultEntityType, "job_posting");
});

test("exception during write rolls back to pending", async () => {
  const updatedStatuses: any[] = [];
  const handler = createAiPendingActionConfirmHandler({
    ...buildBaseDeps(),
    getPendingAction: async () => buildPendingAction() as any,
    updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    createJobPosting: async () => {
      throw new Error("Supabase timeout");
    },
  });

  await assert.rejects(
    handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    }),
    { message: "Supabase timeout" }
  );

  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[1].status, "pending");
  assert.equal(updatedStatuses[1].expectedStatus, "confirmed");
});

test("rollback failure logs structured error and re-throws", async () => {
  const logged: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => logged.push(args);

  try {
    const handler = createAiPendingActionConfirmHandler({
      ...buildBaseDeps(),
      getPendingAction: async () => buildPendingAction() as any,
      updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
        if (payload.status === "confirmed") return { updated: true };
        // Rollback fails
        throw new Error("rollback connection lost");
      },
      createJobPosting: async () => {
        throw new Error("Supabase timeout");
      },
    });

    await assert.rejects(
      handler(buildRequest() as any, {
        params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
      }),
      { message: "Supabase timeout" }
    );

    const rollbackLog = logged.find(
      (entry) => typeof entry[0] === "string" && entry[0].includes("rollback failed")
    );
    assert.ok(rollbackLog, "should log rollback failure");
    assert.equal(rollbackLog[1].actionId, ACTION_ID);
  } finally {
    console.error = originalError;
  }
});

test("failed ai_messages insert is logged but returns 200", async () => {
  const logged: any[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => logged.push(args);

  try {
    const handler = createAiPendingActionConfirmHandler({
      ...buildBaseDeps({
        getAiOrgContext: async () =>
          ({
            ok: true,
            orgId: ORG_ID,
            userId: ADMIN_USER.id,
            role: "admin",
            supabase: null,
            serviceSupabase: {
              from(table: string) {
                if (table === "ai_messages") {
                  return {
                    insert() {
                      return Promise.resolve({ error: { message: "insert failed" } });
                    },
                  };
                }
                throw new Error(`unexpected table ${table}`);
              },
            },
          }) as any,
      }),
      getPendingAction: async () => buildPendingAction() as any,
      updatePendingActionStatus: async () => ({ updated: true }),
      createJobPosting: async () =>
        ({
          ok: true,
          status: 201,
          job: { id: "job-456", title: "Designer" },
        }) as any,
    });

    const response = await handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);

    const msgLog = logged.find(
      (entry) => typeof entry[0] === "string" && entry[0].includes("failed to insert confirmation")
    );
    assert.ok(msgLog, "should log message insert failure");
  } finally {
    console.error = originalError;
  }
});

test("cancel returns 409 when action is in confirmed (in-progress) state", async () => {
  const handler = createAiPendingActionCancelHandler({
    ...buildBaseDeps(),
    getPendingAction: async () =>
      buildPendingAction({ status: "confirmed" }) as any,
    updatePendingActionStatus: async () => ({ updated: true }),
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.reason, "in_progress");
});

test("unsupported action type rolls back confirmed claim", async () => {
  const updatedStatuses: any[] = [];
  const handler = createAiPendingActionConfirmHandler({
    ...buildBaseDeps(),
    getPendingAction: async () =>
      buildPendingAction({ action_type: "unsupported_action" }) as any,
    updatePendingActionStatus: async (_supabase: any, _actionId: any, payload: any) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
  });

  await assert.rejects(
    handler(buildRequest() as any, {
      params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
    }),
    { message: "Unsupported pending action type: unsupported_action" }
  );

  assert.equal(updatedStatuses[0].status, "confirmed");
  assert.equal(updatedStatuses[0].expectedStatus, "pending");
  assert.equal(updatedStatuses[1].status, "pending");
  assert.equal(updatedStatuses[1].expectedStatus, "confirmed");
});

test("cancel returns 410 for expired pending action without cancel message", async () => {
  const insertedMessages: any[] = [];
  const handler = createAiPendingActionCancelHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from() {
            return {
              insert(payload: Record<string, unknown>) {
                insertedMessages.push(payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        },
      }) as any,
    getPendingAction: async () =>
      buildPendingAction({ expires_at: "2000-01-01T00:00:00.000Z" }) as any,
    updatePendingActionStatus: async () => ({ updated: true }),
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 410);
  assert.equal(body.error, "Pending action has expired");
  assert.equal(insertedMessages.length, 0);
});

test("confirm executes create_enterprise_invite via RPC and posts invite code", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];
  const rpcCalls: any[] = [];

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
        rpc: async (name: string, params: unknown) => {
          rpcCalls.push({ name, params });
          return {
            data: { id: "invite-999", code: "XYZ123", role: "admin" },
            error: null,
          };
        },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: {
          from() {
            return {
              insert(payload: Record<string, unknown>) {
                insertedMessages.push(payload);
                return Promise.resolve({ error: null });
              },
            };
          },
        },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "create_enterprise_invite",
        payload: {
          enterpriseId: "ent-1",
          enterpriseSlug: "acme-ent",
          role: "admin",
          organizationId: null,
          organizationName: null,
          usesRemaining: null,
          expiresAt: null,
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.invite.id, "invite-999");
  assert.equal(rpcCalls[0].name, "create_enterprise_invite");
  assert.equal((rpcCalls[0].params as any).p_role, "admin");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.match(String(insertedMessages[0].content), /XYZ123/);
  assert.match(String(insertedMessages[0].content), /acme-ent\/invites/);
});

test("confirm executes revoke_enterprise_invite and posts revocation message", async () => {
  const insertedMessages: any[] = [];
  const updatedStatuses: any[] = [];
  const updatedInvites: any[] = [];

  const serviceFrom = (table: string) => {
    if (table === "ai_messages") {
      return {
        insert(payload: Record<string, unknown>) {
          insertedMessages.push(payload);
          return Promise.resolve({ error: null });
        },
      };
    }
    if (table === "enterprise_invites") {
      const builder: any = {
        update(update: Record<string, unknown>) {
          updatedInvites.push({ update });
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        select() {
          return Promise.resolve({ data: [{ id: "inv-1" }], error: null });
        },
      };
      return builder;
    }
    throw new Error(`unexpected table ${table}`);
  };

  const handler = createAiPendingActionConfirmHandler({
    createClient: async () =>
      ({
        auth: { getUser: async () => ({ data: { user: ADMIN_USER } }) },
      }) as any,
    getAiOrgContext: async () =>
      ({
        ok: true,
        orgId: ORG_ID,
        userId: ADMIN_USER.id,
        role: "admin",
        supabase: null,
        serviceSupabase: { from: serviceFrom },
      }) as any,
    getPendingAction: async () =>
      ({
        id: ACTION_ID,
        organization_id: ORG_ID,
        user_id: ADMIN_USER.id,
        thread_id: THREAD_ID,
        action_type: "revoke_enterprise_invite",
        payload: {
          enterpriseId: "ent-1",
          enterpriseSlug: "acme-ent",
          inviteId: "inv-1",
          inviteCode: "CODE1",
          role: "admin",
          organizationId: null,
        },
        status: "pending",
        expires_at: "2099-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        executed_at: null,
        result_entity_type: null,
        result_entity_id: null,
      }) as any,
    updatePendingActionStatus: async (_supabase, _actionId, payload) => {
      updatedStatuses.push(payload);
      return { updated: true };
    },
    clearDraftSession: async () => {},
  });

  const response = await handler(buildRequest() as any, {
    params: Promise.resolve({ orgId: ORG_ID, actionId: ACTION_ID }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(updatedInvites.length, 1);
  assert.ok(typeof updatedInvites[0].update.revoked_at === "string");
  assert.equal(updatedStatuses[1].status, "executed");
  assert.match(String(insertedMessages[0].content), /Revoked enterprise invite/);
  assert.match(String(insertedMessages[0].content), /CODE1/);
});

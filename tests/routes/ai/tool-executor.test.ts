/* eslint-disable @typescript-eslint/no-explicit-any */
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { getZaiImageModel } from "../../../src/lib/ai/client.ts";
import { executeToolCall } from "../../../src/lib/ai/tools/executor.ts";
import { getSuggestionObservabilityByOrg } from "../../../src/lib/falkordb/suggestions.ts";
import { resetFalkorTelemetryForTests } from "../../../src/lib/falkordb/telemetry.ts";
import {
  extractScheduleFromImage,
  extractScheduleFromText,
  setScheduleExtractionDepsForTests,
} from "../../../src/lib/ai/schedule-extraction.ts";
import type {
  ToolExecutionContext,
  ToolExecutionResult,
} from "../../../src/lib/ai/tools/executor.ts";
import { StageTimeoutError } from "../../../src/lib/ai/timeout.ts";

const ORG_ID = "org-uuid-1";
const USER_ID = "org-admin-user";
const SOURCE_ALUMNI_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

function makeMemberRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "member-1",
    organization_id: ORG_ID,
    user_id: "user-1",
    status: "active",
    deleted_at: null,
    first_name: "Louis",
    last_name: "Ciccone",
    email: "louis@example.com",
    role: "Captain",
    current_company: null as string | null,
    graduation_year: null as number | null,
    created_at: "2026-03-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeAlumniRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "alumni-1",
    organization_id: ORG_ID,
    user_id: "user-1",
    deleted_at: null,
    first_name: "Louis",
    last_name: "Ciccone",
    email: "louis@example.com",
    major: null as string | null,
    current_company: null as string | null,
    industry: null as string | null,
    current_city: null as string | null,
    graduation_year: null as number | null,
    position_title: null as string | null,
    job_title: null as string | null,
    created_at: "2026-03-03T00:00:00.000Z",
    ...overrides,
  };
}

function createToolSupabaseStub(overrides: Record<string, any> = {}) {
  const queries: Array<{
    table: string;
    filters: any[];
    method: string;
    columns?: string;
    orderBy?: { column: string; ascending: boolean };
    limitValue?: number;
  }> = [];
  const storageDownloads: Array<{ bucket: string; path: string }> = [];
  const storageRemovals: Array<{ bucket: string; paths: string[] }> = [];

  function applyFilters(rows: any[], filters: any[]) {
    return rows.filter((row) =>
      filters.every((filter) => {
        if (!Object.prototype.hasOwnProperty.call(row, filter.col) && filter.val == null) {
          return true;
        }
        if (filter.op === "in") {
          return Array.isArray(filter.val) && filter.val.includes(row[filter.col]);
        }
        if (filter.op === "gte") {
          return row[filter.col] >= filter.val;
        }
        if (filter.op === "lt") {
          return row[filter.col] < filter.val;
        }
        if (filter.val == null) {
          return row[filter.col] == null;
        }
        return row[filter.col] === filter.val;
      })
    );
  }

  function from(table: string) {
    const entry = {
      table,
      filters: [] as any[],
      method: "select",
      columns: undefined as string | undefined,
      orderBy: undefined as { column: string; ascending: boolean } | undefined,
      limitValue: undefined as number | undefined,
    };
    queries.push(entry);

    const builder: Record<string, any> = {
      insert(row: any) {
        void row;
        entry.method = "insert";
        return builder;
      },
      select(columns: string, opts?: any) {
        entry.method = opts?.head ? "count" : "select";
        entry.columns = columns;
        return builder;
      },
      eq(col: string, val: unknown) {
        entry.filters.push({ col, val });
        return builder;
      },
      is(col: string, val: unknown) {
        entry.filters.push({ col, val });
        return builder;
      },
      in(col: string, val: unknown[]) {
        entry.filters.push({ col, op: "in", val });
        return builder;
      },
      gte(col: string, val: unknown) {
        entry.filters.push({ col, op: "gte", val });
        return builder;
      },
      lt(col: string, val: unknown) {
        entry.filters.push({ col, op: "lt", val });
        return builder;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        entry.orderBy = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      limit(value: number) {
        entry.limitValue = value;
        return builder;
      },
      maybeSingle() {
        if (overrides[table]?.maybeSingle) {
          return Promise.resolve(overrides[table].maybeSingle);
        }

        const selectData = overrides[table]?.select?.data;
        if (Array.isArray(selectData)) {
          const filtered = applyFilters(selectData, entry.filters);
          return Promise.resolve({ data: filtered[0] ?? null, error: null });
        }

        return Promise.resolve(
          table === "user_organization_roles"
            ? { data: { role: "admin", status: "active" }, error: null }
            : { data: null, error: null }
        );
      },
      single() {
        return Promise.resolve(overrides[table]?.single ?? { data: null, error: null });
      },
    };

    builder.then = (onFulfilled: any, onRejected?: any) => {
      const result = overrides[table]?.select ?? { data: [], error: null, count: 0 };
      if (Array.isArray(result.data)) {
        const filtered = applyFilters(result.data, entry.filters);
        const limited =
          typeof entry.limitValue === "number" ? filtered.slice(0, entry.limitValue) : filtered;
        return Promise.resolve({ ...result, data: limited }).then(onFulfilled, onRejected);
      }
      return Promise.resolve(result).then(onFulfilled, onRejected);
    };

    return builder;
  }

  const rpc = async (name: string, params: Record<string, unknown> = {}) => {
    const handlers = overrides.rpc ?? {};
    const handler = handlers[name];
    if (!handler) {
      return { data: null, error: { message: `missing rpc ${name}` } };
    }

    if (typeof handler === "function") {
      try {
        return { data: await handler(params), error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { data: null, error: { message } };
      }
    }

    return { data: handler, error: null };
  };

  const storage = {
    from(bucket: string) {
      return {
        async download(path: string) {
          storageDownloads.push({ bucket, path });

          const handler = overrides.storage?.download;
          if (typeof handler === "function") {
            return handler({ bucket, path });
          }

          if (handler) {
            return handler;
          }

          return { data: null, error: { message: "missing storage download handler" } };
        },
        async remove(paths: string[]) {
          storageRemovals.push({ bucket, paths });

          const handler = overrides.storage?.remove;
          if (typeof handler === "function") {
            return handler({ bucket, paths });
          }

          if (handler) {
            return handler;
          }

          return { data: [], error: null };
        },
        async createSignedUrl(path: string, expiresIn: number) {
          const handler = overrides.storage?.createSignedUrl;
          if (typeof handler === "function") {
            return handler({ bucket, path, expiresIn });
          }

          if (handler) {
            return handler;
          }

          return { data: { signedUrl: `https://example.com/${path}` }, error: null };
        },
      };
    },
  };

  return { from, rpc, queries, storage, storageDownloads, storageRemovals };
}

function expectOk(result: ToolExecutionResult): Extract<ToolExecutionResult, { kind: "ok" }> {
  assert.equal(result.kind, "ok");
  return result as Extract<ToolExecutionResult, { kind: "ok" }>;
}

function makeCtx(
  serviceSupabase: any,
  authorization: ToolExecutionContext["authorization"] = {
    kind: "verify_membership",
  }
): ToolExecutionContext {
  return {
    orgId: ORG_ID,
    userId: USER_ID,
    serviceSupabase,
    authorization,
  };
}

let ctx: ToolExecutionContext;
let stub: ReturnType<typeof createToolSupabaseStub>;

beforeEach(() => {
  resetFalkorTelemetryForTests();
  setScheduleExtractionDepsForTests(null);
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m1",
          organization_id: ORG_ID,
          user_id: "u1",
          status: "active",
          role: "admin",
          created_at: "2026-03-20T12:00:00Z",
          first_name: "Alice",
          last_name: "Jones",
          email: "a@b.com",
          deleted_at: null,
        }],
        error: null,
      },
    },
    users: {
      select: {
        data: [{ id: "u1", name: "Alice Jones" }],
        error: null,
      },
    },
    events: {
      select: {
        data: [{ id: "e1", title: "Spring Gala", start_date: "2026-04-01" }],
        error: null,
      },
    },
    announcements: {
      select: {
        data: [
          {
            id: "a1",
            organization_id: ORG_ID,
            title: "Welcome back",
            body: "Practice starts Monday in the main gym.",
            audience: "all",
            is_pinned: true,
            published_at: "2026-03-20T12:00:00Z",
            created_at: "2026-03-20T12:00:00Z",
          },
        ],
        error: null,
      },
    },
    organizations: {
      maybeSingle: {
        data: { slug: "acme", nav_config: null },
        error: null,
      },
    },
  });
  ctx = makeCtx(stub as any);
});

test("schedule extraction uses separate Z.AI models for text and image sources", async () => {
  const completionCalls: Array<{ model: string; messages: unknown[] }> = [];
  const fakeClient = {
    chat: {
      completions: {
        create: async (params: { model: string; messages: unknown[] }) => {
          completionCalls.push(params);
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    events: [],
                    source_summary: "No events found.",
                    confidence: "low",
                  }),
                },
              },
            ],
          };
        },
      },
    },
  } as any;

  setScheduleExtractionDepsForTests({
    createClient: () => fakeClient,
    getTextModel: () => "glm-5.1",
    getImageModel: () => "glm-5v-turbo",
  });

  await extractScheduleFromText("Varsity match schedule", {
    sourceType: "pdf",
    sourceLabel: "schedule.pdf",
    now: "2026-04-03T12:00:00.000Z",
  });
  await extractScheduleFromImage(
    {
      url: "https://example.com/schedule.png",
      mimeType: "image/png",
    },
    {
      sourceLabel: "schedule.png",
      now: "2026-04-03T12:00:00.000Z",
    }
  );

  assert.equal(completionCalls[0]?.model, "glm-5.1");
  assert.equal(completionCalls[1]?.model, "glm-5v-turbo");
  assert.match(JSON.stringify(completionCalls[1]?.messages), /image_url/);
});

test("schedule image extraction preserves readable partial rows for follow-up validation", async () => {
  setScheduleExtractionDepsForTests({
    createClient: () =>
      ({
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      events: [
                        {
                          title: "Acme vs Central",
                          start_date: "2026-04-10",
                        },
                      ],
                      candidate_rows: [
                        {
                          raw_text: "Acme vs Central, Friday 4/10, 6:30 PM, Main Gym",
                          title: "Acme vs Central",
                          start_date: "2026-04-10",
                        },
                      ],
                      source_summary: "One readable row is missing a time.",
                      confidence: "medium",
                    }),
                  },
                },
              ],
            }),
          },
        },
      }) as any,
  });

  const extracted = await extractScheduleFromImage(
    {
      url: "https://example.com/schedule.png",
      mimeType: "image/png",
    },
    {
      sourceLabel: "schedule.png",
      now: "2026-04-03T12:00:00.000Z",
    }
  );

  assert.deepEqual(extracted.events, []);
  assert.deepEqual(extracted.rejected_rows, [
    {
      index: 0,
      missing_fields: ["start_time"],
      draft: {
        raw_text: "Acme vs Central, Friday 4/10, 6:30 PM, Main Gym",
        title: "Acme vs Central",
        start_date: "2026-04-10",
      },
    },
  ]);
});

test("extractScheduleFromText parses Fordham-style PDF rows before calling the model", async () => {
  const completionCalls: Array<{ messages: unknown[] }> = [];

  setScheduleExtractionDepsForTests({
    createClient: () =>
      ({
        chat: {
          completions: {
            create: async (params: { messages: unknown[] }) => {
              completionCalls.push(params);
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        events: [],
                        source_summary: "No events found.",
                        confidence: "low",
                      }),
                    },
                  },
                ],
              };
            },
          },
        },
      }) as any,
  });

  const extracted = await extractScheduleFromText(
    [
      "F O R D H A M   P R E P A R A T O R Y   S C H O O L",
      "F O R D H A M   P R E P A R A T O R Y   S C H O O L",
      "A D M I S S I O N S",
      "A L U M N I",
      "Program Coaches Schedule",
      "Team Opponent Date Time Location Result Score",
      "Baseball - Varsity Baseball - Varsity Baseball - Varsity Baseball - Varsity vs. James Monroe HS Mar 23 2026 4:15 PM Moglia Stadium @ Coffey Field",
      "Baseball - Varsity Baseball - Varsity Baseball - Varsity Baseball - Varsity vs. James Monroe HS Mar 23 2026 4:15 PM Moglia Stadium @ Coffey Field",
      "Baseball - Freshman vs. Xavier High School Mar 28 2026 12:30 PM",
      "Van Nest Field Result W 8-2",
      "Baseball - Varsity vs. Xavier HS Apr 2 2026 11:00 AM",
      "MCU Park",
    ].join("\n"),
    {
      sourceType: "pdf",
      sourceLabel: "fordham-baseball.pdf",
      now: "2026-04-03T12:00:00.000Z",
    }
  );

  assert.equal(completionCalls.length, 0);
  assert.deepEqual(extracted.events, [
    {
      title: "Baseball - Varsity vs. James Monroe HS",
      start_date: "2026-03-23",
      start_time: "16:15",
      location: "Moglia Stadium @ Coffey Field",
      event_type: "game",
    },
    {
      title: "Baseball - Freshman vs. Xavier High School",
      start_date: "2026-03-28",
      start_time: "12:30",
      location: "Van Nest Field",
      description: "Result W 8-2",
      event_type: "game",
    },
    {
      title: "Baseball - Varsity vs. Xavier HS",
      start_date: "2026-04-02",
      start_time: "11:00",
      location: "MCU Park",
      event_type: "game",
    },
  ]);
  assert.deepEqual(extracted.rejected_rows, []);
});

test("extractScheduleFromText returns parser candidate rows for partial PDF schedule lines without calling the model", async () => {
  const completionCalls: Array<{ messages: unknown[] }> = [];

  setScheduleExtractionDepsForTests({
    createClient: () =>
      ({
        chat: {
          completions: {
            create: async (params: { messages: unknown[] }) => {
              completionCalls.push(params);
              return {
                choices: [
                  {
                    message: {
                      content: JSON.stringify({
                        events: [],
                        source_summary: "No events found.",
                        confidence: "low",
                      }),
                    },
                  },
                ],
              };
            },
          },
        },
      }) as any,
  });

  const extracted = await extractScheduleFromText(
    [
      "Team Opponent Date Time Location Result Score",
      "Baseball - Varsity vs. Xavier HS Apr 2 2026",
      "MCU Park",
    ].join("\n"),
    {
      sourceType: "pdf",
      sourceLabel: "fordham-partial.pdf",
      now: "2026-04-03T12:00:00.000Z",
    }
  );

  assert.equal(completionCalls.length, 0);
  assert.deepEqual(extracted.events, []);
  assert.deepEqual(extracted.rejected_rows, [
    {
      index: 0,
      missing_fields: ["start_time"],
      draft: {
        raw_text: "Baseball - Varsity vs. Xavier HS Apr 2 2026 MCU Park",
        title: "Baseball - Varsity vs. Xavier HS",
        start_date: "2026-04-02",
        location: "MCU Park",
        event_type: "game",
      },
    },
  ]);
});

test("getZaiImageModel rejects token-like configuration values", () => {
  const previous = process.env.ZAI_IMAGE_MODEL;
  process.env.ZAI_IMAGE_MODEL = "7f7732de249c4bc1a2a434bf7014818b.NDlA78k4ON44EGQQ";

  try {
    assert.throws(
      () => getZaiImageModel(),
      /Invalid ZAI_IMAGE_MODEL value .*Expected a Z\.AI vision model such as glm-5v-turbo/i
    );
  } finally {
    if (previous === undefined) {
      delete process.env.ZAI_IMAGE_MODEL;
    } else {
      process.env.ZAI_IMAGE_MODEL = previous;
    }
  }
});

test("list_members returns org-scoped members", async () => {
  const result = expectOk(await executeToolCall(ctx, { name: "list_members", args: {} }));

  assert.ok(Array.isArray(result.data));
  assert.equal((result.data as any[]).length, 1);
  assert.deepEqual((result.data as any[])[0], {
    id: "m1",
    user_id: "u1",
    status: "active",
    role: "admin",
    created_at: "2026-03-20T12:00:00Z",
    name: "Alice Jones",
    email: "a@b.com",
  });

  const authQuery = stub.queries.find((q) => q.table === "user_organization_roles");
  assert.ok(authQuery);
  assert.ok(authQuery.filters.some((f: any) => f.col === "user_id" && f.val === USER_ID));
  assert.ok(authQuery.filters.some((f: any) => f.col === "organization_id" && f.val === ORG_ID));

  const memberQuery = stub.queries.find((q) => q.table === "members");
  assert.ok(memberQuery);
  assert.equal(memberQuery.columns, "id, user_id, status, role, created_at, first_name, last_name, email");
  assert.ok(memberQuery.filters.some((f: any) => f.col === "organization_id" && f.val === ORG_ID));
  assert.ok(memberQuery.filters.some((f: any) => f.col === "deleted_at" && f.val === null));
  assert.ok(memberQuery.filters.some((f: any) => f.col === "status" && f.val === "active"));
  assert.deepEqual(memberQuery.orderBy, { column: "created_at", ascending: false });
  assert.equal(memberQuery.limitValue, 20);
});

test("list_members trims whitespace when composing a normalized name", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m2",
          organization_id: ORG_ID,
          user_id: null,
          status: "active",
          role: null,
          created_at: "2026-03-19T12:00:00Z",
          first_name: "Alice",
          last_name: "",
          email: null,
          deleted_at: null,
        }],
        error: null,
      },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(await executeToolCall(ctx, { name: "list_members", args: {} }));
  assert.equal((result.data as any[])[0].name, "Alice");
});

test("list_members falls back to public.users.name for placeholder member names", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [{
          id: "m3",
          organization_id: ORG_ID,
          user_id: "u3",
          status: "active",
          role: "admin",
          created_at: "2026-03-18T12:00:00Z",
          first_name: "Member",
          last_name: "",
          email: "placeholder@example.com",
          deleted_at: null,
        }],
        error: null,
      },
    },
    users: {
      select: {
        data: [{ id: "u3", name: "Seann Farrell" }],
        error: null,
      },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(await executeToolCall(ctx, { name: "list_members", args: {} }));
  assert.equal((result.data as any[])[0].name, "Seann Farrell");
});

test("list_events returns past events", async () => {
  const result = expectOk(
    await executeToolCall(ctx, { name: "list_events", args: { upcoming: false } })
  );
  assert.ok(Array.isArray(result.data));

  const eventQuery = stub.queries.find((q) => q.table === "events");
  assert.ok(eventQuery);
  assert.ok(eventQuery.filters.some((f: any) => f.col === "start_date" && f.op === "lt"));
});

test("get_org_stats returns counts object", async () => {
  stub = createToolSupabaseStub({
    members: { select: { data: [], error: null, count: 42 } },
    alumni: { select: { data: [], error: null, count: 10 } },
    parents: { select: { data: [], error: null, count: 5 } },
    events: { select: { data: [], error: null, count: 3 } },
    organization_donation_stats: {
      maybeSingle: { data: { total_amount_cents: 50000, donation_count: 12 }, error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(await executeToolCall(ctx, { name: "get_org_stats", args: {} }));
  const stats = result.data as any;
  assert.equal(stats.active_members, 42);
  assert.equal(stats.alumni, 10);
  assert.equal(stats.parents, 5);
  assert.equal(stats.upcoming_events, 3);
});

test("list_announcements returns recent announcements", async () => {
  const result = expectOk(await executeToolCall(ctx, { name: "list_announcements", args: {} }));

  assert.ok(Array.isArray(result.data));
  assert.deepEqual((result.data as any[])[0], {
    id: "a1",
    title: "Welcome back",
    audience: "all",
    is_pinned: true,
    published_at: "2026-03-20T12:00:00Z",
    body_preview: "Practice starts Monday in the main gym.",
  });

  const announcementQuery = stub.queries.find((q) => q.table === "announcements");
  assert.ok(announcementQuery);
  assert.equal(
    announcementQuery.columns,
    "id, title, body, audience, is_pinned, published_at, created_at"
  );
  assert.ok(
    announcementQuery.filters.some((f: any) => f.col === "organization_id" && f.val === ORG_ID)
  );
  assert.ok(
    announcementQuery.filters.some((f: any) => f.col === "deleted_at" && f.val === null)
  );
  assert.deepEqual(announcementQuery.orderBy, { column: "published_at", ascending: false });
  assert.equal(announcementQuery.limitValue, 10);
});

test("prepare_discussion_thread returns missing_fields for incomplete drafts", async () => {
  const discussionCtx = { ...ctx, threadId: "thread-123" };

  const result = expectOk(
    await executeToolCall(discussionCtx, {
      name: "prepare_discussion_thread",
      args: { title: "Spring Fundraising Volunteers" },
    })
  );

  assert.deepEqual(result.data, {
    state: "missing_fields",
    missing_fields: ["body"],
    draft: {
      title: "Spring Fundraising Volunteers",
      mediaIds: [],
    },
  });
});

test("prepare_announcement returns missing_fields for incomplete drafts", async () => {
  const announcementCtx = { ...ctx, threadId: "thread-announce" };

  const result = expectOk(
    await executeToolCall(announcementCtx, {
      name: "prepare_announcement",
      args: { audience: "all" },
    })
  );

  assert.deepEqual(result.data, {
    state: "missing_fields",
    missing_fields: ["title"],
    draft: {
      audience: "all",
      is_pinned: false,
      send_notification: false,
    },
  });
});

test("prepare_announcement creates a pending confirmation action when complete", async () => {
  const announcementStub = createToolSupabaseStub({
    organizations: {
      maybeSingle: { data: { slug: "upenn-sprint-football" }, error: null },
    },
    ai_pending_actions: {
      single: {
        data: {
          id: "pending-announcement-123",
          organization_id: ORG_ID,
          user_id: USER_ID,
          thread_id: "thread-announce",
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
        },
        error: null,
      },
    },
  });

  const announcementCtx = { ...makeCtx(announcementStub as any), threadId: "thread-announce" };

  const result = expectOk(
    await executeToolCall(announcementCtx, {
      name: "prepare_announcement",
      args: {
        title: "Practice moved indoors",
        body: "Meet in Weight Room B at 6pm.",
        audience: "all",
        is_pinned: true,
        send_notification: true,
      },
    })
  );

  assert.deepEqual(result.data, {
    state: "needs_confirmation",
    draft: {
      title: "Practice moved indoors",
      body: "Meet in Weight Room B at 6pm.",
      audience: "all",
      is_pinned: true,
      send_notification: true,
    },
    pending_action: {
      id: "pending-announcement-123",
      action_type: "create_announcement",
      payload: {
        title: "Practice moved indoors",
        body: "Meet in Weight Room B at 6pm.",
        audience: "all",
        is_pinned: true,
        send_notification: true,
        orgSlug: "upenn-sprint-football",
      },
      expires_at: "2099-01-01T00:00:00.000Z",
      summary: {
        title: "Review announcement",
        description: "Confirm the drafted announcement before it is published.",
      },
    },
  });
});

test("prepare_discussion_thread creates a pending confirmation action when complete", async () => {
  const discussionStub = createToolSupabaseStub({
    organizations: {
      maybeSingle: { data: { slug: "upenn-sprint-football" }, error: null },
    },
    ai_pending_actions: {
      single: {
        data: {
          id: "pending-123",
          organization_id: ORG_ID,
          user_id: USER_ID,
          thread_id: "thread-123",
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
        },
        error: null,
      },
    },
  });

  const discussionCtx = { ...makeCtx(discussionStub as any), threadId: "thread-123" };

  const result = expectOk(
    await executeToolCall(discussionCtx, {
      name: "prepare_discussion_thread",
      args: {
        title: "Spring Fundraising Volunteers",
        body: "Let's organize volunteer assignments for the spring fundraiser.",
        mediaIds: ["11111111-1111-4111-8111-111111111111"],
      },
    })
  );

  assert.deepEqual(result.data, {
    state: "needs_confirmation",
    draft: {
      title: "Spring Fundraising Volunteers",
      body: "Let's organize volunteer assignments for the spring fundraiser.",
      mediaIds: ["11111111-1111-4111-8111-111111111111"],
    },
    pending_action: {
      id: "pending-123",
      action_type: "create_discussion_thread",
      payload: {
        title: "Spring Fundraising Volunteers",
        body: "Let's organize volunteer assignments for the spring fundraiser.",
        mediaIds: ["11111111-1111-4111-8111-111111111111"],
        orgSlug: "upenn-sprint-football",
      },
      expires_at: "2099-01-01T00:00:00.000Z",
      summary: {
        title: "Review discussion thread",
        description: "Confirm the drafted thread before it is posted to discussions.",
      },
    },
  });
});

test("prepare_discussion_reply returns missing_fields without thread target or body", async () => {
  const replyCtx = { ...ctx, threadId: "assistant-thread-123" };

  const result = expectOk(
    await executeToolCall(replyCtx, {
      name: "prepare_discussion_reply",
      args: {},
    })
  );

  assert.deepEqual(result.data, {
    state: "missing_fields",
    missing_fields: ["discussion_thread_id", "body"],
    draft: {},
  });
});

test("prepare_discussion_reply creates a pending confirmation action when complete", async () => {
  const discussionThreadId = "33333333-3333-4333-8333-333333333333";
  const replyStub = createToolSupabaseStub({
    organizations: {
      maybeSingle: { data: { slug: "upenn-sprint-football" }, error: null },
    },
    ai_pending_actions: {
      single: {
        data: {
          id: "pending-reply-123",
          organization_id: ORG_ID,
          user_id: USER_ID,
          thread_id: "assistant-thread-123",
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
        },
        error: null,
      },
    },
  });

  const replyCtx = { ...makeCtx(replyStub as any), threadId: "assistant-thread-123" };

  const result = expectOk(
    await executeToolCall(replyCtx, {
      name: "prepare_discussion_reply",
      args: {
        discussion_thread_id: discussionThreadId,
        thread_title: "Spring Fundraising Volunteers",
        body: "I can cover the alumni outreach shift.",
      },
    })
  );

  assert.deepEqual(result.data, {
    state: "needs_confirmation",
    draft: {
      discussion_thread_id: discussionThreadId,
      thread_title: "Spring Fundraising Volunteers",
      body: "I can cover the alumni outreach shift.",
    },
    pending_action: {
      id: "pending-reply-123",
      action_type: "create_discussion_reply",
      payload: {
        discussion_thread_id: discussionThreadId,
        thread_title: "Spring Fundraising Volunteers",
        body: "I can cover the alumni outreach shift.",
        orgSlug: "upenn-sprint-football",
      },
      expires_at: "2099-01-01T00:00:00.000Z",
      summary: {
        title: "Review discussion reply",
        description: "Confirm the drafted reply before it is posted to the discussion thread.",
      },
    },
  });
});

test("prepare_chat_message returns missing_fields when the body is missing", async () => {
  const recipientMemberId = "11111111-1111-4111-8111-111111111111";
  const chatStub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          {
            id: recipientMemberId,
            organization_id: ORG_ID,
            user_id: "22222222-2222-4222-8222-222222222222",
            status: "active",
            deleted_at: null,
            first_name: "Jason",
            last_name: "Leonard",
            email: "jason@example.com",
          },
        ],
        error: null,
      },
    },
  });
  const chatCtx = { ...makeCtx(chatStub as any), threadId: "assistant-thread-chat" };

  const result = expectOk(
    await executeToolCall(chatCtx, {
      name: "prepare_chat_message",
      args: {
        person_query: "Jason Leonard",
      },
    })
  );

  assert.deepEqual(result.data, {
    state: "missing_fields",
    missing_fields: ["body"],
    draft: {
      person_query: "Jason Leonard",
      recipient_member_id: recipientMemberId,
    },
  });
});

test("prepare_chat_message creates a pending confirmation action when complete", async () => {
  const recipientMemberId = "11111111-1111-4111-8111-111111111111";
  const recipientUserId = "22222222-2222-4222-8222-222222222222";
  const existingChatGroupId = "33333333-3333-4333-8333-333333333333";
  const chatStub = createToolSupabaseStub({
    organizations: {
      maybeSingle: { data: { slug: "upenn-sprint-football" }, error: null },
    },
    members: {
      select: {
        data: [
          {
            id: recipientMemberId,
            organization_id: ORG_ID,
            user_id: recipientUserId,
            status: "active",
            deleted_at: null,
            first_name: "Jason",
            last_name: "Leonard",
            email: "jason@example.com",
          },
        ],
        error: null,
      },
    },
    chat_group_members: {
      select: {
        data: [
          {
            chat_group_id: existingChatGroupId,
            organization_id: ORG_ID,
            user_id: USER_ID,
            removed_at: null,
          },
          {
            chat_group_id: existingChatGroupId,
            organization_id: ORG_ID,
            user_id: recipientUserId,
            removed_at: null,
          },
        ],
        error: null,
      },
    },
    chat_groups: {
      select: {
        data: [
          {
            id: existingChatGroupId,
            organization_id: ORG_ID,
            deleted_at: null,
            updated_at: "2026-04-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
    },
    ai_pending_actions: {
      single: {
        data: {
          id: "pending-chat-123",
          organization_id: ORG_ID,
          user_id: USER_ID,
          thread_id: "assistant-thread-chat",
          action_type: "send_chat_message",
          payload: {
            recipient_member_id: recipientMemberId,
            recipient_user_id: recipientUserId,
            recipient_display_name: "Jason Leonard",
            existing_chat_group_id: existingChatGroupId,
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
        },
        error: null,
      },
    },
  });

  const chatCtx = { ...makeCtx(chatStub as any), threadId: "assistant-thread-chat" };

  const result = expectOk(
    await executeToolCall(chatCtx, {
      name: "prepare_chat_message",
      args: {
        person_query: "Jason Leonard",
        body: "Can you join the alumni panel next Thursday?",
      },
    })
  );

  assert.deepEqual(result.data, {
    state: "needs_confirmation",
    draft: {
      person_query: "Jason Leonard",
      recipient_member_id: recipientMemberId,
      body: "Can you join the alumni panel next Thursday?",
    },
    pending_action: {
      id: "pending-chat-123",
      action_type: "send_chat_message",
      payload: {
        recipient_member_id: recipientMemberId,
        recipient_user_id: recipientUserId,
        recipient_display_name: "Jason Leonard",
        existing_chat_group_id: existingChatGroupId,
        body: "Can you join the alumni panel next Thursday?",
        orgSlug: "upenn-sprint-football",
      },
      expires_at: "2099-01-01T00:00:00.000Z",
      summary: {
        title: "Review chat message",
        description: "Confirm the drafted chat message before it is sent.",
      },
    },
  });
});

test("prepare_discussion_thread fails closed when organization slug lookup errors", async () => {
  const discussionStub = createToolSupabaseStub({
    organizations: {
      maybeSingle: {
        data: null,
        error: { message: "organization lookup failed" },
      },
    },
  });

  const result = await executeToolCall(
    { ...makeCtx(discussionStub as any), threadId: "thread-123" },
    {
      name: "prepare_discussion_thread",
      args: {
        title: "Spring Fundraising Volunteers",
        body: "Let's organize volunteer assignments for the spring fundraiser.",
      },
    }
  );

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Failed to load organization context",
  });
});

test("prepare_announcement fails closed when organization slug lookup errors", async () => {
  const announcementStub = createToolSupabaseStub({
    organizations: {
      maybeSingle: {
        data: null,
        error: { message: "organization lookup failed" },
      },
    },
  });

  const result = await executeToolCall(
    { ...makeCtx(announcementStub as any), threadId: "thread-announce" },
    {
      name: "prepare_announcement",
      args: {
        title: "Practice moved indoors",
        audience: "all",
      },
    }
  );

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Failed to load organization context",
  });
});

test("prepare_job_posting fails closed when organization slug lookup errors", async () => {
  const jobStub = createToolSupabaseStub({
    organizations: {
      maybeSingle: {
        data: null,
        error: { message: "organization lookup failed" },
      },
    },
  });

  const result = await executeToolCall(
    { ...makeCtx(jobStub as any), threadId: "thread-456" },
    {
      name: "prepare_job_posting",
      args: {
        title: "Senior Product Designer",
        company: "Acme Corp",
        location: "San Francisco, CA",
        industry: "SaaS",
        experience_level: "senior",
        description: "Lead product design across our platform.",
        contact_email: "jobs@example.com",
      },
    }
  );

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Failed to load organization context",
  });
});

test("find_navigation_targets returns org-scoped page matches", async () => {
  const result = expectOk(
    await executeToolCall(ctx, {
      name: "find_navigation_targets",
      args: { query: "create announcement" },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "resolved");
  assert.equal(payload.query, "create announcement");
  assert.equal(payload.matches[0].label, "New Announcement");
  assert.equal(payload.matches[0].href, "/acme/announcements/new");
});

test("suggest_connections returns ranked SQL fallback suggestions", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [],
        error: null,
      },
    },
    alumni: {
      select: {
        data: [
          {
            id: SOURCE_ALUMNI_ID,
            organization_id: ORG_ID,
            user_id: "00000000-0000-4000-8000-000000000001",
            deleted_at: null,
            first_name: "Alex",
            last_name: "Source",
            email: "alex@example.com",
            major: "Computer Science",
            current_company: "Acme",
            industry: "Technology",
            current_city: "Austin",
            graduation_year: 2018,
            position_title: "Engineer",
            job_title: null,
            created_at: "2026-03-01T00:00:00.000Z",
          },
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
            organization_id: ORG_ID,
            user_id: "00000000-0000-4000-8000-000000000002",
            deleted_at: null,
            first_name: "Dina",
            last_name: "Direct",
            email: "dina@example.com",
            major: null,
            current_company: "Acme",
            industry: null,
            current_city: null,
            graduation_year: 2018,
            position_title: "VP Product",
            job_title: null,
            created_at: "2026-03-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
      maybeSingle: {
        data: {
          id: SOURCE_ALUMNI_ID,
          organization_id: ORG_ID,
          user_id: "00000000-0000-4000-8000-000000000001",
          deleted_at: null,
          first_name: "Alex",
          last_name: "Source",
          email: "alex@example.com",
          major: "Computer Science",
          current_company: "Acme",
          industry: "Technology",
          current_city: "Austin",
          graduation_year: 2018,
          position_title: "Engineer",
          job_title: null,
          created_at: "2026-03-01T00:00:00.000Z",
        },
        error: null,
      },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_type: "alumni",
        person_id: SOURCE_ALUMNI_ID,
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.mode, "sql_fallback");
  assert.equal(payload.fallback_reason, "disabled");
  assert.equal(payload.freshness.state, "unknown");
  assert.equal(payload.state, "resolved");
  assert.equal(payload.source_person.name, "Alex Source");
  assert.equal(payload.suggestions.length, 1);
  assert.equal(payload.suggestions[0].name, "Dina Direct");
  assert.equal(payload.suggestions[0].score, 18);
  assert.deepEqual(
    payload.suggestions[0].reasons.map((reason: any) => reason.code),
    ["shared_company", "graduation_proximity"]
  );
  assert.deepEqual(
    payload.suggestions[0].reasons.map((reason: any) => reason.label),
    ["shared company", "graduation proximity"]
  );

  const telemetry = getSuggestionObservabilityByOrg(ORG_ID);
  assert.equal(telemetry.sqlFallbackCount, 1);
  assert.equal(telemetry.fallbackReasonCounts.disabled, 1);
  assert.equal(telemetry.strongResultCount, 1);
  assert.equal(telemetry.lastResultStrength, "strong");
});

test("suggest_connections suppresses TeamNetwork and org-name company matches", async () => {
  stub = createToolSupabaseStub({
    organizations: {
      select: {
        data: [{ id: ORG_ID, name: "Test Organization" }],
        error: null,
      },
    },
    members: {
      select: {
        data: [
          makeMemberRow({ current_company: "TeamNetwork", graduation_year: 2024 }),
          makeMemberRow({
            id: "member-2", user_id: "user-2",
            first_name: "Dana", last_name: "Coach", email: "dana@example.com",
            role: "Coach", current_company: "TeamNetwork", graduation_year: 2025,
            created_at: "2026-03-02T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
    alumni: {
      select: {
        data: [
          makeAlumniRow({
            current_company: "TeamNetwork", industry: "Sports",
            current_city: "Philadelphia", graduation_year: 2024,
          }),
          makeAlumniRow({
            id: "alumni-2", user_id: "user-2",
            first_name: "Dana", last_name: "Coach", email: "dana@example.com",
            current_company: "Test Organization", industry: "Sports",
            current_city: "Philadelphia", graduation_year: 2025,
            position_title: "Advisor",
            created_at: "2026-03-04T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: { person_query: "Louis Ciccone" },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "resolved");
  assert.deepEqual(
    payload.suggestions[0].reasons.map((reason: any) => reason.code),
    ["shared_industry", "shared_role_family", "shared_city", "graduation_proximity"]
  );
});

test("suggest_connections resolves a person_query directly", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          makeMemberRow({ current_company: "Acme", graduation_year: 2024 }),
          makeMemberRow({
            id: "member-2", user_id: "user-2",
            first_name: "Dana", last_name: "Coach", email: "dana@example.com",
            role: "Coach", current_company: "Acme", graduation_year: 2024,
            created_at: "2026-03-02T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
    alumni: {
      select: { data: [], error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Louis Ciccone",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "resolved");
  assert.equal(payload.source_person.name, "Louis Ciccone");
  assert.equal(payload.suggestions[0].name, "Dana Coach");
});

test("suggest_connections resolves Matt-family aliases to the same source person", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          makeMemberRow({
            id: "member-matt",
            user_id: "user-matt",
            first_name: "Matt",
            last_name: "Leonard",
            email: "matt@example.com",
            current_company: "Acme",
            graduation_year: 2024,
          }),
          makeMemberRow({
            id: "member-dana",
            user_id: "user-dana",
            first_name: "Dana",
            last_name: "Coach",
            email: "dana@example.com",
            role: "Coach",
            current_company: "Acme",
            graduation_year: 2024,
            created_at: "2026-03-02T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
    alumni: {
      select: { data: [], error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const [matthewResult, shorthandResult] = await Promise.all([
    executeToolCall(ctx, {
      name: "suggest_connections",
      args: { person_query: "Matthew Leonard" },
    }),
    executeToolCall(ctx, {
      name: "suggest_connections",
      args: { person_query: "mat leo" },
    }),
  ]);

  const matthewPayload = expectOk(matthewResult).data as any;
  const shorthandPayload = expectOk(shorthandResult).data as any;

  assert.equal(matthewPayload.state, "resolved");
  assert.equal(matthewPayload.source_person.name, "Matt Leonard");
  assert.equal(shorthandPayload.state, "resolved");
  assert.equal(shorthandPayload.source_person.name, "Matt Leonard");
});

test("suggest_connections returns ambiguous state for matching person_query", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          makeMemberRow({ user_id: null, email: "louis.one@example.com", graduation_year: 2024 }),
          makeMemberRow({
            id: "member-2", user_id: null,
            email: "louis.two@example.com", role: "Manager",
            graduation_year: 2025,
            created_at: "2026-03-02T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
    alumni: {
      select: { data: [], error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Louis Ciccone",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "ambiguous");
  assert.equal(payload.suggestions.length, 0);
  assert.equal(payload.disambiguation_options.length, 2);
});

test("suggest_connections returns ambiguous state for close fuzzy Matt-family matches", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          makeMemberRow({
            id: "member-matt",
            user_id: "user-matt",
            first_name: "Matt",
            last_name: "Leonard",
            email: "matt@example.com",
          }),
          makeMemberRow({
            id: "member-matthew",
            user_id: "user-matthew",
            first_name: "Matthew",
            last_name: "Leonard",
            email: "matthew@example.com",
            created_at: "2026-03-02T00:00:00.000Z",
          }),
          makeMemberRow({
            id: "member-dana",
            user_id: "user-dana",
            first_name: "Dana",
            last_name: "Coach",
            email: "dana@example.com",
            created_at: "2026-03-03T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
    alumni: {
      select: { data: [], error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "mat leo",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "ambiguous");
  assert.equal(payload.suggestions.length, 0);
  assert.deepEqual(
    payload.disambiguation_options.map((option: any) => option.name),
    ["Matt Leonard", "Matthew Leonard"]
  );
});

test("suggest_connections returns not_found for unknown person_query", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: { data: [], error: null },
    },
    alumni: {
      select: { data: [], error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Ghost Person",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "not_found");
  assert.equal(payload.suggestions.length, 0);
});

test("suggest_connections returns no_suggestions when the source has no supported matches", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          makeMemberRow(),
          makeMemberRow({
            id: "member-2", user_id: "user-2",
            first_name: "Dana", last_name: "Coach", email: "dana@example.com",
            role: "Coach",
            created_at: "2026-03-02T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
    alumni: {
      select: { data: [], error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Louis Ciccone",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "no_suggestions");
  assert.equal(payload.source_person.name, "Louis Ciccone");
  assert.equal(payload.suggestions.length, 0);
});

test("suggest_connections returns weak fallback matches for sparse member-sourced queries", async () => {
  const sourceRow = makeMemberRow({
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "user-source", graduation_year: 2024,
  });
  stub = createToolSupabaseStub({
    members: {
      maybeSingle: { data: sourceRow, error: null },
      select: {
        data: [
          sourceRow,
          makeMemberRow({
            id: "22222222-2222-4222-8222-222222222222",
            user_id: "user-match",
            first_name: "Dana", last_name: "Coach", email: "dana@example.com",
            role: "Coach", graduation_year: 2026,
            created_at: "2026-03-02T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
    alumni: {
      select: {
        data: [
          makeAlumniRow({
            id: "33333333-3333-4333-8333-333333333333",
            user_id: "user-source",
            current_city: "Philadelphia", graduation_year: 2024,
          }),
          makeAlumniRow({
            id: "44444444-4444-4444-8444-444444444444",
            user_id: "user-match",
            first_name: "Dana", last_name: "Coach", email: "dana@example.com",
            current_city: "Philadelphia", graduation_year: 2026,
            position_title: "Advisor",
            created_at: "2026-03-04T00:00:00.000Z",
          }),
        ],
        error: null,
      },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_type: "member",
        person_id: "11111111-1111-4111-8111-111111111111",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "resolved");
  assert.equal(payload.source_person.name, "Louis Ciccone");
  assert.equal(payload.suggestions.length, 1);
  assert.equal(payload.suggestions[0].name, "Dana Coach");
  assert.deepEqual(
    payload.suggestions[0].reasons.map((reason: any) => reason.code),
    ["shared_city", "graduation_proximity"]
  );

  const telemetry = getSuggestionObservabilityByOrg(ORG_ID);
  assert.equal(telemetry.weakFallbackCount, 1);
  assert.equal(telemetry.lastResultStrength, "weak_fallback");
});

test("suggest_connections derives employer and industry from member company-role strings", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: {
        data: [
          {
            id: "member-1",
            organization_id: ORG_ID,
            user_id: "user-source",
            status: "active",
            deleted_at: null,
            first_name: "Tyler",
            last_name: "Morrison",
            email: "tyler@example.com",
            role: "Student",
            current_company: "Microsoft (SWE intern)",
            graduation_year: 2028,
            created_at: "2026-03-01T00:00:00.000Z",
          },
          {
            id: "member-2",
            organization_id: ORG_ID,
            user_id: "user-match",
            status: "active",
            deleted_at: null,
            first_name: "Sarah",
            last_name: "Chen",
            email: "sarah@example.com",
            role: "Engineer",
            current_company: "Google",
            graduation_year: 2021,
            created_at: "2026-03-02T00:00:00.000Z",
          },
        ],
        error: null,
      },
    },
    alumni: {
      select: {
        data: [
          {
            id: "alumni-2",
            organization_id: ORG_ID,
            user_id: "user-match",
            deleted_at: null,
            first_name: "Sarah",
            last_name: "Chen",
            email: "sarah@example.com",
            major: "Computer Science",
            current_company: "Google",
            industry: "Technology",
            current_city: "San Francisco",
            graduation_year: 2021,
            position_title: "Engineer",
            job_title: null,
            created_at: "2026-03-03T00:00:00.000Z",
          },
        ],
        error: null,
      },
    },
  });
  ctx = makeCtx(stub as any);

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "suggest_connections",
      args: {
        person_query: "Tyler Morrison",
      },
    })
  );

  const payload = result.data as any;
  assert.equal(payload.state, "resolved");
  assert.equal(payload.source_person.subtitle, "Student • Microsoft");
  assert.equal(payload.suggestions[0].name, "Sarah Chen");
  assert.deepEqual(
    payload.suggestions[0].reasons.map((reason: any) => reason.code),
    ["shared_industry", "shared_role_family"]
  );
});

test("invalid args return tool_error", async () => {
  const result = await executeToolCall(ctx, {
    name: "list_members",
    args: { limit: 999 } as any,
  });

  assert.equal(result.kind, "tool_error");
  assert.match(result.error, /invalid/i);
});

test("extract_schedule_pdf rejects attachments outside the caller upload prefix", async () => {
  stub = createToolSupabaseStub();
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-123",
    attachment: {
      storagePath: "other-org/other-user/schedule.pdf",
      fileName: "schedule.pdf",
      mimeType: "application/pdf",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Invalid schedule attachment path",
    code: "invalid_attachment_path",
  });
  assert.deepEqual(stub.storageDownloads, []);
});

test("extract_schedule_pdf allows in-prefix attachments to reach storage download", async () => {
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: new Blob([Buffer.from("not a real pdf")]),
        error: null,
      }),
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-456",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000000_schedule.pdf`,
      fileName: "schedule.pdf",
      mimeType: "application/pdf",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(stub.storageDownloads, [
    {
      bucket: "ai-schedule-uploads",
      path: `${ORG_ID}/${USER_ID}/1712000000000_schedule.pdf`,
    },
  ]);
  assert.deepEqual(stub.storageRemovals, [
    {
      bucket: "ai-schedule-uploads",
      paths: [`${ORG_ID}/${USER_ID}/1712000000000_schedule.pdf`],
    },
  ]);
  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Unable to read attached PDF",
    code: "pdf_unreadable",
  });
});

test("extract_schedule_pdf returns attachment_unavailable when the uploaded file cannot be downloaded", async () => {
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: null,
        error: { message: "Object not found" },
      }),
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-missing",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/17120000000005_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Unable to load attached schedule file",
    code: "attachment_unavailable",
  });
});

test("extract_schedule_pdf returns no_events_found for image uploads with no extracted events", async () => {
  const completionCalls: Array<{ messages: unknown[] }> = [];
  setScheduleExtractionDepsForTests({
    createClient: () =>
      ({
        chat: {
          completions: {
            create: async (params: { messages: unknown[] }) => {
              completionCalls.push(params);
              return {
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      events: [],
                      source_summary: "No events visible in the image.",
                      confidence: "low",
                    }),
                  },
                },
              ],
            };
            },
          },
        },
      }) as any,
  });
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: new Blob([Buffer.from("fake image bytes")]),
        error: null,
      }),
    },
    organizations: {
      maybeSingle: {
        data: { slug: "acme", name: "Acme Athletics" },
        error: null,
      },
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-empty",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000001_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "extract_schedule_pdf",
      args: {},
    })
  );

  assert.deepEqual(result.data, {
    state: "no_events_found",
    source_file: "schedule.png",
  });
  assert.match(JSON.stringify(completionCalls[0]?.messages), /https:\/\/example\.com/);
  assert.doesNotMatch(JSON.stringify(completionCalls[0]?.messages), /data:image\/png;base64/);
  assert.deepEqual(stub.storageRemovals, [
    {
      bucket: "ai-schedule-uploads",
      paths: [`${ORG_ID}/${USER_ID}/1712000000001_schedule.png`],
    },
  ]);
});

test("extract_schedule_pdf returns missing_fields for image uploads with readable partial rows", async () => {
  setScheduleExtractionDepsForTests({
    createClient: () =>
      ({
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      events: [],
                      candidate_rows: [
                        {
                          raw_text: "Acme vs Central, Friday 4/10, Main Gym",
                          title: "Acme vs Central",
                          start_date: "2026-04-10",
                        },
                      ],
                      source_summary: "One row was readable but missing a time.",
                      confidence: "medium",
                    }),
                  },
                },
              ],
            }),
          },
        },
      }) as any,
  });
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: new Blob([Buffer.from("fake image bytes")]),
        error: null,
      }),
    },
    organizations: {
      maybeSingle: {
        data: { slug: "acme", name: "Acme Athletics" },
        error: null,
      },
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-partial",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/17120000000015_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "extract_schedule_pdf",
      args: {},
    })
  );

  assert.deepEqual(result.data, {
    state: "missing_fields",
    validation_errors: [
      {
        index: 0,
        missing_fields: ["start_time"],
        draft: {
          raw_text: "Acme vs Central, Friday 4/10, Main Gym",
          title: "Acme vs Central",
          start_date: "2026-04-10",
        },
      },
    ],
  });
});

test("extract_schedule_pdf returns needs_batch_confirmation for image uploads with extracted events", async () => {
  setScheduleExtractionDepsForTests({
    createClient: () =>
      ({
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      events: [
                        {
                          title: "Acme vs Central",
                          start_date: "2026-04-10",
                          start_time: "18:30",
                          location: "Main Gym",
                          event_type: "game",
                        },
                      ],
                      source_summary: "One game extracted from the schedule image.",
                      confidence: "high",
                    }),
                  },
                },
              ],
            }),
          },
        },
      }) as any,
  });
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: new Blob([Buffer.from("fake image bytes")]),
        error: null,
      }),
    },
    organizations: {
      maybeSingle: {
        data: { slug: "acme", name: "Acme Athletics" },
        error: null,
      },
    },
    ai_pending_actions: {
      single: {
        data: {
          id: "pending-event-1",
          organization_id: ORG_ID,
          user_id: USER_ID,
          thread_id: "thread-image-success",
          action_type: "create_event",
          payload: {
            title: "Acme vs Central",
            start_date: "2026-04-10",
            start_time: "18:30",
            end_date: null,
            end_time: null,
            location: "Main Gym",
            description: null,
            event_type: "game",
            is_philanthropy: false,
            orgSlug: "acme",
          },
          status: "pending",
          expires_at: "2099-01-01T00:00:00.000Z",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
          executed_at: null,
          result_entity_type: null,
          result_entity_id: null,
        },
        error: null,
      },
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-success",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000002_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = expectOk(
    await executeToolCall(ctx, {
      name: "extract_schedule_pdf",
      args: {},
    })
  );
  const payload = result.data as any;

  assert.equal(payload.state, "needs_batch_confirmation");
  assert.equal(payload.pending_actions.length, 1);
  assert.equal(payload.pending_actions[0].payload.title, "Acme vs Central");
  assert.equal(payload.pending_actions[0].payload.orgSlug, "acme");
});

test("extract_schedule_pdf returns a mapped tool_error when image extraction fails", async () => {
  setScheduleExtractionDepsForTests({
    createClient: () =>
      ({
        chat: {
          completions: {
            create: async () => {
              throw new Error("vision unsupported");
            },
          },
        },
      }) as any,
  });
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: new Blob([Buffer.from("fake image bytes")]),
        error: null,
      }),
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-error",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000003_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Unable to read attached schedule image",
    code: "image_unreadable",
  });
});

test("extract_schedule_pdf returns a configuration error for invalid ZAI image model settings", async () => {
  setScheduleExtractionDepsForTests({
    createClient: () => ({}) as any,
    getImageModel: () => {
      throw new Error(
        'Invalid ZAI_IMAGE_MODEL value "bad-token". Expected a Z.AI vision model such as glm-5v-turbo.'
      );
    },
  });
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: new Blob([Buffer.from("fake image bytes")]),
        error: null,
      }),
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-config-error",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000004_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(result, {
    kind: "tool_error",
    error:
      "Schedule image extraction is misconfigured. Set ZAI_IMAGE_MODEL to a Z.AI vision model such as glm-5v-turbo.",
    code: "image_model_misconfigured",
  });
});

test("extract_schedule_pdf returns image_too_large for oversized image uploads", async () => {
  stub = createToolSupabaseStub({
    storage: {
      download: async () => ({
        data: new Blob([new Uint8Array((2 * 1024 * 1024) + 1)]),
        error: null,
      }),
    },
    organizations: {
      maybeSingle: {
        data: { slug: "acme", name: "Acme Athletics" },
        error: null,
      },
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-too-large",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000006_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Image too large for extraction (2MB). Maximum is 2MB.",
    code: "image_too_large",
  });
});

test("extract_schedule_pdf maps image stage timeouts to a deterministic tool_error", async () => {
  stub = createToolSupabaseStub({
    storage: {
      download: async () => {
        throw new StageTimeoutError("tool_extract_schedule_pdf", 60_000);
      },
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-image-timeout",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000007_schedule.png`,
      fileName: "schedule.png",
      mimeType: "image/png",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Schedule image extraction timed out",
    code: "image_timeout",
  });
});

test("extract_schedule_pdf maps PDF stage timeouts to a deterministic tool_error and cleans up the upload", async () => {
  stub = createToolSupabaseStub({
    storage: {
      download: async () => {
        throw new StageTimeoutError("tool_extract_schedule_pdf", 60_000);
      },
    },
  });
  ctx = {
    ...makeCtx(stub as any, {
      kind: "preverified_admin",
      source: "ai_org_context",
    }),
    threadId: "thread-pdf-timeout",
    attachment: {
      storagePath: `${ORG_ID}/${USER_ID}/1712000000008_schedule.pdf`,
      fileName: "schedule.pdf",
      mimeType: "application/pdf",
    },
  };

  const result = await executeToolCall(ctx, {
    name: "extract_schedule_pdf",
    args: {},
  });

  assert.deepEqual(result, {
    kind: "tool_error",
    error: "Schedule PDF extraction timed out",
    code: "pdf_timeout",
  });
  assert.deepEqual(stub.storageRemovals, [
    {
      bucket: "ai-schedule-uploads",
      paths: [`${ORG_ID}/${USER_ID}/1712000000008_schedule.pdf`],
    },
  ]);
});

test("db errors return tool_error", async () => {
  stub = createToolSupabaseStub({
    members: { select: { data: null, error: { message: "connection refused" } } },
  });
  ctx = makeCtx(stub as any);

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.equal(result.kind, "tool_error");
});

test("preverified admin authorization skips duplicate membership lookup", async () => {
  stub = createToolSupabaseStub();
  ctx = makeCtx(stub as any, {
    kind: "preverified_admin",
    source: "ai_org_context",
  });

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.equal(result.kind, "ok");
  assert.equal(
    stub.queries.some((query) => query.table === "user_organization_roles"),
    false
  );
});

test("missing membership returns forbidden before touching tool tables", async () => {
  stub = createToolSupabaseStub({
    user_organization_roles: { maybeSingle: { data: null, error: null } },
  });
  ctx = makeCtx(stub as any);

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });

  assert.deepEqual(result, { kind: "forbidden", error: "Forbidden" });
  assert.equal(stub.queries.some((q) => q.table === "members"), false);
});

test("pending or revoked membership returns forbidden", async () => {
  for (const status of ["pending", "revoked"]) {
    stub = createToolSupabaseStub({
      user_organization_roles: {
        maybeSingle: { data: { role: "admin", status }, error: null },
      },
    });
    ctx = makeCtx(stub as any);

    const result = await executeToolCall(ctx, { name: "list_members", args: {} });
    assert.deepEqual(result, { kind: "forbidden", error: "Forbidden" });
  }
});

test("non-admin membership returns forbidden", async () => {
  stub = createToolSupabaseStub({
    user_organization_roles: {
      maybeSingle: { data: { role: "active_member", status: "active" }, error: null },
    },
  });
  ctx = makeCtx(stub as any);

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.deepEqual(result, { kind: "forbidden", error: "Forbidden" });
});

test("membership query failure returns auth_error", async () => {
  stub = createToolSupabaseStub({
    user_organization_roles: {
      maybeSingle: { data: null, error: { message: "db unavailable" } },
    },
  });
  ctx = makeCtx(stub as any);

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.deepEqual(result, { kind: "auth_error", error: "Auth check failed" });
});

test("stage timeout returns timeout result", async () => {
  stub = createToolSupabaseStub({
    members: {
      select: Promise.reject(new StageTimeoutError("tool_list_members", 5_000)),
    },
  });
  ctx = makeCtx(stub as any);

  const result = await executeToolCall(ctx, { name: "list_members", args: {} });
  assert.deepEqual(result, { kind: "timeout", error: "Tool timed out" });
});

test("unknown tool name returns tool_error", async () => {
  const result = await executeToolCall(ctx, { name: "hack_the_planet" as any, args: {} });
  assert.equal(result.kind, "tool_error");
  assert.match(result.error, /unknown/i);
});

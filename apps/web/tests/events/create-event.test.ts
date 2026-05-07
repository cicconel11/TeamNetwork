import test from "node:test";
import assert from "node:assert/strict";
import { createEvent } from "@/lib/events/create-event";

test("createEvent maps unsupported event_type enum insert failures to a structured error", async () => {
  const result = await createEvent({
    supabase: {
      from(table: string) {
        assert.equal(table, "events");
        return {
          insert() {
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({
                      data: null,
                      error: {
                        code: "22P02",
                        message: 'invalid input value for enum event_type: "class"',
                        details: null,
                        hint: null,
                      },
                    });
                  },
                };
              },
            };
          },
        };
      },
    },
    serviceSupabase: null,
    orgId: "org-1",
    userId: "user-1",
    orgSlug: "upenn-sprint-football",
    input: {
      title: "Organic Chemistry",
      start_date: "2026-04-07",
      start_time: "09:00",
      end_date: "2026-04-07",
      end_time: "10:15",
      location: "Room 101",
      event_type: "class",
      is_philanthropy: false,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 500);

  if (!result.ok) {
    assert.equal(result.code, "event_type_unavailable");
    assert.match(result.error, /does not support the selected event type/i);
    assert.equal(result.internalError?.code, "22P02");
    assert.match(String(result.internalError?.message), /enum event_type/i);
  }
});

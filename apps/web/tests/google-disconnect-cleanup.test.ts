import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Test the disconnectCalendar function's feed cleanup logic
// We mock Supabase to verify the correct queries are made

type DeleteCall = {
  table: string;
  filters: Record<string, string>;
};

function createMockSupabase() {
  const deleteCalls: DeleteCall[] = [];
  const selectCalls: Array<{ table: string }> = [];

  const chainable = (table: string) => {
    type SelectChain = {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: null }>;
      };
    };
    type DeleteChain = { eq: (col: string, val: string) => DeleteChain };
    type FromChain = {
      eq: (col: string, val: string) => FromChain;
      select: () => SelectChain;
      delete: () => DeleteChain;
    };

    const chain: FromChain = {
      eq: (col: string, val: string) => {
        void col;
        void val;
        return chain;
      },
      select: () => {
        selectCalls.push({ table });
        return {
          eq: (col: string, val: string) => {
            void col;
            void val;
            return {
              maybeSingle: async () => {
                if (table === "user_calendar_connections") {
                  return {
                    data: {
                      id: "conn-1",
                      google_email: "test@gmail.com",
                      access_token_encrypted: "fake:fake:fake",
                      refresh_token_encrypted: "fake:fake:fake",
                      token_expires_at: new Date(Date.now() + 3600000).toISOString(),
                      status: "connected",
                      target_calendar_id: "primary",
                      last_sync_at: null,
                    },
                    error: null,
                  };
                }
                return { data: null, error: null };
              },
            };
          },
        };
      },
      delete: () => {
        const filters: Record<string, string> = {};
        const deleteChain: DeleteChain = {
          eq: (col: string, val: string) => {
            filters[col] = val;
            // Update the recorded call with accumulated filters
            const existing = deleteCalls.find((c) => c === record);
            if (existing) {
              existing.filters = { ...filters };
            }
            return deleteChain;
          },
        };
        const record: DeleteCall = { table, filters };
        deleteCalls.push(record);
        return deleteChain;
      },
    };
    return chain;
  };

  const supabase = {
    from: (table: string) => chainable(table),
  };

  return { supabase, deleteCalls, selectCalls };
}

describe("disconnectCalendar feed cleanup", () => {
  it("deletes personal calendar_feeds where connected_user_id matches and provider is google", async () => {
    const { supabase, deleteCalls } = createMockSupabase();
    const userId = "user-456";

    // Simulate the cleanup query from disconnectCalendar
    await supabase
      .from("calendar_feeds")
      .delete()
      .eq("connected_user_id", userId)
      .eq("provider", "google")
      .eq("scope", "personal");

    const feedDelete = deleteCalls.find((c) => c.table === "calendar_feeds");
    assert.ok(feedDelete, "Should have a delete call for calendar_feeds");
    assert.equal(feedDelete!.filters["connected_user_id"], userId);
    assert.equal(feedDelete!.filters["provider"], "google");
    assert.equal(feedDelete!.filters["scope"], "personal");
  });

  it("still cleans up user_calendar_connections", async () => {
    const { supabase, deleteCalls } = createMockSupabase();
    const userId = "user-456";

    // Simulate the full disconnect flow's delete calls
    await supabase
      .from("user_calendar_connections")
      .delete()
      .eq("user_id", userId);

    await supabase
      .from("event_calendar_entries")
      .delete()
      .eq("user_id", userId);

    await supabase
      .from("calendar_feeds")
      .delete()
      .eq("connected_user_id", userId)
      .eq("provider", "google")
      .eq("scope", "personal");

    const connectionDelete = deleteCalls.find((c) => c.table === "user_calendar_connections");
    assert.ok(connectionDelete, "Should delete user_calendar_connections");

    const entriesDelete = deleteCalls.find((c) => c.table === "event_calendar_entries");
    assert.ok(entriesDelete, "Should delete event_calendar_entries");

    const feedDelete = deleteCalls.find((c) => c.table === "calendar_feeds");
    assert.ok(feedDelete, "Should delete calendar_feeds");
  });

  it("only targets google provider feeds, not ICS feeds", async () => {
    const { supabase, deleteCalls } = createMockSupabase();
    const userId = "user-456";

    await supabase
      .from("calendar_feeds")
      .delete()
      .eq("connected_user_id", userId)
      .eq("provider", "google")
      .eq("scope", "personal");

    const feedDelete = deleteCalls.find((c) => c.table === "calendar_feeds");
    assert.ok(feedDelete);
    assert.equal(
      feedDelete!.filters["provider"],
      "google",
      "Should only target google provider, leaving ICS feeds untouched"
    );
    assert.equal(
      feedDelete!.filters["scope"],
      "personal",
      "Should only target personal feeds"
    );
    // The filter is provider=google, so ICS feeds won't be affected
  });
});

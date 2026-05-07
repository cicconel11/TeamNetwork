import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseStub } from "../../utils/supabaseStub";
import { getOutlookEntriesToSync } from "@/lib/calendar/manual-sync";

const testDir = dirname(fileURLToPath(import.meta.url));
const routePath = join(testDir, "..", "..", "..", "src", "app", "api", "calendar", "sync", "route.ts");

describe("/api/calendar/sync regressions", () => {
  it("does not hard-block Outlook-only manual sync with a Google-only error", () => {
    const source = readFileSync(routePath, "utf8");

    assert.ok(
      !source.includes("Please connect your Google Calendar first."),
      "Manual sync should not reject Outlook-only users with a Google-only error",
    );
  });

  it("filters Google backfill entries by provider", () => {
    const source = readFileSync(routePath, "utf8");
    const backfillBlockMatch = source.match(
      /from\("event_calendar_entries"\)\s*\.select\("event_id"\)([\s\S]*?)const existingEventIds/,
    );

    assert.ok(backfillBlockMatch, "Expected to find the Google backfill query block");
    assert.ok(
      backfillBlockMatch[1].includes('.eq("provider", "google")'),
      "Google backfill query must filter event_calendar_entries by provider",
    );
  });

  it("replays synced Outlook rows whose stored calendar no longer matches", async () => {
    const stub = createSupabaseStub();
    stub.seed("event_calendar_entries", [
      {
        id: "entry-pending",
        user_id: "user-1",
        organization_id: "org-1",
        provider: "outlook",
        event_id: "event-pending",
        sync_status: "pending",
        external_calendar_id: "calendar-old",
      },
      {
        id: "entry-mismatch",
        user_id: "user-1",
        organization_id: "org-1",
        provider: "outlook",
        event_id: "event-mismatch",
        sync_status: "synced",
        external_calendar_id: "calendar-old",
      },
      {
        id: "entry-current",
        user_id: "user-1",
        organization_id: "org-1",
        provider: "outlook",
        event_id: "event-current",
        sync_status: "synced",
        external_calendar_id: "calendar-new",
      },
    ]);

    const entries = await getOutlookEntriesToSync(
      stub as unknown as SupabaseClient<Database>,
      "user-1",
      "calendar-new",
      "org-1",
    );

    assert.deepEqual(
      entries.map((entry) => entry.event_id).sort(),
      ["event-mismatch", "event-pending"],
    );
  });

  it("treats default Outlook target calendar as null when detecting mismatches", async () => {
    const stub = createSupabaseStub();
    stub.seed("event_calendar_entries", [
      {
        id: "entry-default",
        user_id: "user-1",
        organization_id: "org-1",
        provider: "outlook",
        event_id: "event-default",
        sync_status: "synced",
        external_calendar_id: null,
      },
      {
        id: "entry-specific",
        user_id: "user-1",
        organization_id: "org-1",
        provider: "outlook",
        event_id: "event-specific",
        sync_status: "synced",
        external_calendar_id: "calendar-old",
      },
    ]);

    const entries = await getOutlookEntriesToSync(
      stub as unknown as SupabaseClient<Database>,
      "user-1",
      null,
      "org-1",
    );

    assert.deepEqual(entries.map((entry) => entry.event_id), ["event-specific"]);
  });
});

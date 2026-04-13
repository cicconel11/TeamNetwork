import { describe, it } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "path";

/**
 * Source-level assertion that the data export route includes all required
 * table names for FERPA compliance. This catches regressions where a data
 * category is accidentally removed from the export.
 */
describe("Data Export Completeness", () => {
  const exportRouteSource = readFileSync(
    join(process.cwd(), "src/app/api/user/export-data/route.ts"),
    "utf-8"
  );

  const requiredTables = [
    "user_organization_roles",
    "notification_preferences",
    "user_calendar_connections",
    "calendar_sync_preferences",
    "event_rsvps",
    "form_submissions",
    "chat_group_members",
    "mentorship_pairs",
    "analytics_consent",
    "usage_summaries",
    "chat_messages",
    "discussion_threads",
    "discussion_replies",
    "feed_posts",
    "feed_comments",
    "ai_threads",
    "ai_messages",
    "workout_logs",
    "parents",
    "media_items",
    "media_uploads",
    "competition_points",
  ];

  for (const table of requiredTables) {
    it(`should include ${table} in export route`, () => {
      assert.ok(
        exportRouteSource.includes(`"${table}"`),
        `Export route is missing table "${table}". All user data categories must be included for FERPA compliance.`
      );
    });
  }

  it("should NOT filter deleted_at on form_submissions (FERPA requires full export)", () => {
    // Ensure the form_submissions query doesn't exclude soft-deleted records
    const formSubmissionsSection = exportRouteSource.substring(
      exportRouteSource.indexOf('"form_submissions"'),
      exportRouteSource.indexOf('"form_submissions"') + 500
    );
    assert.ok(
      !formSubmissionsSection.includes('.is("deleted_at", null)'),
      "form_submissions query should NOT filter out soft-deleted records — FERPA requires complete data export"
    );
  });

  it("should include deleted_at in form_submissions select", () => {
    const formSubmissionsSection = exportRouteSource.substring(
      exportRouteSource.indexOf('"form_submissions"'),
      exportRouteSource.indexOf('"form_submissions"') + 500
    );
    assert.ok(
      formSubmissionsSection.includes("deleted_at"),
      "form_submissions query should select deleted_at for complete export"
    );
  });
});

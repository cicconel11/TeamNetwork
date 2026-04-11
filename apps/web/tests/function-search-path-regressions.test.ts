import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationFile = "../supabase/migrations/20261008000001_harden_remaining_security_definer_search_paths.sql";
const migration = readFileSync(new URL(migrationFile, import.meta.url), "utf8");
const calendarMigrationFile = "../supabase/migrations/20260420120000_google_calendar_sync.sql";
const calendarMigration = readFileSync(new URL(calendarMigrationFile, import.meta.url), "utf8");

function countMatches(input: string, pattern: RegExp): number {
  return Array.from(input.matchAll(pattern)).length;
}

describe("remaining SECURITY DEFINER search_path hardening", () => {
  it("pins the org and enterprise invite paths to an empty search_path", () => {
    assert.match(migration, /ALTER FUNCTION public\.redeem_org_invite\(text\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.create_enterprise_invite\(uuid, uuid, text, integer, timestamptz\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.redeem_enterprise_invite\(text\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.complete_enterprise_invite_redemption\(text, uuid\) SET search_path = '';/);
  });

  it("pins org membership, chat helper, and calendar timestamp functions to an empty search_path", () => {
    assert.match(migration, /ALTER FUNCTION public\.is_org_member\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.is_org_admin\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.is_chat_group_member\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.is_chat_group_moderator\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.is_chat_group_creator\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.update_user_calendar_connections_updated_at\(\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.update_event_calendar_entries_updated_at\(\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.update_calendar_sync_preferences_updated_at\(\) SET search_path = '';/);
  });

  it("pins remaining service-role helpers to an empty search_path", () => {
    assert.match(migration, /ALTER FUNCTION public\.can_enterprise_add_alumni\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.purge_expired_ai_semantic_cache\(\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.purge_old_enterprise_audit_logs\(\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.shift_media_album_sort_orders\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.reorder_media_albums\(uuid, uuid\[\]\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.shift_media_gallery_sort_orders\(uuid\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.reorder_media_gallery\(uuid, uuid\[\]\) SET search_path = '';/);
    assert.match(migration, /ALTER FUNCTION public\.sync_enterprise_nav_to_org\(uuid, uuid\) SET search_path = '';/);
  });

  it("rebuilds both media gallery upload overloads for empty search_path enum casts", () => {
    const normalized = migration.replace(/\s+/g, " ");

    assert.equal(
      countMatches(
        migration,
        /CREATE OR REPLACE FUNCTION public\.create_media_gallery_upload\(/g
      ),
      2,
      "expected both create_media_gallery_upload overloads to be recreated"
    );
    assert.equal(
      countMatches(migration, /SET search_path = ''/g) >= 2,
      true,
      "create_media_gallery_upload overloads should run with an empty search_path"
    );
    assert.ok(
      normalized.includes("p_status::public.media_status"),
      "create_media_gallery_upload must schema-qualify media_status casts under SET search_path = ''"
    );
  });

  it("only hardens calendar timestamp triggers that mutate NEW rows", () => {
    assert.match(
      calendarMigration,
      /create or replace function public\.update_user_calendar_connections_updated_at\(\)[\s\S]*?begin[\s\S]*?new\.updated_at = now\(\);[\s\S]*?return new;[\s\S]*?end;/i
    );
    assert.match(
      calendarMigration,
      /create or replace function public\.update_event_calendar_entries_updated_at\(\)[\s\S]*?begin[\s\S]*?new\.updated_at = now\(\);[\s\S]*?return new;[\s\S]*?end;/i
    );
    assert.match(
      calendarMigration,
      /create or replace function public\.update_calendar_sync_preferences_updated_at\(\)[\s\S]*?begin[\s\S]*?new\.updated_at = now\(\);[\s\S]*?return new;[\s\S]*?end;/i
    );
  });

  it("rebuilds trigger and error-tracking helpers with public-qualified table references", () => {
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.update_thread_activity\(\)[\s\S]*?SET search_path = ''[\s\S]*?UPDATE public\.discussion_threads/i
    );
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.update_error_baselines\(\)[\s\S]*?SET search_path = ''[\s\S]*?UPDATE public\.error_groups/i
    );
    assert.match(
      migration,
      /CREATE OR REPLACE FUNCTION public\.upsert_error_group\([\s\S]*?SET search_path = ''[\s\S]*?INSERT INTO public\.error_groups/i
    );
  });

  it("does not reintroduce public search_path settings in the hardening migration", () => {
    const strippedComments = migration.replace(/--[^\n]*/g, "");
    assert.doesNotMatch(strippedComments, /SET search_path(?:\s+TO)?\s+'?public/i);
  });
});

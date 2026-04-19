import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sql = await readFile(
  new URL(
    "../supabase/migrations/20261019000000_mentorship_native_tables.sql",
    import.meta.url
  ),
  "utf8"
);

function getPolicyBody(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(
    new RegExp(
      `create policy ${escapedName}[\\s\\S]*?(?=\\ndrop policy if exists|\\n-- =|\\ncommit;)`,
      "i"
    )
  );
  assert.ok(match, `missing policy: ${name}`);
  return match[0];
}

test("mentee_preferences table created idempotently with uniqueness", () => {
  assert.match(sql, /create table if not exists public\.mentee_preferences/i);
  assert.match(sql, /unique \(organization_id, user_id\)/i);
});

test("mentee_preferences columns cover matching contract", () => {
  for (const col of [
    "goals",
    "preferred_topics",
    "preferred_industries",
    "preferred_role_families",
    "preferred_sports",
    "preferred_positions",
    "required_attributes",
    "nice_to_have_attributes",
    "time_availability",
    "communication_prefs",
    "geographic_pref",
  ]) {
    assert.match(sql, new RegExp(`${col}\\b`), `missing column: ${col}`);
  }
});

test("mentee_preferences RLS policies require active org membership for owners and allow admin peer reads", () => {
  assert.match(sql, /alter table public\.mentee_preferences enable row level security/i);
  assert.match(sql, /create policy mentee_preferences_select/i);
  assert.match(sql, /create policy mentee_preferences_insert/i);
  assert.match(sql, /create policy mentee_preferences_update/i);
  assert.match(sql, /create policy mentee_preferences_delete/i);

  const selectPolicy = getPolicyBody("mentee_preferences_select");
  assert.match(
    selectPolicy,
    /user_id = \(select auth\.uid\(\)\)[\s\S]*has_active_role\(organization_id, array\['admin','active_member','alumni','parent'\]\)/i,
    "owner select should require an active org role"
  );
  assert.match(
    selectPolicy,
    /or public\.has_active_role\(organization_id, array\['admin'\]\)/i,
    "admins should be able to read org peer preferences"
  );

  const insertPolicy = getPolicyBody("mentee_preferences_insert");
  assert.match(
    insertPolicy,
    /user_id = \(select auth\.uid\(\)\)[\s\S]*has_active_role\(organization_id, array\['admin','active_member','alumni','parent'\]\)/i,
    "owner insert should require an active org role"
  );

  const updatePolicy = getPolicyBody("mentee_preferences_update");
  assert.match(
    updatePolicy,
    /for update using \([\s\S]*user_id = \(select auth\.uid\(\)\)[\s\S]*has_active_role\(organization_id, array\['admin','active_member','alumni','parent'\]\)/i,
    "owner update should require an active org role"
  );
  assert.match(
    updatePolicy,
    /with check \([\s\S]*user_id = \(select auth\.uid\(\)\)[\s\S]*has_active_role\(organization_id, array\['admin','active_member','alumni','parent'\]\)/i,
    "owner update check should require an active org role"
  );

  const deletePolicy = getPolicyBody("mentee_preferences_delete");
  assert.match(
    deletePolicy,
    /user_id = \(select auth\.uid\(\)\)[\s\S]*has_active_role\(organization_id, array\['admin','active_member','alumni','parent'\]\)/i,
    "owner delete should require an active org role"
  );
  assert.match(
    deletePolicy,
    /or public\.has_active_role\(organization_id, array\['admin'\]\)/i,
    "admins should be able to delete org peer preferences if needed"
  );
});

test("mentor_profiles gains native athletic + career arrays", () => {
  assert.match(sql, /add column if not exists sports text\[\]/i);
  assert.match(sql, /add column if not exists positions text\[\]/i);
  assert.match(sql, /add column if not exists industries text\[\]/i);
  assert.match(sql, /add column if not exists role_families text\[\]/i);
});

test("backfill contract maps mentee_latest_intake JSON keys to native columns idempotently", () => {
  assert.match(sql, /insert into public\.mentee_preferences/i);
  assert.match(sql, /from public\.mentee_latest_intake/i);
  assert.match(
    sql,
    /coalesce\(array\(select jsonb_array_elements_text\(mli\.data->'preferred_industry'\)\), '\{\}'\)[\s\S]*preferred_industries/i
  );
  assert.match(
    sql,
    /coalesce\(array\(select jsonb_array_elements_text\(mli\.data->'mentor_attributes_required'\)\), '\{\}'\)[\s\S]*required_attributes/i
  );
  assert.match(
    sql,
    /coalesce\(array\(select jsonb_array_elements_text\(mli\.data->'mentor_attributes_nice_to_have'\)\), '\{\}'\)[\s\S]*nice_to_have_attributes/i
  );
  assert.match(sql, /on conflict \(organization_id, user_id\) do update set/i);
  assert.match(sql, /updated_at = now\(\)/i);
});

test("updated_at trigger present on mentee_preferences", () => {
  assert.match(sql, /create trigger mentee_preferences_set_updated_at_trg/i);
});

test("menteePreferencesSchema zod shape matches columns", async () => {
  const mod = await import("../src/lib/schemas/mentorship.ts");
  const parsed = mod.menteePreferencesSchema.parse({
    goals: "learn",
    preferred_topics: ["leadership"],
    preferred_industries: ["Technology"],
    preferred_role_families: ["Engineering"],
    preferred_sports: ["basketball"],
    preferred_positions: ["point-guard"],
    required_attributes: ["same_sport"],
    nice_to_have_attributes: ["local"],
    time_availability: "2hr/month",
    communication_prefs: ["video"],
    geographic_pref: "NYC",
  });
  assert.equal(parsed.goals, "learn");
  assert.deepEqual(parsed.preferred_sports, ["basketball"]);
});

test("menteePreferencesSchema applies safe defaults on empty input", async () => {
  const mod = await import("../src/lib/schemas/mentorship.ts");
  const parsed = mod.menteePreferencesSchema.parse({});
  assert.deepEqual(parsed.preferred_topics, []);
  assert.deepEqual(parsed.communication_prefs, []);
});

test("mentorProfileNativeSchema validates native profile edit shape", async () => {
  const mod = await import("../src/lib/schemas/mentorship.ts");
  const parsed = mod.mentorProfileNativeSchema.parse({
    bio: "hi",
    expertise_areas: ["React"],
    topics: ["leadership"],
    sports: ["basketball"],
    positions: ["point-guard"],
    industries: ["Technology"],
    role_families: ["Engineering"],
    max_mentees: 5,
    accepting_new: true,
    meeting_preferences: ["video"],
    time_commitment: "flexible",
    years_of_experience: 8,
  });
  assert.equal(parsed.max_mentees, 5);
  assert.deepEqual(parsed.sports, ["basketball"]);
});

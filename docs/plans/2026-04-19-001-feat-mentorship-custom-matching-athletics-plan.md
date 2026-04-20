---
title: "feat: Mentorship Custom Matching, Transparency & Bulk Import for Athletics"
type: feat
status: active
date: 2026-04-19
---

# Mentorship Custom Matching, Transparency & Bulk Import for Athletics

## Enhancement Summary

**Deepened on:** 2026-04-19
**Sections enhanced:** All phases + new pre-work section
**Review agents used:** Architecture Strategist, Performance Oracle, Security Sentinel, Data Integrity Guardian, TypeScript Reviewer, Best Practices Researcher, Data Migration Expert, Pattern Recognition Specialist

### Key Improvements from Research
1. **Skip `sync_mentorship_intake_fields` RPC** — render custom fields dynamically from org settings at runtime instead of mutating form schema (Architecture Strategist)
2. **Template literal types** — use `custom:${string}` for reason codes and weight keys instead of generic `Record<string, number>` (TypeScript Reviewer)
3. **Qualitative match labels** — show "Strong match" / "Good match" tiers to mentees, never raw scores or rank positions (Best Practices Researcher)
4. **Pre-existing RLS bug** — `mentor_profiles_update` policy missing `has_active_role()` check; fix before adding `custom_attributes` (Security Sentinel)
5. **Bulk RPC for CSV import** — single RPC with batch operations instead of row-by-row queries to stay within Vercel 60s timeout (Data Migration Expert)
6. **Drop GIN index** — scoring happens in TypeScript, not SQL; GIN adds write overhead with zero read benefit (Performance Oracle)

### New Considerations Discovered
- `mentor_profiles` uses `is_active` boolean, not `deleted_at` soft-delete — import code must not assume soft-delete pattern
- `current_mentee_count` is trigger-maintained — CSV import must never write to this column
- Formula injection protection needed in CSV parser (also missing from existing alumni import)
- Concurrent `organizations.settings` writes need `jsonb_set()` at SQL level to prevent lost updates
- Suggestions route duplicates `ai-suggestions.ts` logic — consolidate before extending

---

## Context

A university athletics program (Taryn's org) needs a platform to match current student-athletes (mentees) with former student-athletes (mentors). Their core requirements:

1. **Algorithm-based matching on custom criteria** — sport, major, interests. This is their #1 concern; they've been burned by weak algorithms on other platforms and currently match by hand in Excel.
2. **Students browse mentors and identify ones that interest them** — with algorithmic help, not just a flat directory.
3. **Both groups apply via forms** — mentor registration + mentee intake.
4. **Low budget** — must be built into the platform.

TeamMeet already has a 6-signal weighted matching algorithm, mentor directory with relevance sorting, intake forms, admin match queue, and pair lifecycle. The gaps are: (1) the algorithm is closed to 6 hardcoded signals — no sport/major; (2) mentees see relevance-sorted cards but no match explanations; (3) no CSV/Excel import; (4) per-org weight tuning has no admin UI; (5) match quality is opaque.

## Proposed Solution

Add a generic `custom_attributes` system that lets any org define their own matching criteria (sport, major, interests, etc.) without code changes or migrations. Expose match explanations to mentees via a "My Matches" tab with qualitative labels. Add CSV import following the existing alumni import pattern. Add admin weight tuning UI.

---

## Phase 0: Pre-Work (Fix Existing Issues)

Before implementing new features, fix issues surfaced by the security audit and architecture review.

### 0.1 Fix `mentor_profiles_update` RLS policy

**File**: `supabase/migrations/20261019000000_mentorship_pre_work.sql`

The existing `mentor_profiles_update` policy at `20260521000000_create_discussions_jobs_mentors.sql:280` only checks `user_id = auth.uid()` without verifying `has_active_role(organization_id, ...)`. A revoked user can still update their mentor profile. Fix:

```sql
DROP POLICY IF EXISTS mentor_profiles_update ON mentor_profiles;
CREATE POLICY mentor_profiles_update ON mentor_profiles
  FOR UPDATE USING (
    user_id = auth.uid()
    AND has_active_role(organization_id, ARRAY['admin', 'active_member', 'alumni'])
  );
```

Same fix for `mentor_profiles_delete`.

### 0.2 Consolidate suggestions route into `suggestMentors()`

**Files**:
- `src/app/api/organizations/[organizationId]/mentorship/suggestions/route.ts` — refactor to delegate to `suggestMentors()` from `ai-suggestions.ts`
- `src/lib/mentorship/ai-suggestions.ts` — make `suggestMentors()` the single canonical entry point

The suggestions route currently duplicates ~100 lines of mentor loading, alumni enrichment, pair exclusion, and org settings fetch that `ai-suggestions.ts` already implements. Consolidating creates a single caching point and ensures custom attribute logic lives in one place.

### 0.3 Parallelize independent DB queries in suggestions

The route currently runs pairs exclusion and org settings queries sequentially after mentor profiles, but they are independent. Restructure into two parallel batches for ~40% latency reduction.

---

## Phase 1: Custom Attributes + Match Transparency (Demo-Ready)

**Goal**: Taryn can configure sport/major as matching criteria, mentees see "My Matches" with qualitative labels like "Strong match — You both played Lacrosse." Minimum viable demo.

### 1.1 Migration: `custom_attributes` column

**File**: `supabase/migrations/20261019100000_mentorship_custom_attributes.sql`

```sql
ALTER TABLE mentor_profiles
  ADD COLUMN custom_attributes jsonb NOT NULL DEFAULT '{}'::jsonb;

-- No GIN index — scoring happens in TypeScript, not SQL.
-- GIN would add write overhead with zero read benefit.

COMMENT ON COLUMN mentor_profiles.custom_attributes IS
  'Org-defined key-value pairs (e.g., {"sport":"Lacrosse","major":"Business"}).
   Keys defined in organizations.settings.mentorship_custom_attribute_defs.';
```

Custom attribute **definitions** live in `organizations.settings.mentorship_custom_attribute_defs`:
```typescript
interface CustomAttributeDef {
  readonly key: string;             // "sport", "major" — validated: /^[a-z][a-z0-9_]{1,30}$/
  readonly label: string;           // "Sport", "Major" — max 100 chars
  readonly type: "select" | "multiselect" | "text";
  readonly options?: Array<{label: string; value: string}>;  // for select/multiselect — max 50
  readonly weight: number;          // default weight — 0-100
  readonly required?: boolean;      // form validation
  readonly mentorVisible?: boolean; // show on mentor registration (default true)
  readonly menteeVisible?: boolean; // show on mentee intake (default true)
  readonly sortOrder?: number;      // admin-controlled display sequence
}
```

No separate migration for definitions — stored in existing `organizations.settings` jsonb, same pattern as `mentorship_weights`.

#### Research Insights

**Pattern alignment**: `options` uses `{label, value}[]` shape to match the existing form builder at `src/lib/schemas/form-builder.ts` (Pattern Recognition).

**Validation**: Zod schema in `src/lib/schemas/mentorship.ts` (barrel-exported via `@/lib/schemas`). Key regex `/^[a-z][a-z0-9_]{1,30}$/` prevents injection of keys that collide with built-in weight keys. Max 20 attributes per org (Best Practices).

**Write-time validation**: When a mentor saves `{"sport": "Lacrosse"}`, validate that "sport" is a defined key and "Lacrosse" is in the options list. Prevents data rot from deleted attributes (Best Practices).

### 1.2 Scoring engine: `custom:${string}` signals

**Files**:
- `src/lib/mentorship/matching-weights.ts` — extend types, create `resolveMentorshipConfig()`
- `src/lib/mentorship/matching-signals.ts` — extend interfaces, extraction
- `src/lib/mentorship/matching.ts` — add custom attribute scoring block, extend rarity stats

#### Type Design (TypeScript Reviewer recommendations)

**Reason codes** — template literal union, not a single generic code:
```typescript
type BuiltInReasonCode =
  | "shared_topics" | "shared_industry" | "shared_role_family"
  | "graduation_gap_fit" | "shared_city" | "shared_company";

type CustomReasonCode = `custom:${string}`;
type MentorshipReasonCode = BuiltInReasonCode | CustomReasonCode;
```

**Weights** — intersection type preserving compile-time safety on built-in keys:
```typescript
interface BuiltInMentorshipWeights {
  shared_topics: number;
  shared_industry: number;
  shared_role_family: number;
  graduation_gap_fit: number;
  shared_city: number;
  shared_company: number;
}

type MentorshipWeights = BuiltInMentorshipWeights & {
  [key: `custom:${string}`]: number;
};
```

**Config resolution** — unified function replacing separate weight + def loading:
```typescript
interface ResolvedMentorshipConfig {
  weights: MentorshipWeights;
  customAttributeDefs: readonly CustomAttributeDef[];
}

function resolveMentorshipConfig(orgSettings: unknown): ResolvedMentorshipConfig;
```

`ScoreOptions` stays unchanged — `orgSettings` already carries everything.

**Signal interfaces** — normalize custom attribute values to `string[]` at extraction time:
```typescript
// In MentorSignals and MenteeSignals:
customAttributes: Record<string, string[]>;  // always string[], never string | string[]
```

For `select` attributes, `extractMentorSignals` wraps: `["Lacrosse"]`. For `multiselect`, already array. For `text`, excluded entirely. Scoring uses `intersectNormalized()` uniformly — no runtime type checks.

#### Scoring semantics by attribute type
| Type | Match logic | Example |
|------|-------------|---------|
| `select` | Exact normalized match → full weight with rarity multiplier | Sport: "Lacrosse" = "Lacrosse" |
| `multiselect` | Set intersection, overlap scaling (same as `shared_topics`: 1→0.8x, 2→1.0x, 3+→1.2x) | Interests: ["Finance","Marketing"] ∩ ["Finance","Tech"] |
| `text` | Display-only, not scored | Goals text — shown but not matched |

**Key constraint**: All scoring goes through `scoreMentorForMentee()`. No separate function. (Per documented learning: single canonical scoring path.)

**Rarity stats**: Extend `RarityStats` with `customAttributeCounts: Map<string, Map<string, number>>` (attribute key → value → count). Built in `buildRarityStats()`. Iterate org's attribute defs (not mentor's stored keys) to avoid scoring orphaned attributes from deleted defs.

#### Performance Insight
Adding 5-10 custom attribute checks per mentor-mentee pair is O(A × M), negligible at expected scale (100s of mentors). The `resolveMentorshipConfig()` result should be computed once per ranking call and passed through — never re-fetched inside the scoring loop (Performance Oracle).

#### Edge Cases
- Org with no custom attribute defs → algorithm behavior identical to current (backward compat)
- Zero-weight custom attribute → excluded from scoring (weight check before computation)
- Empty `custom_attributes` jsonb on mentor profile → produces no signals, doesn't crash
- Admin deletes attribute key after mentors have data → orphaned values silently ignored during scoring, shown with "(archived)" label in UI

### 1.3 Intake form: dynamic custom fields (no RPC)

**Architecture change from original plan**: Skip the `sync_mentorship_intake_fields` RPC entirely (Architecture Strategist recommendation). Instead, render custom fields dynamically from `organizations.settings.mentorship_custom_attribute_defs` at runtime:

- The mentee intake page reads org custom attribute defs and appends dynamic fields below the 9 built-in form fields
- Responses are stored in the same `form_submissions.data` jsonb under keys matching the attribute def keys
- The form's `fields` array stays static (the 9 seeded fields)
- The scorer reads custom values from intake `data` by key

This eliminates: race conditions with concurrent form submissions, divergence risk between settings and form schema, and domain coupling between the generic forms system and mentorship semantics.

**Files**:
- `src/components/mentorship/MentorRegistration.tsx` — render dynamic inputs based on org custom attribute defs (filtered by `mentorVisible !== false`); save to `mentor_profiles.custom_attributes`
- `src/lib/mentorship/matching-signals.ts` `loadMenteeIntakeInput()` — extract custom attribute values from intake `data` jsonb using org attribute def keys

### 1.4 "My Matches" tab with qualitative labels

**New tab**: Add `'matches'` to `MentorshipTab` in `src/lib/mentorship/view-state.ts`

**New component**: `src/components/mentorship/MentorshipMyMatches.tsx` (naming per codebase convention)
- Calls existing `/api/organizations/${orgId}/mentorship/suggestions` (now delegating to `suggestMentors()`)
- Shows top-10 mentors with:
  - **Qualitative match label** (not raw score or rank position):
    - 75%+ of theoretical max → "Strong match" (green badge)
    - 50-74% → "Good match" (blue badge)
    - 25-49% → "Possible match" (muted badge)
    - Below 25% → hidden from results
  - Human-readable reason sentences: "You both played Lacrosse", "Same industry: Finance"
  - "Request Intro" CTA
- Empty state if no intake form submitted (with link to fill it out)
- Only shown to `active_member` role (mentees)
- **Never show**: numeric scores, weight values, rank position, or signal codes to mentees

#### Security: Score stripping for non-admin responses

The suggestions API must strip raw `score` and `signals[].weight` from non-admin responses. Return only:
```typescript
// Non-admin response shape
interface MenteeMatchView {
  mentorUserId: string;
  qualityTier: "strong" | "good" | "possible";
  reasons: string[];  // human-readable sentences only
}
```

Admins continue to see full numeric breakdowns.

#### Anti-Gaming (Best Practices)
- Present matches as an unordered set within each tier, not a numbered list
- Show only positive reasons ("You both..."), never missing signals
- Admin approval gate remains the most effective anti-gaming measure
- Optional: randomized tie-breaking with `hash(menteeId + orgId + epochWeek)` for weekly-stable but not permanently gameable ordering

**Match explanations**: Extend `src/lib/mentorship/presentation.ts`:
- `formatMatchExplanation(signal, customAttributeDefs)` → human-readable sentence per signal
- For `custom:sport`, looks up the def's `label` to produce "You both played Lacrosse" (not "custom:sport: Lacrosse")
- `formatMentorshipReasonLabel()` already falls back to title-cased code for unknown codes — custom attributes get dedicated formatting

**Directory enhancement**: `src/components/mentorship/MentorDirectory.tsx` — when sorted by relevance, show "Why this match?" expandable on each card using stored signals from suggestions response. Share suggestions data between tabs via client-side cache (`useSWR` or `react-query` with shared key) to prevent duplicate API calls.

**Admin queue**: `src/components/mentorship/AdminMatchQueue.tsx` — replace raw signal codes with `formatMatchExplanation()` output. Add match quality tier indicator.

### 1.5 Phase 1 tests

- `tests/mentorship-custom-attributes.test.ts`:
  - `scoreMentorForMentee` with custom attributes (select match, multiselect overlap, no match, mixed with built-in signals)
  - Custom attribute weight override from org settings
  - `formatMatchExplanation()` output for various signal combos including `custom:${string}` codes
  - Zero-weight custom attribute excluded from scoring
  - Empty `custom_attributes` jsonb doesn't crash scoring
  - Org with no custom attribute defs → algorithm unchanged (backward compat)
  - `resolveMentorshipConfig()` merges defaults + org overrides correctly
  - Score stripping for non-admin response shape

### 1.6 Phase 1 files summary

| File | Change |
|------|--------|
| `supabase/migrations/20261019000000_mentorship_pre_work.sql` | Fix RLS policies |
| `supabase/migrations/20261019100000_mentorship_custom_attributes.sql` | New: `custom_attributes` column (no GIN index) |
| `src/lib/mentorship/matching-weights.ts` | Template literal types, `resolveMentorshipConfig()` |
| `src/lib/mentorship/matching-signals.ts` | Extend interfaces with `customAttributes: Record<string, string[]>` |
| `src/lib/mentorship/matching.ts` | Add custom attribute scoring block, extend rarity stats |
| `src/lib/mentorship/presentation.ts` | Add `formatMatchExplanation()` with custom attr support |
| `src/lib/mentorship/view-state.ts` | Add `'matches'` tab |
| `src/lib/mentorship/ai-suggestions.ts` | Canonical entry point (suggestions route delegates here) |
| `src/lib/schemas/mentorship.ts` | Zod schemas for `CustomAttributeDef`, attribute values |
| `src/app/api/organizations/[organizationId]/mentorship/suggestions/route.ts` | Refactor to delegate to `suggestMentors()`, strip scores for non-admins |
| `src/components/mentorship/MentorshipMyMatches.tsx` | New: "My Matches" tab |
| `src/components/mentorship/MentorDirectory.tsx` | Show match explanations on cards, share cache key |
| `src/components/mentorship/MentorRegistration.tsx` | Dynamic custom attribute fields |
| `src/components/mentorship/MentorshipTabShell.tsx` | Wire up matches tab |
| `src/components/mentorship/AdminMatchQueue.tsx` | Enhanced signal display with qualitative labels |
| `src/app/[orgSlug]/mentorship/page.tsx` | Render matches tab |
| `tests/mentorship-custom-attributes.test.ts` | New test file |

---

## Phase 2: Admin Weight Tuning UI + Bulk CSV Import

**Goal**: Taryn can tune matching weights via sliders and import her Excel data. Independently shippable from Phase 1.

### 2.1 Admin custom attribute configuration

**New component**: `src/components/mentorship/MentorshipAdminCustomAttrConfig.tsx`
- CRUD for `organizations.settings.mentorship_custom_attribute_defs`
- Add/remove attributes with key, label, type, options (using `{label, value}[]` shape), weight, required, sort_order
- Warning when deleting an attribute that mentors already have data for — recommend "archive" (set weight to 0) over hard delete
- On save: PATCH to settings API using `jsonb_set()` for atomic update

**New API route**: `src/app/api/organizations/[organizationId]/mentorship/admin/settings/route.ts`
- `GET`: Returns effective weights + custom attribute defs via `resolveMentorshipConfig()`
- `PATCH`: Validates with Zod schema, writes using `jsonb_set()` at SQL level (not read-modify-write) to prevent concurrent admin updates from overwriting each other. Admin-only. Weight values validated: `>= 0`, `<= 100`, finite.

### 2.2 Admin weight tuning UI

**New component**: `src/components/mentorship/MentorshipAdminWeightTuning.tsx`
- Sliders for all signal weights (6 built-in + custom attributes)
- "Preview" button: admin picks a mentee from dropdown → shows how top-5 matches change with new weights. Calls suggestions API read-only with weight overrides — never writes to DB on preview.
- "Save" / "Reset to defaults" buttons
- Weight change logged to `mentorship_audit_log` (kind: `weights_updated`)
- Uses `"use client"`, `useTranslations("mentorship")` with `safeT()` fallback (per codebase convention)

**Page integration**: Add "Match Settings" link/section in `src/app/[orgSlug]/mentorship/admin/matches/page.tsx`

### 2.3 Bulk CSV import

**New API route**: `src/app/api/organizations/[organizationId]/mentorship/admin/import/route.ts`
- Follows alumni CSV import pattern from `src/app/api/organizations/[organizationId]/alumni/import-csv/route.ts`
- `POST {rows[], target: 'mentor_profiles', dryRun: boolean, overwrite: boolean}`

#### Critical implementation details from reviews:

**Use a bulk RPC** (not row-by-row):
```sql
-- Single RPC: batch email lookup + org membership check + upsert
-- ~4 queries total regardless of row count
CREATE FUNCTION bulk_import_mentor_profiles(p_org_id uuid, p_rows jsonb, p_overwrite boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
```
Follow `REVOKE ALL FROM public, anon, authenticated; GRANT EXECUTE TO service_role;` pattern.

**ON CONFLICT column scope** — explicitly enumerate updatable vs. preserved columns:
- **Updatable**: `bio`, `expertise_areas`, `topics`, `contact_email`, `contact_linkedin`, `contact_phone`, `time_commitment`, `meeting_preferences`, `years_of_experience`, `max_mentees`, `custom_attributes`
- **Never overwrite**: `current_mentee_count` (trigger-maintained), `is_active` (admin toggle), `accepting_new` (mentor toggle), `created_at`

**Email resolution**: Batch-query `auth.users` by email via service role → cross-reference against `user_organization_roles` for org membership → report unmatched emails with distinction between "email not found" and "user exists but not org member"

**`mentor_profiles` uses `is_active`, not `deleted_at`**: Import code must not assume soft-delete pattern.

**Formula injection protection**: Strip/escape formula-trigger prefixes from all string fields:
```typescript
function sanitizeCsvValue(value: string): string {
  return value.replace(/^[=+\-@\t\r|]+/, '');
}
```
This should also be backported to the alumni import (`src/lib/alumni/csv-import.ts` `normalizeStringValue`).

**Concurrency**: `ON CONFLICT` on the `(user_id, organization_id)` unique constraint handles concurrent imports safely — advisory lock is unnecessary (Data Migration Expert).

**Re-import idempotency**: `overwrite: false` → skip existing (shows `skipped: N`). `overwrite: true` → update existing (shows `updated: N`). No duplicates possible.

**Size limit**: Max 500 rows per import (synchronous, batch RPC keeps it well within Vercel 60s timeout).

**New component**: `src/components/mentorship/MentorshipAdminCsvImport.tsx`
- File upload + client-side CSV/XLSX parsing (follow `src/components/alumni/BulkCsvImporter.tsx` pattern — 830 lines with dry-run preview, row selection, status badges)
- Reuse from alumni import: `ImportResultBase`, `useFileDrop()`, `ImportDropZone`, `ImportPreviewSummary`, `ImportResultBanner`
- Column mapping UI: detected headers → mentorship fields (including custom attributes from org config via `resolveMentorshipConfig()`)
- Dry-run preview table showing per-row status: `created`, `updated`, `skipped`, `unknown_email`, `not_org_member`
- Unmapped CSV columns shown in preview so admin sees what was ignored
- Execute with progress + error display

### 2.4 Phase 2 tests

- `tests/mentorship-csv-import.test.ts`: column mapping, validation, formula injection stripping, dedup, `current_mentee_count` exclusion, email resolution, `is_active` preservation
- `tests/mentorship-weight-tuning.test.ts`: weight resolution with overrides, `jsonb_set()` atomic update, preview (read-only, no DB write)

### 2.5 Phase 2 files summary

| File | Change |
|------|--------|
| `supabase/migrations/20261019200000_bulk_import_mentor_profiles_rpc.sql` | New: bulk import RPC |
| `src/components/mentorship/MentorshipAdminCustomAttrConfig.tsx` | New |
| `src/components/mentorship/MentorshipAdminWeightTuning.tsx` | New |
| `src/components/mentorship/MentorshipAdminCsvImport.tsx` | New |
| `src/app/api/organizations/[organizationId]/mentorship/admin/settings/route.ts` | New |
| `src/app/api/organizations/[organizationId]/mentorship/admin/import/route.ts` | New |
| `src/app/[orgSlug]/mentorship/admin/matches/page.tsx` | Add settings/import links |
| `src/lib/alumni/csv-import.ts` | Backport formula injection protection |

---

## Phase 3: Polish & Edge Cases

- Intake form prerequisite enforcement (require intake before "Request Intro")
- Rate limit: max 3 pending proposals per mentee
- Capacity check at proposal INSERT time (not just view time) — verify `currentMenteeCount < maxMentees` in the insert trigger
- Mentee-specific rate limit on suggestions API: 5 req/min (vs. 30 for admins)
- "Unmatched mentees" admin view
- Export matched pairs as CSV for Taryn's reporting
- Soft-cap at 80% mentor capacity (reduce visibility, don't hard-filter) to prevent pile-on
- Optional: smooth IDF rarity multiplier replacing bucketed function (eliminates cliff effects at 10%/25%/50% boundaries)

---

## Key Design Decisions

1. **Generic `custom_attributes` jsonb** over first-class columns: next org may need fraternity, military branch, faith community. Zero migrations per new attribute.
2. **Template literal types** (`custom:${string}`) for reason codes and weight keys: compile-time safety on 6 built-in signals while allowing dynamic custom keys without `Record<string, number>` type erasure.
3. **Single canonical scoring path**: all custom attribute scoring in `scoreMentorForMentee()`, never a separate function. (Per documented learning about divergent enforcement.)
4. **No form sync RPC**: custom intake fields rendered dynamically from org settings at runtime. Eliminates race conditions, divergence risk, and domain coupling with generic forms system.
5. **Suggestions API reuse + consolidation**: "My Matches" reuses existing `/mentorship/suggestions` endpoint, refactored to delegate to `suggestMentors()` as single canonical entry point.
6. **Qualitative labels, not raw scores**: mentees see "Strong match" + reason sentences, never numeric scores or rank positions. Prevents algorithm gaming and matches industry best practice.
7. **CSV import matches by email to existing org members**: does not create user accounts. Missing emails reported as errors. Bulk RPC for performance. Formula injection protection.
8. **Atomic settings updates**: use `jsonb_set()` at SQL level for `organizations.settings` writes to prevent concurrent admin updates from overwriting each other.
9. **Phase 1 is demo-ready without CSV import**: Taryn's top concern is algorithm quality. Custom attributes + match transparency is enough to demonstrate. CSV import is Phase 2 because a few manual test profiles suffice for a demo.

## System-Wide Impact

### Interaction Graph
- Admin saves custom attribute config → `organizations.settings` updated via `jsonb_set()` → next `resolveMentorshipConfig()` call picks up new defs → scoring includes new signals → "My Matches" and directory show updated results
- Mentor saves profile with custom attributes → `mentor_profiles.custom_attributes` updated → `buildRarityStats()` includes new values → all mentee scores affected
- CSV import → bulk RPC inserts `mentor_profiles` rows → `current_mentee_count` NOT touched (trigger-maintained) → `is_active` defaults to true → mentors immediately appear in directory

### Error Propagation
- Malformed custom attribute defs in org settings → `resolveMentorshipConfig()` returns empty defs array (fail-safe) → scoring uses only 6 built-in signals
- Invalid custom attribute values on mentor profile → Zod validation at write boundary rejects → never stored

### State Lifecycle Risks
- Admin deletes custom attribute def → orphaned values in mentor profiles → scoring ignores them (iterates defs, not stored keys) → UI shows "(archived)" label
- Admin changes attribute options → existing mentor values not in new options list → shown but flagged for update

## Verification

1. **Type-check**: `npx tsc --noEmit` passes
2. **Tests**: `npm run test:unit` passes including new custom attribute tests
3. **Backward compat**: Org with no custom attributes → algorithm behavior identical to current
4. **Demo flow**: Configure sport/major for an org → register mentors with custom attrs → submit mentee intake → view "My Matches" tab → see qualitative labels + explanations → request intro → admin sees proposal with full signal breakdown
5. **CSV flow**: Upload mentor CSV → map columns → dry-run preview → import → verify profiles created with `custom_attributes` populated, `current_mentee_count` untouched
6. **Weight tuning**: Adjust sport weight to max → preview (read-only) → save → verify sport-matched mentors rise to top
7. **Security**: Non-admin on suggestions API receives only qualitative labels, no scores/weights. Revoked user cannot update mentor profile (RLS fix). Formula injection characters stripped from CSV.

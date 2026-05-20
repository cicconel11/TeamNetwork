---
title: "fix: Wire Blackbaud phones/addresses fetch and clean any-usage"
type: fix
status: active
date: 2026-05-19
---

# fix: Wire Blackbaud phones/addresses fetch and clean any-usage

## Summary

Wire `/phones` and `/addresses` sub-resource fetches into Blackbaud constituent sync so normalized alumni records carry real phone numbers and address summaries instead of empty arrays, and replace the remaining `supabase: any` usages in `apps/web/src/lib/blackbaud/**` with the project's branded `ServerSupabase`/`ServiceSupabase` types. One narrow correctness fix surfaces alongside: `findPrimary` filters phones by `do_not_email` instead of `do_not_call`, so opted-out numbers leak into normalization once phones are actually fetched.

---

## Problem Frame

Sync currently fetches only `/emailaddresses` per constituent. `apps/web/src/lib/blackbaud/sync.ts:208,222` passes empty arrays to `normalizeConstituent` for phones and addresses, so `alumni.phone_number` and `alumni.address_summary` are always `null` after a Blackbaud sync — even when the constituent has primary phone/address records in RE NXT. The normalize layer already accepts both sub-resources (`apps/web/src/lib/blackbaud/normalize.ts:29-49`); only the fetch is missing.

Separately, `docs/agent/todos/002-pending-p2-fix-repo-wide-lint-baseline.md` flagged `src/lib/blackbaud/**` as a lint hotspot. The remaining `any` usage in the directory is five sites across three files — all on the Supabase client argument — and they survive on `eslint-disable` lines rather than real typing. The Supabase wrappers already export branded `ServerSupabase` / `ServiceSupabase` types (`apps/web/src/lib/supabase/types.ts`); we can swap.

---

## Requirements

- R1. After a sync, alumni records linked to constituents with a primary, active, non-opted-out phone carry that number in `alumni.phone_number`.
- R2. After a sync, alumni records linked to constituents with a primary, active address carry a formatted summary in `alumni.address_summary`.
- R3. Phones marked `do_not_call` are excluded from selection. Phones marked `inactive` are excluded. The existing `do_not_email` filter for emails is unchanged.
- R4. Sub-resource fetch failures (non-quota) do not fail the constituent. Quota-exhausted errors still propagate and stop the run, matching current `/emailaddresses` behavior.
- R5. `BLACKBAUD_DEV_SKIP_EMAILS` continues to skip the sub-resource hop in dev. New behavior: when phones/addresses fetching is added, the same dev cap applies (one flag covers all sub-resources to keep dev quota usage low).
- R6. No `: any`, `as any`, or `eslint-disable @typescript-eslint/no-explicit-any` for the Supabase parameter remains in `apps/web/src/lib/blackbaud/{sync,storage,token-refresh}.ts`.
- R7. `bun run --cwd apps/web typecheck` and `bun run --cwd apps/web lint` pass for touched files.

---

## Scope Boundaries

- Not changing the OAuth / token refresh logic — only the supabase parameter typing in `token-refresh.ts`.
- Not adding new endpoints beyond `/phones` and `/addresses`. Educations, gifts, relationships stay out.
- Not changing the alumni schema. `phone_number` and `address_summary` columns already exist.
- Not scheduling the production cron (separate item from improvement list).
- Not retrofitting backfill — phones/addresses populate on the next incremental sync once `date_modified` advances or on the next full sync.

### Deferred to Follow-Up Work

- Repo-wide `any` audit beyond `src/lib/blackbaud/**`: separate pass.
- Replacing `external_data: record as unknown` casts in `storage.ts`: low-value, leaves typing tight.

---

## Context & Research

### Relevant Code and Patterns

- `apps/web/src/lib/blackbaud/sync.ts:186-224` — per-constituent loop already wraps the `/emailaddresses` fetch in try/catch with quota re-throw. New sub-resource fetches mirror this shape exactly.
- `apps/web/src/lib/blackbaud/normalize.ts:9-12` — `findPrimary` filter is the bug surface for R3: `!item.do_not_email` is wrong for phones.
- `apps/web/src/lib/blackbaud/types.ts:33-53` — `BlackbaudPhone` carries `do_not_call`; `BlackbaudAddress` has no opt-out flag (filter on `inactive` only).
- `apps/web/src/lib/blackbaud/client.ts` — `getList<T>` is the existing client method. No client changes needed.
- `apps/web/src/lib/supabase/types.ts:12-23` — `ServerSupabase` (user-scoped, RLS) and `ServiceSupabase` (service-role, RLS-bypass) brands.
- `apps/web/src/app/api/cron/integrations-sync/route.ts` and `apps/web/src/app/api/organizations/[organizationId]/integrations/blackbaud/sync/route.ts` — entry points; verify which brand is passed to `runSync`.

### Institutional Learnings

- `docs/agent/todos/002-pending-p2-fix-repo-wide-lint-baseline.md` — lint baseline notes `src/lib/blackbaud/**` as residual `any` hotspot.
- Sync was built quota-aware from day one; per-constituent sub-resource calls add 2 RPS at the existing 50ms pacing. SKY API limits are per-minute, not per-second; existing `Out of call volume quota` handling covers exhaustion.

---

## Key Technical Decisions

- **Fetch phones and addresses inline in the constituent loop, mirroring the `/emailaddresses` pattern.** Rationale: pattern is proven, error/quota handling already in place, only one new file change to sync.ts. Alternative (parallel `Promise.all` per constituent) was rejected — three parallel sub-resource calls would triple the quota burst rate without changing the bottleneck (sequential page fetches dominate).
- **Single dev flag `BLACKBAUD_DEV_SKIP_EMAILS` repurposed to skip all sub-resources.** Rationale: name is now slightly misleading but adding `_SKIP_PHONES` / `_SKIP_ADDRESSES` triples config surface for marginal benefit. Update the env var comment in `.env.local.example`. Alternative (rename to `BLACKBAUD_DEV_SKIP_SUBRESOURCES`) is the right long-term call but is a breaking change for any dev with the old var set; defer rename.
- **Fix `findPrimary` by parametrizing the opt-out filter rather than splitting into per-type helpers.** Each call site passes a small predicate. Keeps one helper, makes the filter explicit at the call site, avoids three near-duplicate functions.
- **Type the Supabase parameter as `ServerSupabase | ServiceSupabase` (union) where the function genuinely accepts either.** `runSync` is called from both authenticated user routes and the service-role cron, so a union is honest. `upsertConstituents` and `refreshTokenWithFallback` inherit the same. Rationale: branded types already exist; using the union expresses "either client works" without resorting to the unbranded base `SupabaseClient`.

---

## Open Questions

### Resolved During Planning

- **Does `runSync` need both client brands?** Yes — verified via grep of the two API route entry points. Both `ServerSupabase` (org admin manual sync) and `ServiceSupabase` (cron) call into the same `runSync`. Use the union.
- **Is `do_not_call` already in the `BlackbaudPhone` type?** Yes — `types.ts:39`. No type change needed.

### Deferred to Implementation

- Exact ordering of phone/address fetch vs email fetch — sequential in code is fine; if quota proves tight in practice, can revisit with `Promise.all` and is not a plan-time decision.

---

## Implementation Units

- U1. **Fix `findPrimary` opt-out filter to be type-aware**

**Goal:** Make `findPrimary` filter by the correct opt-out flag per sub-resource type, so phones use `do_not_call` (not `do_not_email`) and addresses use neither.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `apps/web/src/lib/blackbaud/normalize.ts`
- Test: `apps/web/tests/blackbaud-normalize.test.ts`

**Approach:**
- Change `findPrimary` to accept an optional `isExcluded` predicate or to filter only on `inactive`, then have each call site pass its own opt-out predicate (`(e) => e.do_not_email` for emails, `(p) => p.do_not_call` for phones, undefined for addresses).
- Keep the "primary, else first active" tiebreaker.

**Patterns to follow:**
- Existing `findPrimary` at `apps/web/src/lib/blackbaud/normalize.ts:9-12`.

**Test scenarios:**
- Happy path: phone with `primary: true` is selected over non-primary; address with `primary: true` is selected over non-primary.
- Edge case: when no item is `primary`, first non-inactive item is selected.
- Error path: phone with `do_not_call: true` is excluded; if all phones are `do_not_call`, result is `null`.
- Error path: phone with `do_not_email: true` (which is not a phone field) is *not* excluded — the email filter must not bleed into phones.
- Edge case: address with `inactive: true` is excluded; addresses do not have an opt-out flag so `do_not_call`/`do_not_email` on an address never excludes it.

**Verification:**
- `bun --cwd apps/web test apps/web/tests/blackbaud-normalize.test.ts` passes new and existing scenarios.

---

- U2. **Fetch `/phones` and `/addresses` sub-resources in `runSync`**

**Goal:** Add sub-resource fetches alongside the existing `/emailaddresses` call, pass the results into `normalizeConstituent`, and treat fetch failures the same way email fetch failures are treated today.

**Requirements:** R1, R2, R4, R5

**Dependencies:** U1 (so that fetched phones don't leak `do_not_call` numbers into alumni records on the first run)

**Files:**
- Modify: `apps/web/src/lib/blackbaud/sync.ts`
- Test: `apps/web/tests/blackbaud-sync-subresources.test.ts` (new)

**Approach:**
- In the per-constituent loop (currently `sync.ts:186-224`), after the email fetch block, add two parallel-shaped blocks for phones (`/constituent/v1/constituents/{id}/phones`) and addresses (`/constituent/v1/constituents/{id}/addresses`).
- Each block: gated by `!skipEmails` (single dev flag covers all sub-resources — see Key Technical Decisions), wrapped in try/catch, re-throws `BlackbaudApiError` when `isQuotaExhausted`, otherwise `debugLog`s and continues with `[]`.
- Replace the two `[], []` empty-array arguments at the existing `normalizeConstituent` call sites with the fetched arrays.
- Keep the `await new Promise(r => setTimeout(r, 50))` pacing between sub-resource calls — apply once after each sub-resource fetch to preserve current 50ms-per-call cadence.
- Update the catch-fallback `normalizeConstituent(constituent, [], [], [])` at the existing error path to still pass empties (record stays creatable even if sub-resource normalize threw).

**Patterns to follow:**
- Existing email fetch block at `apps/web/src/lib/blackbaud/sync.ts:189-206`. Copy the shape exactly — including the inner try/catch, quota re-throw, and `debugLog` on non-quota failure.

**Test scenarios:**
- Happy path: constituent with a primary phone and primary address → `normalizeConstituent` receives populated arrays → `alumni.phone_number` and `alumni.address_summary` set on the persisted record. Stub `client.getList` to return phone/address fixtures, assert what reaches the supabase upsert.
- Edge case: constituent with phone but no addresses → phone set, address summary null. And vice versa.
- Error path: `/phones` returns 500 → fetch caught and logged → constituent still upserted, phone null, address still attempted and populated. Sync result `ok: true`.
- Error path: `/phones` returns 429 with quota-exhausted body → `BlackbaudApiError.isQuotaExhausted === true` → `runSync` throws `BlackbaudSyncFailure` with `code: "QUOTA_EXHAUSTED"`, matching email-quota behavior. `last_sync_error` carries the structured error.
- Edge case: `BLACKBAUD_DEV_SKIP_EMAILS=true` → phones/addresses are not fetched (no extra `client.getList` calls beyond the constituent page), but constituent is still upserted with empty sub-resources.
- Integration: existing `tests/blackbaud-sync-cursor.test.ts` still passes — verify the new sub-resource calls do not advance the cursor early. (`callCount` expectations in that test will increase; update accordingly.)

**Verification:**
- New test file passes.
- Existing `tests/blackbaud-sync-*.test.ts` suite passes after `callCount` updates where they count `getList` invocations per constituent.

---

- U3. **Update `BLACKBAUD_DEV_SKIP_EMAILS` documentation to reflect broader scope**

**Goal:** Reflect that the dev flag now skips all sub-resources, not just emails. Avoid renaming the env var (breaking).

**Requirements:** R5

**Dependencies:** U2

**Files:**
- Modify: `apps/web/.env.local.example` (or the repo-root `.env.local.example` — verify which holds the Blackbaud block during implementation)
- Modify: `apps/web/src/lib/blackbaud/sync.ts` — inline comment near `skipEmails` destructure noting the broader scope.

**Approach:**
- Update the comment beside `BLACKBAUD_DEV_SKIP_EMAILS` in the env example to read: "Dev only: skip sub-resource fetches (emails, phones, addresses) to conserve quota during development."
- Add a one-line comment above the `skipEmails` usage in `sync.ts` so the next reader doesn't grep for `phones` and miss the connection.

**Test scenarios:**
- Test expectation: none — documentation-only change, no behavioral surface to verify beyond U2's coverage of the flag.

**Verification:**
- Comment text matches and `grep` for `BLACKBAUD_DEV_SKIP_EMAILS` lands the reader on the broader behavior.

---

- U4. **Replace `supabase: any` in `storage.ts` with branded union type**

**Goal:** Remove the `any` typing on the `UpsertDeps.supabase` field and let TypeScript verify the Supabase calls in `upsertConstituents`.

**Requirements:** R6, R7

**Dependencies:** None

**Files:**
- Modify: `apps/web/src/lib/blackbaud/storage.ts`
- Test: existing `apps/web/tests/blackbaud-storage.test.ts` (no new test — type-level change verified by typecheck)

**Approach:**
- Import `ServerSupabase` and `ServiceSupabase` from `@/lib/supabase/types`.
- Change `supabase: any` to `supabase: ServerSupabase | ServiceSupabase`.
- Run typecheck; if errors surface on `external_data: record as unknown` or similar, leave existing casts in place (deferred, per Scope Boundaries) and address only the new `supabase` parameter signature.
- Remove the `// eslint-disable` line is N/A here — this site does not use one, just bare `any`.

**Patterns to follow:**
- Existing branded type usage anywhere in `apps/web/src/lib/supabase/**` callers.

**Test scenarios:**
- Test expectation: none — type-only change. Behavior verified by re-running the existing storage tests.

**Verification:**
- `bun run --cwd apps/web typecheck` passes.
- `bun run --cwd apps/web lint` clean for `storage.ts`.

---

- U5. **Replace `supabase: any` in `sync.ts` `SyncDeps` with branded union type**

**Goal:** Remove the `any` typing on `SyncDeps.supabase` and the corresponding `eslint-disable` line.

**Requirements:** R6, R7

**Dependencies:** U4 (storage's typed signature is what `runSync` calls into — fixing storage first keeps the typecheck wave small)

**Files:**
- Modify: `apps/web/src/lib/blackbaud/sync.ts`

**Approach:**
- Same as U4: import the branded types, change `supabase: any` to `supabase: ServerSupabase | ServiceSupabase`, remove the inline `// eslint-disable` comment.
- Verify the call sites in `apps/web/src/app/api/cron/integrations-sync/route.ts` and `apps/web/src/app/api/organizations/[organizationId]/integrations/blackbaud/sync/route.ts` already produce the right brand. If a route was passing an unbranded client, fix the route to pass through the wrapper (`createServiceClient()` returns `ServiceSupabase`).

**Patterns to follow:**
- U4's signature change.

**Test scenarios:**
- Test expectation: none — type-only change.

**Verification:**
- `bun run --cwd apps/web typecheck` passes.
- Existing sync test suite still passes (the test fixtures use `as any` casts which remain — tests are out of scope for the lint cleanup per scope boundaries).

---

- U6. **Replace `supabase: any` in `token-refresh.ts` with branded union type**

**Goal:** Type the `refreshTokenWithFallback` Supabase argument and remove the two `(supabase as any)` casts plus their `eslint-disable` lines.

**Requirements:** R6, R7

**Dependencies:** None (independent of U4/U5; can land in same PR or separate)

**Files:**
- Modify: `apps/web/src/lib/blackbaud/token-refresh.ts`

**Approach:**
- Import branded types. Change parameter to `supabase: ServerSupabase | ServiceSupabase`.
- Drop both `(supabase as any)` casts — the typed client should accept the `.from("org_integrations").update(...).select("id", { count: "exact", head: true })` chain directly. If a method-level cast is genuinely required (e.g., Supabase's typed `count` overloads narrow too aggressively), narrow the cast to that one call rather than the entire client, and add a one-line comment explaining the constraint.
- Remove both `// eslint-disable-next-line` comments.

**Patterns to follow:**
- U4's signature change.

**Test scenarios:**
- Test expectation: none — type-only change. Behavioral coverage already lives in `apps/web/tests/blackbaud-token-refresh.test.ts`.

**Verification:**
- `bun run --cwd apps/web typecheck` passes.
- `bun run --cwd apps/web lint` clean for `token-refresh.ts`.
- Existing `tests/blackbaud-token-refresh.test.ts` passes.

---

## System-Wide Impact

- **Interaction graph:** Sync entry points (`/api/cron/integrations-sync`, `/api/organizations/[id]/integrations/blackbaud/sync`) → `runSync` → SKY API client → `normalizeConstituent` → `upsertConstituents` → `alumni` + `alumni_external_ids`. New sub-resource fetches add two more SKY API calls per constituent.
- **Error propagation:** Quota errors continue to bubble as `BlackbaudSyncFailure` with `phase: "api_fetch"`, `code: "QUOTA_EXHAUSTED"`. Non-quota sub-resource failures are debug-logged and the constituent proceeds with empty arrays — same shape as email failures today.
- **State lifecycle risks:** First sync after this lands populates `phone_number` / `address_summary` for *all* existing constituent mappings on incremental sync only when `date_modified > lastSyncedAt`. Constituents not touched in RE NXT since last sync will not refresh until next full sync. Acceptable — no special backfill required.
- **API surface parity:** No public API change. Internal types remain — `NormalizedConstituent.phone_number` / `.address_summary` already typed.
- **Integration coverage:** Quota burst increases ~3x per constituent (1 page call + 3 sub-resource calls vs. 1 page + 1 sub-resource). SKY API quota is per-minute, not per-second; 50ms pacing already in place. No mitigation required, but watch `last_sync_error` for `QUOTA_EXHAUSTED` after deploy.
- **Unchanged invariants:** OAuth flow, token encryption, sync lock semantics, claim-flow RPCs, alumni schema, RLS policies — none touched.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Sub-resource fetches triple quota burn for the first full sync after deploy | Existing `BLACKBAUD_DEV_SKIP_EMAILS` + 50ms pacing; SKY API quota is per-minute, exhaustion already structured-logged and surfaced to UI |
| `do_not_call` filter fix changes which phone is "primary" for some constituents that were previously normalizing on the buggy filter | Negligible — phones were never persisted before this plan; first phone every constituent sees uses the correct filter |
| Branded union (`ServerSupabase \| ServiceSupabase`) too narrow if a code path passes an unbranded `SupabaseClient` | Unlikely — grep showed only the two wrapper functions are entry points. If typecheck surfaces an unbranded caller, fix the caller to go through the wrapper rather than widening the type |
| Supabase typed query chain rejects a call that the `any` form accepted | Localized — narrow a single `as` cast at that one method call with a comment, not the whole parameter |

---

## Sources & References

- Related code: `apps/web/src/lib/blackbaud/{sync,normalize,storage,token-refresh,types,client}.ts`, `apps/web/src/lib/supabase/types.ts`
- Related docs: `docs/agent/todos/002-pending-p2-fix-repo-wide-lint-baseline.md`
- Origin context: improvement list from session investigation (items 3 and 6)

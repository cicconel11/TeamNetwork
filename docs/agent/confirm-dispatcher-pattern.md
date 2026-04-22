# AI Confirm-Handler Dispatcher Pattern

## Purpose

`POST /api/ai/[orgId]/pending-actions/[actionId]/confirm` is the single route that executes every AI-drafted write action (announcements, events, jobs, discussions, chat, enterprise invites). For most of the project's life the route body held all nine per-action branches inline, which grew `handler.ts` to 920 LOC and made parallel per-domain work collision-prone.

Phase 0.5 of the Tier 1 edit/delete plan split the route into:

- **`handler.ts`** — shell: rate-limit, auth, CAS `pending → confirmed`, outer `try/catch` with rollback, and a nine-arm `switch` that forwards each action to a dispatcher.
- **`dispatchers/<domain>.ts`** — per-domain confirm logic: call the domain primitive, CAS `confirmed → executed` (or rollback on typed failure), write the assistant confirmation message to `ai_messages`, and run any best-effort side effects.

This document captures the shape so the remaining Tier 1 phases (and any future `prepare_*` tool families) can be added without relitigating the design.

## File layout

```
src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/
├── handler.ts
├── route.ts
└── dispatchers/
    ├── announcements.ts         (create_announcement)
    ├── chat.ts                  (send_chat_message, send_group_chat_message)
    ├── discussions.ts           (create_discussion_thread, create_discussion_reply)
    ├── enterprise-invites.ts    (create_enterprise_invite, revoke_enterprise_invite)
    ├── events.ts                (create_event)
    └── jobs.ts                  (create_job_posting)
```

One file per domain. Pair a related create/revoke, thread/reply, or group/direct pair in one file when they share primitives or types. The handler holds zero domain knowledge beyond the dispatch switch.

## Dispatcher contract

Each dispatcher exports one async function per `PendingActionRecord<T>` type it handles. The signature is uniform:

```ts
export async function handleCreateAnnouncement(
  ctx: AnnouncementDispatcherContext,
  action: PendingActionRecord<"create_announcement">,
  deps: AnnouncementDispatcherDeps
): Promise<NextResponse>;
```

Three arguments, always in this order:

- **`ctx`** — request-scoped values the dispatcher can't derive (`serviceSupabase`, `orgId`, `userId`, `logContext`, `canUseDraftSessions`, and the wired `updatePendingActionStatusFn` / `clearDraftSessionFn`). The enterprise-invites dispatcher is the only one that also carries the auth-bound `supabase` client — it needs it for the RLS-gated RPC.
- **`action`** — the pending-action row, typed to the dispatcher's specific discriminant so `action.payload` narrows correctly.
- **`deps`** — domain-specific collaborators (e.g., `createAnnouncementFn`, `sendNotificationBlastFn`). Wired from `handler.ts`'s `deps` parameter so tests can inject stubs.

Each dispatcher's job:

1. Parse `action.payload`.
2. Call the domain primitive (`createAnnouncement`, `createEvent`, `sendAiAssistedDirectChatMessage`, etc.).
3. On typed failure (`result.ok === false`): rollback CAS `confirmed → pending` via `ctx.updatePendingActionStatusFn` and return `NextResponse.json({ error, ... }, { status })`. Do **not** throw.
4. On success: CAS `confirmed → executed`, populate `result_entity_type` / `result_entity_id`, clear the draft session if applicable, insert the assistant-role confirmation message into `ai_messages`, run any best-effort side effects inside individual `try/catch` blocks with `aiLog("error", ...)` on failure, and return `NextResponse.json({ ok: true, ... })`.

If the domain primitive **throws** (DB timeout, unreachable service), the dispatcher lets the exception propagate. The outer `try/catch` in `handler.ts` catches it, attempts the rollback to `pending`, logs `rollback failed - action stranded in confirmed state` if the rollback itself fails, and re-throws so the caller sees a 5xx.

## The `return await` rule (critical)

In `handler.ts` the switch calls each dispatcher like this:

```ts
case "create_announcement":
  return await handleCreateAnnouncement(ctx, action, deps);
```

The `await` is **semantically required**, not stylistic. JavaScript `return somePromise` inside an async `try` block returns the promise synchronously — the promise's rejection escapes the surrounding `try/catch`. Without `await`, a throwing domain primitive bypasses the rollback path entirely, leaving the row stranded in `confirmed` until the 15-minute reaper sweeps it to `failed`.

`tests/routes/ai/pending-actions-handler.test.ts` has a regression test per dispatcher that constructs a handler with a throwing domain stub and asserts both the `confirmed` CAS and the `pending` rollback are observed. Reverting `return await` to `return` causes the test to fail deterministically. Do not "simplify" it away.

The bug was discovered during the `jobs` extraction (#127) after it silently shipped in the `announcements` (#125) and `events` (#126) extractions. The fix landed alongside the jobs extraction; regression tests cover all three older cases.

## Adding a new dispatcher

To extract the next inline case (or add a new `prepare_*` tool family that needs a confirm path):

1. Create `dispatchers/<domain>.ts` following the skeleton in any existing dispatcher. `announcements.ts` is the simplest template; `events.ts` shows the shape for a dispatcher with multiple best-effort side effects; `enterprise-invites.ts` shows how to carry the auth-bound supabase client.
2. Define `<Domain>DispatcherContext` (include `supabase` only if the dispatcher actually needs it) and `<Verb><Domain>DispatcherDeps`.
3. Export `handle<Verb><Domain>(ctx, action, deps)` with the contract above.
4. In `handler.ts`:
   - Add the import.
   - Replace the inline `case` body with `return await handle<Verb><Domain>(...)`.
   - Wire any new deps into `AiPendingActionConfirmRouteDeps` and the resolve-default block if this is a new primitive.
   - Remove any payload-type or library imports that are now only referenced inside the dispatcher.
5. Run `tests/routes/ai/pending-actions-handler.test.ts`. The 19 baseline characterization tests plus 2 regression tests must all pass unchanged. `tsc` and `eslint` must remain clean.
6. If the new dispatcher can throw from its primitive, add a regression test mirroring the existing "exception during write rolls back for create_X" cases.

## Non-goals

- The dispatcher layer is **not** a generic `executeMutation` HOF. That was deferred to Phase 3 of the Tier 1 plan (first edit-dispatcher). Until then every confirm path lives in its own file with its own CAS transitions. When the HOF arrives it should be adopted in one PR that covers every existing dispatcher at once, per the plan's pattern-consistency rule.
- Dispatchers do **not** call the outer try/catch for rollback. That still lives in `handler.ts`. This keeps the rollback behavior — and the reaper contract — observable in exactly one place.
- Dispatchers do **not** perform auth. `getAiOrgContext` runs once in `handler.ts` and the resulting `ctx` is what they receive. Permission checks for target entities belong in the domain primitive (`updateAnnouncement`, `softDeleteAnnouncement`, etc.), not here.

## References

- Phase 0.5 extractions: #125 (announcements), #126 (events), #127 (jobs + `return await` fix), #128 (remaining six).
- Full Tier 1 plan: `~/.claude/plans/i-want-you-to-quirky-sprout.md` (Deepening Addendum §A4 covers the dispatcher-layer architectural choices).
- Rollback / reaper contract: `src/lib/ai/pending-actions.ts` (`cleanupStrandedConfirmedActions`).
- CAS + error handling baseline: `docs/plans/2026-03-27-fix-ai-confirm-handler-race-and-error-handling-plan.md`.

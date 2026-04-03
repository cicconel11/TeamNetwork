---
title: "feat: Add prepare_event write tool to AI assistant"
type: feat
status: active
date: 2026-04-01
---

# feat: Add `prepare_event` Write Tool to AI Assistant

## Context

When users ask the AI agent to create calendar events (e.g., "create an event for Friday's meeting"), it responds that it's read-only. This is correct — the agent has `list_events` (read) but no write-preparation tool for events. Write tools already exist for job postings (`prepare_job_posting`) and discussion threads (`prepare_discussion_thread`) using a confirmation-gated pattern. This plan extends that same pattern to calendar events.

## Proposed Solution

Add a `prepare_event` tool following the identical two-phase confirmation flow:
1. **Prepare phase**: AI validates the draft, collects missing fields, creates a `pending_action` record
2. **Confirm phase**: User reviews in `PendingActionCard`, clicks Confirm → server executes the insert

**MVP scope**: Single non-recurring events only. No notifications, no specific-audience targeting, no recurrence. These can be added incrementally.

## Implementation Phases

### Phase 1: Schema & Server-Side Creation (2 new files)

**1a. New file: `src/lib/schemas/events-ai.ts`**

Create two Zod schemas mirroring `src/lib/schemas/jobs.ts:30-73`:

- `assistantEventDraftSchema` — all fields optional (draft-collecting state):
  - `title`, `description`, `start_date` (YYYY-MM-DD), `start_time` (HH:MM), `end_date`, `end_time`, `location`, `event_type`, `is_philanthropy`
- `assistantPreparedEventSchema` — required fields enforced:
  - `title` (required), `start_date` (required), `start_time` (required)
  - `event_type` (required, defaults applied at tool layer → `"general"`)
  - `is_philanthropy` (required, defaults → `false`)
  - `.refine()` for end > start validation (matching `src/lib/schemas/content.ts:84-98`)
- Export types: `AssistantEventDraft`, `AssistantPreparedEvent`

Reuse existing schemas from `src/lib/schemas/common.ts`: `safeString`, `optionalSafeString`, `dateStringSchema`, `timeStringSchema`, `eventTypeSchema`, etc.

**1b. New file: `src/lib/events/create-event.ts`**

Extract server-side event creation (currently inline in `src/app/[orgSlug]/events/new/page.tsx:255-267`):

```typescript
export interface CreateEventRequest {
  supabase: SupabaseClient;
  serviceSupabase: SupabaseClient;
  orgId: string;
  userId: string;
  input: AssistantPreparedEvent;
  orgSlug?: string | null;
}

export type CreateEventResult =
  | { ok: true; status: 201; event: { id: string; title: string }; eventUrl: string }
  | { ok: false; status: 400 | 403 | 500; error: string; details?: string[] };
```

Logic:
1. Validate input against `assistantPreparedEventSchema`
2. Combine `start_date` + `start_time` → ISO datetime (matching `page.tsx:213`)
3. Similarly combine `end_date` + `end_time` if both provided, else `null`
4. Insert into `events` table with `audience: "both"` (MVP default), `created_by_user_id: userId`
5. Return `{ ok: true, event, eventUrl: /${orgSlug}/events/${event.id} }`

### Phase 2: Tool Definition & Pending Action Types (3 file modifications)

**2a. Modify: `src/lib/ai/tools/definitions.ts`**

- Add `PrepareEventArgs` interface
- Add `prepare_event` to `TOOL_BY_NAME` with parameters: `title`, `description`, `start_date`, `start_time`, `end_date`, `end_time`, `location`, `event_type` (enum), `is_philanthropy` (boolean) — all optional
- Add `TOOL_BY_NAME.prepare_event` to `AI_TOOLS` array (line 303)

**2b. Modify: `src/lib/ai/pending-actions.ts`**

- Extend `PendingActionType`: add `"create_event"`
- Add `CreateEventPendingPayload` interface (extends `AssistantPreparedEvent` + `orgSlug`)
- Extend `PendingActionPayloadByType` with `create_event` mapping
- Add `"create_event"` case to `buildPendingActionSummary()`: `{ title: "Review event", description: "Confirm the drafted event before it is added to the calendar." }`

**2c. Modify: `src/lib/ai/draft-sessions.ts`**

- Import `AssistantEventDraft`
- Extend `DraftSessionPayloadByType` with `create_event: AssistantEventDraft`
- `DraftSessionType` auto-extends (it's defined as `PendingActionType`)

### Phase 3: Tool Execution (1 file modification)

**Modify: `src/lib/ai/tools/executor.ts`**

- Add `prepareEventSchema` (executor-local Zod schema, all fields optional + `.strict()`)
- Add to `ARG_SCHEMAS`: `prepare_event: prepareEventSchema`
- Define `REQUIRED_PREPARED_EVENT_FIELDS = ["title", "start_date", "start_time"]`
- Add `prepareEvent()` function following `prepareDiscussionThread()` pattern (lines 692-781):
  1. Require `ctx.threadId`
  2. Parse with `assistantEventDraftSchema`
  3. Default `event_type → "general"`, `is_philanthropy → false`
  4. Check missing required fields → return `{ state: "missing_fields", ... }`
  5. Parse with `assistantPreparedEventSchema`
  6. Look up org slug
  7. `createPendingAction()` with `actionType: "create_event"`
  8. Return `{ state: "needs_confirmation", pending_action: { ... } }`
- Add case to `executeToolCall` switch: `"prepare_event"` → `prepareEvent()`

### Phase 4: Intent Detection & Chat Handler Routing (1 file modification)

**Modify: `src/app/api/ai/[orgId]/chat/handler.ts`**

- Add `CREATE_EVENT_PROMPT_PATTERN` regex (after line 121):
  ```
  /(?:(?<!\w)(?:create|add|schedule|post|make|set\s+up)(?!\w)[\s\S]{0,120}\b(?:event|calendar event|meeting|gathering|social|fundraiser|game day)(?!\w)|(?<!\w)(?:event|calendar event|meeting|gathering|social|fundraiser|game day)(?!\w)[\s\S]{0,80}\b(?:create|add|schedule|post|make|set\s+up)(?!\w))/i
  ```
- Update `getPass1Tools()` (after line 717): when `CREATE_EVENT_PROMPT_PATTERN` matches → return `[AI_TOOL_MAP.prepare_event]`
- Update `getForcedPass1ToolChoice()` (line 740): add `"prepare_event"` to forced tool names
- Add `formatPrepareEventResponse()` function for deterministic response text
- Add `"prepare_event"` case to `formatDeterministicToolResponse()`
- Update `getToolNameForDraftType()`: `"create_event" → "prepare_event"`
- Add `extractEventDraftFromHistory()` for multi-turn draft field extraction
- Update `inferDraftTypeFromMessage()`: detect event creation patterns
- Update `inferDraftSessionFromHistory()`: add `create_event` branch
- Update `shouldContinueDraftSession()`: handle event ↔ job/discussion topic switches
- Update tool result handling block (~line 2383): include `"prepare_event"` in prepare-tool conditions

### Phase 5: Confirm Handler (1 file modification)

**Modify: `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts`**

- Import `createEvent` and `CreateEventPendingPayload`
- Add `createEvent` to deps interface and resolution
- Add `case "create_event"` block (before `default:` at line 269):
  - Cast payload as `CreateEventPendingPayload`
  - Call `createEventFn()`
  - On failure: rollback to `pending`, return error
  - On success: update to `executed` with `resultEntityType: "event"`, `resultEntityId: result.event.id`
  - Clear draft session
  - Insert confirmation message: `Created event: [${title}](/${orgSlug}/events/${id})`
  - Return `{ ok: true, event, actionId }`

### Phase 6: UI — PendingActionCard (1 file modification)

**Modify: `src/components/ai-assistant/PendingActionCard.tsx`**

Add event-specific rendering branch (restructure the existing binary if/else at line 51 to three branches):

```
discussion → existing rendering
create_event → Title, Date, Time, End Date, End Time, Location, Type, Description
job (default) → existing rendering
```

Extract additional values from payload: `start_date`, `start_time`, `end_date`, `end_time`, `event_type`.

## Files Summary

| File | Action | Purpose |
|---|---|---|
| `src/lib/schemas/events-ai.ts` | **New** | Draft + prepared Zod schemas |
| `src/lib/events/create-event.ts` | **New** | Server-side event insertion |
| `src/lib/ai/tools/definitions.ts` | Modify | Add `prepare_event` tool definition |
| `src/lib/ai/pending-actions.ts` | Modify | Add `create_event` action type + payload |
| `src/lib/ai/draft-sessions.ts` | Modify | Extend draft session types |
| `src/lib/ai/tools/executor.ts` | Modify | Add `prepareEvent()` function |
| `src/app/api/ai/[orgId]/chat/handler.ts` | Modify | Intent regex, tool routing, format, draft logic |
| `src/app/api/ai/[orgId]/pending-actions/[actionId]/confirm/handler.ts` | Modify | Add `create_event` execution case |
| `src/components/ai-assistant/PendingActionCard.tsx` | Modify | Event detail rendering in confirmation card |

## Key Design Decisions

1. **MVP scope**: Single non-recurring events only. No notifications, no specific-audience targeting. `audience` defaults to `"both"`. Recurring events are a natural follow-up.
2. **Required fields**: Only `title`, `start_date`, `start_time`. Everything else is optional or has defaults (`event_type → "general"`, `is_philanthropy → false`).
3. **No URL sourcing**: Unlike jobs (which can scrape application URLs), events have no external source to enrich from — simpler flow.
4. **Extracted creation function**: Moving event creation from inline client code to `src/lib/events/create-event.ts` enables both AI and future server-side usage.

## Verification

1. **Type check**: `npx tsc --noEmit` — all new types must be consistent
2. **Lint**: `npm run lint` — no new warnings
3. **Unit tests**: Add tests for:
   - Schema validation (draft partial, prepared complete, end > start rejection)
   - `prepareEvent()` executor (missing fields flow, needs_confirmation flow)
   - `createEvent()` server function (success, validation error)
   - Confirm handler `create_event` case
   - `CREATE_EVENT_PROMPT_PATTERN` regex (matches: "create an event", "schedule a meeting", "add a social event", "set up a fundraiser for Friday"; non-matches: "list events", "what events are coming up")
4. **Manual E2E**: In chat, send "create an event called Team Meeting on 2026-04-05 at 3pm in Room 101" → agent should collect fields → show PendingActionCard → Confirm → event appears in calendar

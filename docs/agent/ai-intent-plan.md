# AI Intent Routing & Surface Inference — Code Map

## Overview

Each incoming chat message flows through a lightweight intent router that classifies the message content and resolves an effective surface for context loading, caching, and tool selection. The system deliberately separates **thread surface** (stable, set at creation, used for UI grouping) from **message context_surface** (per-turn, content-inferred, determines what data the LLM sees). A small internal `TurnExecutionPolicy` layer then turns existing signals (`threadId`, surface routing, `intent_type`, cache eligibility) into deterministic runtime behavior for tools, RAG, context mode, cache lookup, and audit-only grounding checks. This is stabilization work, not a broader router redesign.

## File Map

### Source

| File | Purpose | Key Exports |
|---|---|---|
| `src/lib/ai/intent-router.ts` | Message classification and surface inference | `resolveSurfaceRouting()`, `AiIntent`, `SurfaceRoutingDecision` |
| `src/components/ai-assistant/route-surface.ts` | Client-side pathname-to-surface mapping | `routeToSurface()` |
| `src/lib/ai/context-builder.ts` | Surface-gated DB queries, token budget, prompt assembly | `buildPromptContext()`, `SURFACE_DATA_SOURCES` |
| `src/lib/ai/semantic-cache-utils.ts` | Surface-aware cache eligibility and TTLs | `checkCacheEligibility()`, `CACHE_TTL_HOURS` |
| `src/lib/ai/turn-execution-policy.ts` | Internal policy builder over existing routing + cache signals | `buildTurnExecutionPolicy()`, `TurnExecutionPolicy` |
| `src/lib/ai/message-normalization.ts` | Shared normalization used by routing and cache | `normalizeAiMessage()`, `normalizeAiMessageForExactMatch()` |
| `src/lib/schemas/ai-assistant.ts` | Canonical surface enum and request validation | `AiSurface`, `aiSurfaceEnum`, `sendMessageSchema` |
| `src/app/api/ai/[orgId]/chat/handler.ts` | Pipeline orchestrator — wires routing into the chat flow | `createChatPostHandler()` |

### Schema

| File | Purpose |
|---|---|
| `supabase/migrations/20260323000000_ai_message_context_surface.sql` | Adds `context_surface` column to `ai_messages`, updates `init_ai_chat` RPC to 9-param signature |
| `supabase/migrations/20260710100000_ai_audit_log_context_columns.sql` | Adds `context_surface`, `context_token_estimate` to `ai_audit_log` |

### Tests

| File | Coverage |
|---|---|
| `tests/ai-intent-router.test.ts` | Casual gate (greetings, thanks), keyword rerouting, greeting+question hybrid |
| `tests/routes/ai/chat-handler.test.ts` | Full pipeline: rerouting preserves thread surface, casual turns skip cache/RAG, cacheable static explainers still use `shared_static`, out-of-scope governance asks bypass tools/RAG |
| `tests/ai-turn-execution-policy.test.ts` | Execution policy profiles, precedence, and narrow out-of-scope gating |
| `tests/ai-panel-route-surface.test.ts` | Route-to-surface mapping: all prefixes, nested routes, partial-match rejection, edge cases (26 tests) |

## Data Flow

```
Browser URL (/my-org/members)
  └─ routeToSurface(pathname)         → surface = "members"  (client-side)
       │
       ▼
POST /api/ai/{orgId}/chat { message, surface: "members", ... }
  └─ sendMessageSchema.parse()        validates body
       │
       ▼
resolveSurfaceRouting(message, surface)
  ├─ normalizeMessage()               NFC, lowercase, strip zero-width chars
  ├─ isCasualMessage()                → skipRetrieval: true/false
  ├─ countMatches() × 3 surfaces     keyword scoring
  └─ returns SurfaceRoutingDecision
       ├─ effectiveSurface            may differ from requested surface
       ├─ intent                      e.g. "members_query", "events_query"
       ├─ confidence                  "high" (single winner) / "low" (no matches)
       ├─ rerouted                    true if effectiveSurface !== requested
       └─ skipRetrieval               true for casual messages
            │
            ▼
init_ai_chat RPC
  p_surface = "members"              → thread.surface (immutable)
  p_context_surface = effectiveSurface → message.context_surface (per-turn)
  p_intent = resolvedIntent           → message.intent
            │
            ▼
  ┌─ checkCacheEligibility(effectiveSurface)
  │
  ├─ buildTurnExecutionPolicy(...)
  │    ├─ profile: follow_up | casual | static_general | live_lookup | out_of_scope
  │    ├─ toolPolicy
  │    ├─ retrievalPolicy
  │    ├─ contextPolicy
  │    └─ cachePolicy
  │
  ├─ if retrievalPolicy = allow: retrieveRelevantChunks()
  │    → ragChunks (additive, non-blocking)
  │
  ├─ buildPromptContext({ surface: effectiveSurface, ragChunks, now, timeZone, contextMode })
  │    → SURFACE_DATA_SOURCES[effectiveSurface] gates DB queries
  │    → token budget trims sections by priority
  │    → trusted system prompt includes current local date/time
  │
  ├─ resolve pass-1 tools from execution policy
  │    → `none` for casual / static_general / out_of_scope
  │    → surface-gated read tools for live_lookup / follow_up
  │
  └─ Stream LLM
       ├─ if successful pass-2 tool summary exists: verifyToolBackedResponse(...)
       └─ logAiRequest({ intent, intentType, contextSurface, ragChunkCount })
```

## Intent Router Algorithm

`resolveSurfaceRouting(message, requestedSurface)` performs four steps:

### Step 1 — Normalize
```
NFC → lowercase → strip zero-width chars (U+200B–U+200D, U+FEFF) → collapse whitespace
```

### Step 2 — Casual Gate
Match against `CASUAL_MESSAGE_PATTERNS`:
- Greetings: `hey`, `hi`, `hello`, `howdy`, `yo`, `sup`, `what's up`
- Acknowledgements: `ok`, `okay`, `got it`, `understood`, `makes sense`, `i see`, `cool`
- Farewells: `bye`, `goodbye`, `see you`, `later`, `cya`, `peace`
- Thanks: `thanks`, `thank you`, `thx`, `ty`, `appreciate it`

These are exact-match checks against the full normalized message. If the entire message is a casual phrase, `skipRetrieval: true` and pass-1 tool attachment is suppressed. A hybrid like `"hey, what events are coming up?"` fails the exact match and proceeds to keyword scoring normally.

### Step 3 — Keyword Scoring
Count word-boundary regex matches (`(?<!\w)keyword(?!\w)`) per surface:

| Surface | Keywords |
|---|---|
| `members` | member, members, alumni, parent, parents, roster, directory, mentorship |
| `analytics` | analytics, metric, metrics, donation, donations, fundraising, revenue, expense, expenses, budget, budgets, financial, finance |
| `events` | event, events, calendar, schedule, schedules, meeting, meetings, ceremony, game, games, rsvp |

### Step 4 — Decision

| Condition | Result |
|---|---|
| Zero matches | `effectiveSurface = requestedSurface`, `confidence: "low"` |
| Single highest scorer | `effectiveSurface = winner`, `confidence: "high"`, `rerouted` if winner differs |
| Tie (equal top scores) | `intent: "ambiguous_query"`, falls back to `requestedSurface` |

## Key Design Decisions

1. **Thread surface is immutable; message context_surface is per-turn.** Thread grouping stays stable for UI (thread list filtering, navigation). Each message independently records its effective surface, enabling per-turn analytics.

2. **The execution policy is internal-only.** It does not replace `intent_type`, add schema fields, or create new assistant surfaces. It just centralizes runtime choices that were previously split across handler branches.

3. **Casual turns are now intentionally non-cacheable.** Even when a short first-turn `general` message would pass pure cache eligibility checks, the execution policy skips cache lookup and write for low-value casual turns.

4. **RAG is always non-blocking, and sometimes intentionally skipped.** Retrieval errors are caught and logged; the request continues without chunks. The execution policy skips RAG for casual turns, static `general` explainers, and narrow out-of-scope governance-document asks.

5. **`init_ai_chat` is service-role only.** Users cannot inject arbitrary `context_surface` or `intent` values. The RPC is restricted to `service_role` via explicit `REVOKE`/`GRANT`.

6. **Keyword lists are static and hardcoded.** Adding a new surface requires updating `aiSurfaceEnum` in the schema, `SURFACE_KEYWORDS` in intent-router.ts, `SURFACE_PREFIXES` in route-surface.ts, and `SURFACE_DATA_SOURCES` in context-builder.ts.

7. **Normalization is shared.** Routing and cache utilities now use the same normalization helper, avoiding silent drift between surface routing and cache-key derivation.

## Related Docs

- **[intent-type-taxonomy.md](intent-type-taxonomy.md)** — Second classification axis: intent *type* (`knowledge_query`, `action_request`, `navigation`, `casual`) — what the user wants, orthogonal to the surface routing documented here
- **[chat-pipeline-codemap.md](chat-pipeline-codemap.md)** — Full pipeline orchestration, token budget, section priorities
- **[semantic-cache-codemap.md](semantic-cache-codemap.md)** — Cache eligibility rules, freshness policy, and no-RAG-on-cacheable-path contract

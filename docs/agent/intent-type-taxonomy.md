# Intent Type Taxonomy — Code Map

## Overview

The AI assistant classifies every incoming message along two orthogonal axes:

| Axis | Question it answers | Column | Values |
|------|-------------------|--------|--------|
| **Surface intent** (existing) | *Where* to route — which data context to load | `ai_messages.intent` | `general_query`, `members_query`, `analytics_query`, `events_query`, `ambiguous_query` |
| **Intent type** (new) | *What kind* of request — what the user wants to accomplish | `ai_messages.intent_type` | `knowledge_query`, `action_request`, `navigation`, `casual` |

The two axes compose freely. Example classifications:

| Message | Surface intent | Intent type |
|---------|---------------|-------------|
| "How many members do we have?" | `members_query` | `knowledge_query` |
| "Create a new event for Friday" | `events_query` | `action_request` |
| "Show me the analytics dashboard" | `analytics_query` | `navigation` |
| "Thanks!" | `general_query` | `casual` |
| "Add John to the roster" | `members_query` | `action_request` |
| "Where is the donations page?" | `analytics_query` | `navigation` |

## Intent Type Definitions

### `casual`
Greetings, acknowledgements, farewells, and thanks. These messages don't carry an information need or action request. The execution policy skips RAG, disables pass-1 tools, and intentionally skips cache lookup/write for these low-value turns.

Detected via exact-match regex against the full normalized message (same `isCasualMessage()` that existed before, now promoted to a labeled type).

### `action_request`
The user wants something *done* — create, delete, send, invite, schedule, etc. Detected by matching imperative action verbs against the normalized message.

Keywords: `create`, `add`, `delete`, `remove`, `update`, `send`, `invite`, `schedule`, `change`, `set`, `assign`, `cancel`, `approve`, `reject`, `make`, `edit`, `move`, `rename`, `archive`, `unarchive`, `restore`, `enable`, `disable`, `reset`, `upload`, `post`, `publish`.

**Note**: `action_request` is classified and logged but not yet executed differently at the product level. Runtime behavior still flows through the internal execution-policy layer, which currently treats `action_request` and `navigation` as `live_lookup` turns unless future write/navigation features are added.

### `navigation`
The user wants to go somewhere or find a page. Detected by phrase-level regex patterns.

Patterns: `go to`, `show me`, `take me to`, `navigate to`, `open`, `where is`, `where can I find`, `find the page`, `link to`.

### `knowledge_query`
Default fallback — the user is asking a question or seeking information. Any message that isn't casual, action, or navigation falls here.

## Classification Algorithm

Priority order (first match wins):

```
1. casual         → isCasualMessage() — exact full-message match
2. action_request → any ACTION_KEYWORDS word-boundary match
3. navigation     → any NAVIGATION_PATTERNS phrase match
4. knowledge_query → default
```

Casual is checked first because it's a full-message match (e.g., "ok" is casual, not an action). This means "hey, create an event" is NOT casual (fails the exact-match gate) and correctly falls through to `action_request`.

## File Map

### Source

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/lib/ai/intent-router.ts` | Two-axis classification (surface + type) | `resolveSurfaceRouting()`, `AiIntent`, `AiIntentType`, `SurfaceRoutingDecision` |
| `src/app/api/ai/[orgId]/chat/handler.ts` | Wires both axes into the pipeline | `createChatPostHandler()` |
| `src/lib/ai/audit.ts` | Logs `intent_type` to audit table | `logAiRequest()` |

### Schema

| File | Purpose |
|------|---------|
| `supabase/migrations/20260713000000_ai_intent_type.sql` | Adds `intent_type` column to `ai_messages` (with CHECK) and `ai_audit_log`; consolidates `init_ai_chat` RPC to 10-param version |

### Tests

| File | Coverage |
|------|----------|
| `tests/ai-intent-router.test.ts` | All four intent types, priority ordering, hybrid messages (greeting + action, greeting + nav) |
| `tests/routes/ai/chat-handler.test.ts` | Pipeline integration: `intent_type` passed through RPC, stored on messages, logged to audit, and influences execution policy |

## Data Flow

```
resolveSurfaceRouting(message, surface)
  ├─ normalizeMessage()
  ├─ classifyIntentType(message, normalized)
  │    ├─ isCasualMessage()  → "casual"         (full-message exact match)
  │    ├─ hasActionKeywords()→ "action_request"  (word-boundary keyword match)
  │    ├─ hasNavigationPattern() → "navigation"  (phrase regex match)
  │    └─ default            → "knowledge_query"
  │
  ├─ countMatches() × 3 surfaces  (keyword scoring — unchanged)
  │
  └─ returns SurfaceRoutingDecision
       ├─ intent            e.g. "members_query"      → ai_messages.intent
       ├─ intentType        e.g. "action_request"     → ai_messages.intent_type
       ├─ effectiveSurface  e.g. "members"            → ai_messages.context_surface
       ├─ skipRetrieval     true when intentType = "casual"
       └─ confidence, rerouted, inferredSurface (unchanged)
            │
            ▼
  buildTurnExecutionPolicy(...)
    → uses intentType + threadId + cache eligibility to choose
      cache/tool/retrieval/context/grounding behavior
            │
            ▼
  init_ai_chat RPC
    p_intent = "members_query"
    p_intent_type = "action_request"
    p_context_surface = "members"
            │
            ▼
  insertAssistantMessage({ intent_type: resolvedIntentType })
            │
            ▼
  logAiRequest({ intentType: resolvedIntentType })
    → ai_audit_log.intent_type = "action_request"
```

## Labeled Data Pipeline

Every message now has both `intent` and `intent_type` stored. This enables:

1. **Analytics**: Dashboard queries like `SELECT intent_type, COUNT(*) FROM ai_messages GROUP BY intent_type` to understand what users are trying to do.
2. **Action Executor routing**: When `action_request` messages should trigger tool calls proactively (rather than relying on the LLM to decide), the `intent_type` label is already present.
3. **Navigation features**: When deep-linking from AI responses is implemented, `navigation` labels identify the training data.
4. **Execution-policy hardening**: `intent_type` now contributes to deterministic runtime behavior without changing the persisted taxonomy or adding new schema fields.

## Related Docs

- **[ai-intent-plan.md](ai-intent-plan.md)** — Surface routing algorithm, keyword lists, data flow (surface axis)
- **[chat-pipeline-codemap.md](chat-pipeline-codemap.md)** — Full pipeline orchestration including tool calling two-pass loop

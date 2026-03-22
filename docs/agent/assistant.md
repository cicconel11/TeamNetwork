# AI Assistant — Architecture Overview

## Summary

The AI assistant is an admin-only, org-scoped chat feature. Admins open a slide-out panel, ask questions about their organization, and receive streaming LLM responses grounded in live org data. Conversations are persisted as threads and messages, with full audit logging and an exact-hash semantic cache for deduplication.

## Tech Stack

| Layer | Technology |
|---|---|
| LLM | z.ai (OpenAI-compatible API via `glm-5` model) |
| Backend | Next.js 14 App Router, Node.js runtime |
| Database | Supabase (PostgreSQL + RLS) |
| Auth | Supabase Auth — admin role required |
| Streaming | Server-Sent Events (SSE) |
| Validation | Zod schemas (`src/lib/schemas/ai-assistant.ts`) |
| UI | React 18 client components, Tailwind CSS |
| Markdown | `react-markdown` + `remark-gfm` |

## Subsystem Map

| Subsystem | Codemap | Description |
|---|---|---|
| Chat Pipeline | [chat-pipeline-codemap.md](chat-pipeline-codemap.md) | Request validation, auth, context building, LLM streaming, message persistence, audit |
| Semantic Cache | [semantic-cache-codemap.md](semantic-cache-codemap.md) | Exact-hash prompt deduplication, TTL expiry, daily cron purge |
| Thread Management | [threads-codemap.md](threads-codemap.md) | CRUD for threads and messages, cursor pagination, soft-delete |
| UI Panel | [ui-panel-codemap.md](ui-panel-codemap.md) | Slide-out panel, SSE stream consumer, thread/message display |

## Database Tables

Four migrations create all AI-related schema:

| Migration | Tables / Objects |
|---|---|
| `20260319000000_ai_assistant_tables.sql` | `ai_threads`, `ai_messages`, `ai_audit_log` + RLS policies + indexes |
| `20260321100001_ai_semantic_cache.sql` | `ai_semantic_cache` + indexes + `purge_expired_ai_semantic_cache()` RPC + `vector` extension |
| `20260321110000_fix_ai_messages_rls_integrity.sql` | Composite FK on `ai_messages`, restored thread-ownership RLS invariant |
| `20260322000000_ai_threads_updated_at_trigger.sql` | `ai_threads_updated_at` trigger (reuses existing `update_updated_at_column()`) |

### Table Summary

| Table | Purpose | RLS |
|---|---|---|
| `ai_threads` | Conversation containers scoped to user + org + surface | User-scoped (own threads, `deleted_at IS NULL`) |
| `ai_messages` | Individual chat turns within a thread | Via thread ownership (EXISTS subquery) |
| `ai_audit_log` | Every AI request logged with latency, tokens, cache status | Service-role only (no user policies) |
| `ai_semantic_cache` | Cached LLM responses keyed by prompt hash | Service-role only (no user policies) |

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ZAI_API_KEY` | Yes | LLM provider API key |
| `ZAI_MODEL` | No | Model override (default: `glm-5`) |
| `DISABLE_AI_CACHE` | No | Set `"true"` to disable semantic cache |
| `CRON_SECRET` | Yes (for purge) | Auth header for the cache purge cron endpoint |

## API Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/ai/[orgId]/chat` | Send message, receive SSE stream |
| GET | `/api/ai/[orgId]/threads` | List threads (cursor-paginated) |
| DELETE | `/api/ai/[orgId]/threads/[threadId]` | Soft-delete a thread |
| GET | `/api/ai/[orgId]/threads/[threadId]/messages` | List messages in a thread |
| GET | `/api/cron/ai-cache-purge` | Daily cron: hard-delete expired cache rows |

## Access Control

- **Admin-only**: Every API route calls `getAiOrgContext()` which validates the user has `admin` role in the specified org.
- **Fail-closed**: If the role query errors, returns 503 (never silently grants access).
- **Thread ownership**: `resolveOwnThread()` normalizes all inaccessible cases to 404 so thread existence is never leaked.
- **RLS**: Database-level enforcement ensures users can only access their own threads/messages.

## Remaining Work

### 1. Hydration error (mitigated)
The `AIPanelContext` uses an `isMounted` ref and returns `isOpen: false` until after first client render. The `ssr: false` dynamic import in the layout also suppresses server-side rendering. Needs verification that the fix is fully resolved across all edge cases.

### 2. Narrow-panel formatting
The panel is 384px wide (`sm:w-96`). The system prompt includes a `NARROW_PANEL_POLICY` instructing the LLM to avoid tables and wide layouts, but complex markdown tables may still overflow. The `AssistantMessageContent` component wraps tables in `overflow-x-auto` containers as a fallback.

### 3. `window.confirm` for thread delete
`ThreadList` uses `window.confirm("Delete this conversation?")` which is inconsistent with the app's dialog/modal patterns used elsewhere.

### 4. Surface hardcoded to "general"
`AIPanel.handleSend` always passes `surface: "general"`. The schema supports `general`, `members`, `analytics`, and `events`, but no UI exists to switch between surfaces.

### 5. No persistent panel preference
`AIPanelContext` calls `localStorage.removeItem(AI_PANEL_PREFERENCE_KEY)` on mount, so panel open/close state is never persisted across page navigations. The `resolveInitialAIPanelOpen` function exists but only gates on `isAdmin` + `isDesktop`.

### 6. No UI component tests
The backend has ~126 test cases across 17+ test files. The UI components (`AIPanel`, `MessageList`, `ThreadList`, `MessageInput`, `AssistantMessageContent`, `AIEdgeTab`) have 0 component/integration tests. Only pure utility functions (`panel-state.ts`, `panel-preferences.ts`, `thread-date.ts`) are tested.

### 7. Vector similarity cache (deferred to v2)
The `20260321100001` migration creates the `vector` extension, but all cache lookups use exact SHA-256 hash matching. Embedding-based semantic similarity is deferred to a future version.

### 8. Migration filename mismatch (fixed)
The contract test and semantic cache codemap previously referenced `20260321100000` instead of the actual filename `20260321100001`. Fixed in this PR.

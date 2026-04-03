# AI Assistant — Architecture Overview

## Summary

The AI assistant is an admin-only, org-scoped chat system exposed through the org chat panel at `src/app/[orgSlug]/chat/*` and backed by App Router API endpoints under `src/app/api/ai/[orgId]/*`. Admins can ask questions, navigate to relevant app pages, and prepare a small set of assistant-mediated writes. The runtime persists conversations as threads and messages, logs each turn to `ai_audit_log`, applies a conservative exact-match semantic cache for narrow first-turn `general` prompts, and can augment live turns with route-aware context, retrieval, and server tools.

The current server structure is split into thin `route.ts` entrypoints and testable `handler.ts` factories for chat, thread, message, and pending-action endpoints. The main chat handler orchestrates auth, rate limiting, message safety, idempotency, surface and intent routing, execution-policy decisions, optional RAG retrieval, prompt construction, streaming model output over SSE, deterministic tool execution, grounding verification, persistence, and audit logging. For simple live-lookups, the route now short-circuits to single-tool `tool_first` turns with deterministic in-route formatting for `list_members`, `list_events`, `list_announcements`, `list_discussions`, `list_job_postings`, `get_org_stats`, `suggest_connections`, `find_navigation_targets`, and single-file schedule extraction states, which avoids an unnecessary second model pass on straightforward roster, events, alumni, donation, and schedule-import questions.

The shipped tool surface includes live read tools for members, events, announcements, discussions, jobs, org stats, connection suggestions, and navigation targets, plus confirmation-gated write-preparation tools for job postings, discussion threads, and calendar events. Those write flows now surface a structured `pending_action` SSE event (or `pending_actions_batch` for multi-event requests), render review cards in the panel UI, and execute only after explicit confirm or cancel requests against dedicated pending-action routes. Batch event creation uses a dedicated `prepare_events_batch` tool that validates each event individually and creates separate pending actions, with a batch confirmation UI that supports confirm/cancel all or per-event controls. Multi-turn job/discussion/event drafting is now backed by a persisted draft-session record per thread, so when the assistant asks for missing fields the next reply can continue the same write flow without restating the original create intent.

The panel UI is route-aware and now includes per-surface starter prompts, persisted active-thread selection, live tool status labels, and the pending-action review card. Prompt construction also receives the client pathname and attached tool list as untrusted context, while the execution policy can shift between `full`, `shared_static`, and `tool_first` context modes depending on the turn. Uploaded schedule images remain on Z.AI, but they now use a dedicated vision-model selector instead of the default text chat model, and the chat route renders deterministic recovery copy for single-file extraction failures or empty results instead of relying on pass-2 freeform prose. The chat route also now degrades more safely around duplicated or partially-finished turns: when an idempotent replay finds the original user message before the assistant reply exists, it returns a recoverable `409` instead of surfacing a replay error, and existing-thread history failures fall back to the current turn instead of aborting the request. For Falkor-backed connection suggestions, graph setup, and sync details, see `docs/agent/falkor-people-graph.md`.

## Tech Stack

| Layer | Technology |
|---|---|
| LLM | z.ai (OpenAI-compatible API via `glm-5` for chat/text and `ZAI_IMAGE_MODEL` for schedule-image extraction) |
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
| Semantic Cache | [semantic-cache-codemap.md](semantic-cache-codemap.md) | Exact-hash prompt deduplication, 12h general TTL, hourly bounded purge |
| Thread Management | [threads-codemap.md](threads-codemap.md) | CRUD for threads and messages, cursor pagination, soft-delete |
| UI Panel | [ui-panel-codemap.md](ui-panel-codemap.md) | Slide-out panel, SSE stream consumer, thread/message display, pending-action review |

## Database Tables

Eight migrations create all AI-related schema:

| Migration | Tables / Objects |
|---|---|
| `20260319000000_ai_assistant_tables.sql` | `ai_threads`, `ai_messages`, `ai_audit_log` + RLS policies + indexes |
| `20260321100001_ai_semantic_cache.sql` | `ai_semantic_cache` + indexes + `purge_expired_ai_semantic_cache()` RPC + `vector` extension |
| `20260321110000_fix_ai_messages_rls_integrity.sql` | Composite FK on `ai_messages`, restored thread-ownership RLS invariant |
| `20260322000000_ai_threads_updated_at_trigger.sql` | `ai_threads_updated_at` trigger (reuses existing `update_updated_at_column()`) |
| `20260727000000_ai_pending_actions.sql` | `ai_pending_actions` + RLS + indexes for confirmation-gated assistant writes |
| `20260728000000_ai_draft_sessions.sql` | `ai_draft_sessions` for persisted multi-turn job/discussion draft continuation |
| `20260402120000_ai_schedule_uploads_bucket.sql` | Private `ai-schedule-uploads` storage bucket + INSERT/SELECT RLS policies |
| `20260402123000_ai_schedule_uploads_allow_images.sql` | Backfills image MIME types on existing buckets |
| `20260403120000_ai_schedule_uploads_auth_delete.sql` | Authenticated DELETE RLS policy for schedule uploads |

### Table Summary

| Table | Purpose | RLS |
|---|---|---|
| `ai_threads` | Conversation containers scoped to user + org + surface | User-scoped (own threads, `deleted_at IS NULL`) |
| `ai_messages` | Individual chat turns within a thread | Via thread ownership (EXISTS subquery) |
| `ai_audit_log` | Every AI request logged with latency, tokens, cache status | Service-role only (no user policies) |
| `ai_semantic_cache` | Cached LLM responses keyed by prompt hash | Service-role only (no user policies) |
| `ai_pending_actions` | Server-owned pending confirmations for assistant write actions | User + org scoped; admins can only access their own actions |
| `ai_draft_sessions` | Active per-thread draft state for assistant job/discussion continuation | Service-role only (no user policies) |

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ZAI_API_KEY` | Yes | LLM provider API key |
| `ZAI_MODEL` | No | Model override (default: `glm-5`) |
| `ZAI_IMAGE_MODEL` | No | Vision-model override for uploaded schedule images (default: `glm-5v-turbo`) |
| `DISABLE_AI_CACHE` | No | Set `"true"` to disable semantic cache |
| `CRON_SECRET` | Yes (for purge) | Auth header for the cache purge cron endpoint |

## API Routes

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/ai/[orgId]/chat` | Send message, receive SSE stream |
| POST | `/api/ai/[orgId]/pending-actions/[actionId]/confirm` | Confirm a structured assistant action and execute the server-owned write |
| POST | `/api/ai/[orgId]/pending-actions/[actionId]/cancel` | Cancel a structured assistant action before execution |
| GET | `/api/ai/[orgId]/threads` | List threads (cursor-paginated) |
| DELETE | `/api/ai/[orgId]/threads/[threadId]` | Soft-delete a thread |
| GET | `/api/ai/[orgId]/threads/[threadId]/messages` | List messages in a thread |
| POST | `/api/ai/[orgId]/pending-actions/cleanup` | Best-effort cleanup for expired or abandoned pending actions |
| POST | `/api/ai/[orgId]/upload-schedule` | Upload a schedule file (PDF/image) for AI extraction |
| DELETE | `/api/ai/[orgId]/upload-schedule` | Delete a pending schedule upload |
| GET | `/api/cron/ai-cache-purge` | Hourly cron: drain expired cache rows in bounded batches |

## Access Control

- **Admin-only**: Every API route calls `getAiOrgContext()` which validates the user has `admin` role in the specified org.
- **Fail-closed**: If the role query errors, returns 503 (never silently grants access).
- **Thread ownership**: `resolveOwnThread()` normalizes all inaccessible cases to 404 so thread existence is never leaked.
- **RLS**: Database-level enforcement ensures users can only access their own threads/messages.

## Remaining Work

### 1. Narrow-panel formatting
The panel is 384px wide (`sm:w-96`). The system prompt includes a `NARROW_PANEL_POLICY` instructing the LLM to avoid tables and wide layouts, but complex markdown tables may still overflow. The `AssistantMessageContent` component wraps tables in `overflow-x-auto` containers as a fallback.

### 2. `window.confirm` for thread delete
`ThreadList` uses `window.confirm("Delete this conversation?")` which is inconsistent with the app's dialog/modal patterns used elsewhere.

### 3. Surface picker is still implicit
The panel now derives `surface` from the current route instead of hardcoding `"general"`, but there is still no explicit user-facing surface switcher.

### 4. Write-action parity is partial
The assistant now supports two confirmation-gated write paths: jobs and top-level discussion threads. Broader write parity for events, announcements, role changes, replies, and other mutations is still not implemented.

### 5. Discussion and job reads are live, and both now have shipped create flows
`list_discussions` and `list_job_postings` are both live tools now, so those prompts can emit `tool_status` events and return deterministic tool-backed answers. The shipped assistant mutations are the confirmation-gated `prepare_job_posting` and `prepare_discussion_thread` flows.

### 6. UI integration coverage is still light
The UI no longer has zero coverage: utility and stream-level tests now cover route-surface inference, toggle visibility, message list behavior, SSE parsing, SSR safety, and panel state helpers. But there are still no full React integration tests for the end-to-end pending-action review flow, optimistic thread switching, or panel view transitions.

### 7. `get_org_stats` is still the slowest deterministic read path
Simple roster and event questions now take the fast single-tool path, but full org snapshots still depend on the aggregate `get_org_stats` query. The remaining latency on donation / alumni / top-level metrics prompts is now more likely to come from the stats query itself than from chat orchestration.

### 8. Vector similarity cache (deferred to v2)
The `20260321100001` migration creates the `vector` extension, but all cache lookups use exact SHA-256 hash matching. Embedding-based semantic similarity is deferred to a future version.

### 9. Docs are codemap-heavy and need periodic refresh
The agent docs are now reasonably aligned again, but the implementation moves quickly across `handler.ts`, tool definitions, and panel state. Future agent work should keep these codemaps in sync when route structure, pending-action flows, or tool inventory changes.

## v2 Roadmap — Research-Backed Enhancements

The following features are deferred from v1 tool calling. Each is mapped to the relevant research paper for implementation guidance.

### People Connection Graph + Learned Ranking
- **What:** Extend the shipped `suggest_connections` feature from deterministic graph-based ranking to post-launch learned ranking once admin interaction data exists.
- **Design:** V1 already ships a single-org Falkor people graph for members + alumni, deterministic weighting, graph freshness metadata, and SQL fallback parity. Future work should instrument accept / dismiss / acted-on outcomes, evaluate `node2vec` as the first learned-ranking baseline, and then evaluate `GraphSAGE` for inductive embeddings once unseen-person cold start matters.

### Write Actions + Safety Gates
- **Paper:** ILION — Deterministic Pre-Execution Safety Gates (`2603.13247`)
- **What:** Add write tools (create_event, send_announcement, update_member_role) with a deterministic BLOCK/ALLOW gate before execution
- **Design:** Rule-based gate over action metadata (table, operation, scope). Any destructive or broadcast action requires explicit user confirmation via SSE `pending_action` event. Full audit trail for every BLOCK/ALLOW decision.

### Parallel Tool Execution
- **Paper:** LLM Compiler for Parallel Function Calling (`2312.04511`)
- **What:** Planner → DAG of tasks → concurrent execution when dependencies allow
- **Design:** Extend the tool loop to accept multiple tool calls per LLM turn. Execute independent tools via `Promise.all`. Dependent tools wait via `$id` reference resolution.

### Output Validation / Hallucination Detection
- **Paper:** NeMo Guardrails (`2310.10501`), LettuceDetect (`2502.17125`), FACTOID (`2403.19113`)
- **What:** Richer entailment and non-tool hallucination checks beyond the shipped deterministic verifier
- **Design:** The current system already buffers tool-backed pass-2 prose and runs `verifyToolBackedResponse()` before emitting it. Future work can extend this from deterministic field checks to broader entailment-style validation for more answer shapes and non-tool responses.

### Deeper Intent-Aware Tool Selection
- **Paper:** Arch-Router (`2506.16655`), LLM Routing Survey (`2502.00409`)
- **What:** Extend the current surface-aware tool selection to incorporate richer behavior for `intent_type` such as proactive action handling and navigation-aware responses.
- **Design:** The current implementation already filters pass-1 tools by `effectiveSurface` and skips tools for exact casual turns. Future work would let `action_request` and `navigation` influence execution strategy without replacing the surface router.

### Vector Semantic Cache
- **Paper:** VectorQ — Adaptive Semantic Prompt Caching (`2502.03771`), Domain-Specific Embeddings (`2504.02268`)
- **What:** Upgrade exact-match SHA-256 cache to embedding similarity lookup
- **Design:** pgvector extension already enabled. Generate embeddings on cache write, use adaptive cosine threshold per-surface for cache hits. Domain-tuned embeddings outperform general models.

### Data Analyst (SQL Generation)
- **Paper:** Text-to-SQL Survey (`2410.06011`), APEX-SQL (`2602.16720`), TrustSQL (`2403.15879`)
- **What:** Let admins ask ad-hoc data questions ("donation trend by month", "members who joined after January")
- **Design:** Schema-aware SQL generation with read-only sandbox. Must support abstaining from infeasible queries (TrustSQL pattern). LIDA pipeline (`2303.02927`) for chart generation.

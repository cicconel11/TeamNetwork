# Thread Management — Code Map

## Overview

Thread management provides CRUD operations for AI conversation threads and their messages. Threads are scoped to a user + org + surface. All routes require admin auth, use RLS-enforced queries for data access, and validate thread ownership via `resolveOwnThread()` before any read or write. Soft-delete is used for thread removal.

## File Map

| File | Purpose | Key Exports (line) |
|---|---|---|
| `src/lib/ai/thread-resolver.ts` | Thread ownership validation — normalizes all failures to 404 | `resolveOwnThread` (L11), `ThreadResolution` type (L7) |
| `src/app/api/ai/[orgId]/threads/route.ts` | Thin entrypoint that exports `GET` | `GET` |
| `src/app/api/ai/[orgId]/threads/handler.ts` | GET handler factory for cursor-paginated thread listing | `createAiThreadsGetHandler` |
| `src/app/api/ai/[orgId]/threads/[threadId]/route.ts` | Thin entrypoint that exports `DELETE` | `DELETE` |
| `src/app/api/ai/[orgId]/threads/[threadId]/handler.ts` | DELETE handler factory for thread soft-delete | `createAiThreadDeleteHandler` |
| `src/app/api/ai/[orgId]/threads/[threadId]/messages/route.ts` | Thin entrypoint that exports `GET` | `GET` |
| `src/app/api/ai/[orgId]/threads/[threadId]/messages/handler.ts` | GET handler factory for thread message reads | `createAiThreadMessagesGetHandler` |
| `src/lib/schemas/ai-assistant.ts` | `listThreadsSchema` — surface filter, limit, cursor validation | `listThreadsSchema` (L34) |
| `src/lib/pagination/cursor.ts` | Generic cursor encoding/decoding and query helpers | `decodeCursor`, `applyCursorFilter`, `buildCursorResponse` |

## API Contract

### GET `/api/ai/[orgId]/threads`

List threads for the authenticated admin user.

| Parameter | Source | Type | Default | Description |
|---|---|---|---|---|
| `surface` | query | `"general" \| "members" \| "analytics" \| "events"` | (all) | Filter by surface |
| `limit` | query | `1–50` | `20` | Page size |
| `cursor` | query | string | (none) | Opaque cursor for next page |

**Response** (`200`):
```json
{
  "data": [
    { "id": "uuid", "title": "string|null", "surface": "string", "created_at": "iso", "updated_at": "iso" }
  ],
  "nextCursor": "string|null"
}
```

**Errors**: `400` (invalid params/cursor), `401` (unauthenticated), `403` (not admin), `429` (rate limited), `500` (query failure)

### DELETE `/api/ai/[orgId]/threads/[threadId]`

Soft-delete a thread (sets `deleted_at` and `updated_at` to current timestamp).

**Response** (`200`): `{ "success": true }`

**Errors**: `404` (not found / not owned), `401`, `403`, `429`, `500`

### GET `/api/ai/[orgId]/threads/[threadId]/messages`

List all messages in a thread, ordered by `created_at` ascending.

**Response** (`200`):
```json
{
  "messages": [
    { "id": "uuid", "role": "user|assistant|system", "content": "string|null", "intent": "string|null", "status": "string", "created_at": "iso" }
  ]
}
```

**Errors**: `404` (thread not found / not owned), `401`, `403`, `429`, `500`

## Current Structure

Thread APIs now follow the same split used by the chat route:

1. `route.ts` files stay intentionally thin and only export the Next.js handler.
2. `handler.ts` files contain the auth, validation, and Supabase logic.
3. `resolveOwnThread()` remains the shared ownership gate for any thread-specific read or write.

This keeps route wiring simple while making the actual thread logic easier to unit test in isolation.

## Cursor Pagination

Thread listing uses keyset pagination via the shared `src/lib/pagination/cursor.ts` module:

1. Query fetches `limit + 1` rows, ordered by `(created_at DESC, id DESC)`
2. `buildCursorResponse` checks if the extra row exists to determine `hasMore`
3. If more pages exist, the cursor encodes the last row's `(created_at, id)` for the next request
4. `applyCursorFilter` adds a `WHERE (created_at, id) < (cursor_created_at, cursor_id)` condition
5. RLS ensures only the authenticated user's non-deleted threads are visible
6. The `idx_ai_threads_org_listing` partial composite index on `(org_id, created_at DESC, id DESC) WHERE deleted_at IS NULL` directly covers this pagination query

## Soft-Delete Flow

```
Client calls DELETE /api/ai/{orgId}/threads/{threadId}
  │
  ├─ 1. Rate limit (10/IP, 10/user)
  ├─ 2. Auth — getAiOrgContext (admin required)
  ├─ 3. resolveOwnThread — service client lookup + ownership check
  │       └─ Returns 404 for: not found, wrong user, wrong org, DB error
  ├─ 4. Soft-delete via auth-bound client:
  │       UPDATE ai_threads SET deleted_at = now(), updated_at = now()
  │       WHERE id = threadId
  └─ 5. Return { success: true }

Post-delete:
  - RLS SELECT policy filters `deleted_at IS NULL`, so thread disappears from listings
  - Messages remain in DB (CASCADE is on hard delete only)
  - Audit log entries preserved (FK ON DELETE SET NULL)
```

## Thread Resolver

`resolveOwnThread(threadId, userId, orgId, serviceSupabase)` performs a privileged lookup via the service client, then checks:

1. Thread exists and is not soft-deleted (`deleted_at IS NULL`)
2. Thread belongs to the requesting user (`user_id === userId`)
3. Thread belongs to the specified org (`org_id === orgId`)

All failure modes return `{ ok: false, status: 404, message: "Thread not found" }` — thread existence is never leaked to unauthorized callers.

## Rate Limits

| Endpoint | Per-IP | Per-User |
|---|---|---|
| GET threads | 30 | 30 |
| DELETE thread | 10 | 10 |
| GET messages | 30 | 30 |

## Test Coverage

| Test File | Cases | Coverage |
|---|---|---|
| `tests/ai-thread-resolver.test.ts` | 5 | `resolveOwnThread` — found, not found, wrong user, wrong org, DB error |
| `tests/ai-migration-contract.test.ts` | 2 | DDL assertions for `ai_threads` and `ai_messages` tables |
| `tests/routes/ai/threads.test.ts` | 0 | (file exists but empty — route handler tests pending) |
| `tests/routes/ai/threads-handler.test.ts` | 1 | Handler factory DI pattern |

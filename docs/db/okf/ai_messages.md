---
type: db-table
title: "ai_messages"
description: "Postgres table `ai_messages`: 13 columns. References ai_threads."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_messages

Postgres table `ai_messages`: 13 columns. References ai_threads.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `content` | `string \| null` | yes |
| `context_surface` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `idempotency_key` | `string \| null` | yes |
| `intent` | `string \| null` | yes |
| `intent_type` | `string \| null` | yes |
| `org_id` | `string` | no |
| `role` | `string` | no |
| `status` | `string` | no |
| `thread_id` | `string` | no |
| `tool_calls` | `Json \| null` | yes |
| `user_id` | `string` | no |

## Related tables

- [ai_threads](./ai_threads.md)

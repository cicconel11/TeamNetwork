---
type: db-table
title: "ai_pending_actions"
description: "Postgres table `ai_pending_actions`: 16 columns. References ai_threads, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_pending_actions

Postgres table `ai_pending_actions`: 16 columns. References ai_threads, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `action_type` | `string` | no |
| `created_at` | `string` | no |
| `error_message` | `string \| null` | yes |
| `executed_at` | `string \| null` | yes |
| `expires_at` | `string` | no |
| `id` | `string` | no |
| `organization_id` | `string` | no |
| `payload` | `Json` | no |
| `previous_payload` | `Json \| null` | yes |
| `result_entity_id` | `string \| null` | yes |
| `result_entity_type` | `string \| null` | yes |
| `revise_count` | `number` | no |
| `status` | `string` | no |
| `thread_id` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [ai_threads](./ai_threads.md)
- [organizations](./organizations.md)

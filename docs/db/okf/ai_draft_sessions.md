---
type: db-table
title: "ai_draft_sessions"
description: "Postgres table `ai_draft_sessions`: 12 columns. References ai_pending_actions, ai_threads, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_draft_sessions

Postgres table `ai_draft_sessions`: 12 columns. References ai_pending_actions, ai_threads, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `draft_payload` | `Json` | no |
| `draft_type` | `string` | no |
| `expires_at` | `string` | no |
| `id` | `string` | no |
| `missing_fields` | `string[]` | no |
| `organization_id` | `string` | no |
| `pending_action_id` | `string \| null` | yes |
| `status` | `string` | no |
| `thread_id` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [ai_pending_actions](./ai_pending_actions.md)
- [ai_threads](./ai_threads.md)
- [organizations](./organizations.md)

---
type: db-table
title: "ai_feedback"
description: "Postgres table `ai_feedback`: 6 columns. References ai_messages."
resource: /apps/web/src/types/database.ts
tags: [db, schema, ai]
timestamp: 2026-06-17T00:00:00Z
---

# ai_feedback

Postgres table `ai_feedback`: 6 columns. References ai_messages.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `comment` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `message_id` | `string` | no |
| `rating` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [ai_messages](./ai_messages.md)

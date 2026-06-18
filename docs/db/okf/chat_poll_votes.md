---
type: db-table
title: "chat_poll_votes"
description: "Postgres table `chat_poll_votes`: 8 columns. References chat_groups, chat_messages, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, chat]
timestamp: 2026-06-17T00:00:00Z
---

# chat_poll_votes

Postgres table `chat_poll_votes`: 8 columns. References chat_groups, chat_messages, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `chat_group_id` | `string` | no |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `message_id` | `string` | no |
| `option_index` | `number` | no |
| `organization_id` | `string` | no |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [chat_groups](./chat_groups.md)
- [chat_messages](./chat_messages.md)
- [organizations](./organizations.md)

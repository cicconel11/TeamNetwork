---
type: db-table
title: "chat_messages"
description: "Postgres table `chat_messages`: 16 columns. References chat_groups, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, chat]
timestamp: 2026-06-17T00:00:00Z
---

# chat_messages

Postgres table `chat_messages`: 16 columns. References chat_groups, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `approved_at` | `string \| null` | yes |
| `approved_by` | `string \| null` | yes |
| `author_id` | `string` | no |
| `body` | `string` | no |
| `chat_group_id` | `string` | no |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `edited_at` | `string \| null` | yes |
| `id` | `string` | no |
| `mentioned_user_ids` | `string[]` | no |
| `message_type` | `string \| null` | yes |
| `metadata` | `Json \| null` | yes |
| `organization_id` | `string` | no |
| `rejected_at` | `string \| null` | yes |
| `rejected_by` | `string \| null` | yes |
| `status` | `Database["public"]["Enums"]["chat_message_status"]` | no |

## Related tables

- [chat_groups](./chat_groups.md)
- [organizations](./organizations.md)

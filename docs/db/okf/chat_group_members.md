---
type: db-table
title: "chat_group_members"
description: "Postgres table `chat_group_members`: 9 columns. References chat_groups, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema, chat]
timestamp: 2026-06-17T00:00:00Z
---

# chat_group_members

Postgres table `chat_group_members`: 9 columns. References chat_groups, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `added_by` | `string \| null` | yes |
| `chat_group_id` | `string` | no |
| `id` | `string` | no |
| `joined_at` | `string` | no |
| `last_read_at` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `removed_at` | `string \| null` | yes |
| `role` | `Database["public"]["Enums"]["chat_group_role"]` | no |
| `user_id` | `string` | no |

## Related tables

- [chat_groups](./chat_groups.md)
- [organizations](./organizations.md)
- [users](./users.md)

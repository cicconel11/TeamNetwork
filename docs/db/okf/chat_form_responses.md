---
type: db-table
title: "chat_form_responses"
description: "Postgres table `chat_form_responses`: 7 columns. References chat_groups, chat_messages, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, chat]
timestamp: 2026-06-17T00:00:00Z
---

# chat_form_responses

Postgres table `chat_form_responses`: 7 columns. References chat_groups, chat_messages, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `chat_group_id` | `string` | no |
| `id` | `string` | no |
| `message_id` | `string` | no |
| `organization_id` | `string` | no |
| `responses` | `Json` | no |
| `submitted_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [chat_groups](./chat_groups.md)
- [chat_messages](./chat_messages.md)
- [organizations](./organizations.md)

---
type: db-table
title: "mentorship_reminders"
description: "Postgres table `mentorship_reminders`: 6 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentorship]
timestamp: 2026-06-17T00:00:00Z
---

# mentorship_reminders

Postgres table `mentorship_reminders`: 6 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `mentor_user_id` | `string` | no |
| `organization_id` | `string` | no |
| `pending_count` | `number` | no |
| `sent_by` | `string` | no |

## Related tables

- [organizations](./organizations.md)

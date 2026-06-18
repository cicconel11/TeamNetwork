---
type: db-table
title: "notification_reads"
description: "Postgres table `notification_reads`: 3 columns. References notifications."
resource: /apps/web/src/types/database.ts
tags: [db, schema, notification]
timestamp: 2026-06-17T00:00:00Z
---

# notification_reads

Postgres table `notification_reads`: 3 columns. References notifications.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `notification_id` | `string` | no |
| `read_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [notifications](./notifications.md)

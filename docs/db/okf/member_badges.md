---
type: db-table
title: "member_badges"
description: "Postgres table `member_badges`: 4 columns. References badges, organizations, users."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# member_badges

Postgres table `member_badges`: 4 columns. References badges, organizations, users.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `badge_id` | `string` | no |
| `earned_at` | `string` | no |
| `organization_id` | `string` | no |
| `user_id` | `string` | no |

## Related tables

- [badges](./badges.md)
- [organizations](./organizations.md)
- [users](./users.md)

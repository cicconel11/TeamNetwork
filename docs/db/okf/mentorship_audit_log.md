---
type: db-table
title: "mentorship_audit_log"
description: "Postgres table `mentorship_audit_log`: 7 columns. References mentorship_pairs, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, mentorship]
timestamp: 2026-06-17T00:00:00Z
---

# mentorship_audit_log

Postgres table `mentorship_audit_log`: 7 columns. References mentorship_pairs, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `actor_user_id` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `kind` | `string` | no |
| `metadata` | `Json` | no |
| `organization_id` | `string` | no |
| `pair_id` | `string \| null` | yes |

## Related tables

- [mentorship_pairs](./mentorship_pairs.md)
- [organizations](./organizations.md)

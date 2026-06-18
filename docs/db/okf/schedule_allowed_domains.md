---
type: db-table
title: "schedule_allowed_domains"
description: "Postgres table `schedule_allowed_domains`: 11 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# schedule_allowed_domains

Postgres table `schedule_allowed_domains`: 11 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `created_at` | `string` | no |
| `fingerprint` | `Json` | no |
| `hostname` | `string` | no |
| `id` | `string` | no |
| `last_seen_at` | `string` | no |
| `status` | `string` | no |
| `vendor_id` | `string` | no |
| `verification_method` | `string \| null` | yes |
| `verified_at` | `string \| null` | yes |
| `verified_by_org_id` | `string \| null` | yes |
| `verified_by_user_id` | `string \| null` | yes |

## Related tables

- [organizations](./organizations.md)

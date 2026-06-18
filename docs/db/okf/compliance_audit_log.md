---
type: db-table
title: "compliance_audit_log"
description: "Postgres table `compliance_audit_log`: 5 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# compliance_audit_log

Postgres table `compliance_audit_log`: 5 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `age_bracket` | `string \| null` | yes |
| `created_at` | `string` | no |
| `event_type` | `string` | no |
| `id` | `string` | no |
| `ip_hash` | `string \| null` | yes |

## Related tables

_No outbound foreign keys._

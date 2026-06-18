---
type: db-table
title: "dev_admin_audit_logs"
description: "Postgres table `dev_admin_audit_logs`: 13 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# dev_admin_audit_logs

Postgres table `dev_admin_audit_logs`: 13 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `action` | `string` | no |
| `admin_email_redacted` | `string` | no |
| `admin_user_id` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `ip_address` | `string \| null` | yes |
| `metadata` | `Json \| null` | yes |
| `request_method` | `string \| null` | yes |
| `request_path` | `string \| null` | yes |
| `target_id` | `string \| null` | yes |
| `target_slug` | `string \| null` | yes |
| `target_type` | `string \| null` | yes |
| `user_agent` | `string \| null` | yes |

## Related tables

_No outbound foreign keys._

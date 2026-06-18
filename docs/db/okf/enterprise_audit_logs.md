---
type: db-table
title: "enterprise_audit_logs"
description: "Postgres table `enterprise_audit_logs`: 14 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, enterprise]
timestamp: 2026-06-17T00:00:00Z
---

# enterprise_audit_logs

Postgres table `enterprise_audit_logs`: 14 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `action` | `string` | no |
| `actor_email_redacted` | `string` | no |
| `actor_user_id` | `string \| null` | yes |
| `created_at` | `string` | no |
| `enterprise_id` | `string` | no |
| `id` | `string` | no |
| `ip_address` | `string \| null` | yes |
| `metadata` | `Json \| null` | yes |
| `organization_id` | `string \| null` | yes |
| `request_method` | `string \| null` | yes |
| `request_path` | `string \| null` | yes |
| `target_id` | `string \| null` | yes |
| `target_type` | `string \| null` | yes |
| `user_agent` | `string \| null` | yes |

## Related tables

_No outbound foreign keys._

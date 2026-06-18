---
type: db-table
title: "org_integrations"
description: "Postgres table `org_integrations`: 14 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, org]
timestamp: 2026-06-17T00:00:00Z
---

# org_integrations

Postgres table `org_integrations`: 14 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `access_token_enc` | `string \| null` | yes |
| `connected_by` | `string \| null` | yes |
| `created_at` | `string` | no |
| `id` | `string` | no |
| `last_sync_count` | `number \| null` | yes |
| `last_sync_error` | `Json \| null` | yes |
| `last_synced_at` | `string \| null` | yes |
| `organization_id` | `string` | no |
| `provider` | `string` | no |
| `provider_config` | `Json` | no |
| `refresh_token_enc` | `string \| null` | yes |
| `status` | `string` | no |
| `token_expires_at` | `string \| null` | yes |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)

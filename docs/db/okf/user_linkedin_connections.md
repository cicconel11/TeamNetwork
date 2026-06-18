---
type: db-table
title: "user_linkedin_connections"
description: "Postgres table `user_linkedin_connections`: 22 columns. No outbound foreign keys."
resource: /apps/web/src/types/database.ts
tags: [db, schema, user]
timestamp: 2026-06-17T00:00:00Z
---

# user_linkedin_connections

Postgres table `user_linkedin_connections`: 22 columns. No outbound foreign keys.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `access_token_encrypted` | `string` | no |
| `created_at` | `string` | no |
| `enrichment_run_id` | `string \| null` | yes |
| `enrichment_status` | `string \| null` | yes |
| `id` | `string` | no |
| `last_synced_at` | `string \| null` | yes |
| `linkedin_data` | `Json` | no |
| `linkedin_email` | `string \| null` | yes |
| `linkedin_family_name` | `string \| null` | yes |
| `linkedin_given_name` | `string \| null` | yes |
| `linkedin_name` | `string \| null` | yes |
| `linkedin_picture_url` | `string \| null` | yes |
| `linkedin_profile_url` | `string \| null` | yes |
| `linkedin_sub` | `string` | no |
| `refresh_token_encrypted` | `string \| null` | yes |
| `resync_count` | `number` | no |
| `resync_month` | `string \| null` | yes |
| `status` | `string` | no |
| `sync_error` | `string \| null` | yes |
| `token_expires_at` | `string \| null` | yes |
| `updated_at` | `string` | no |
| `user_id` | `string` | no |

## Related tables

_No outbound foreign keys._

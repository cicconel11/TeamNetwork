---
type: db-table
title: "organizations"
description: "Postgres table `organizations`: 33 columns. References enterprise_alumni_counts, enterprises."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# organizations

Postgres table `organizations`: 33 columns. References enterprise_alumni_counts, enterprises.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `base_color` | `string \| null` | yes |
| `captcha_provider` | `string \| null` | yes |
| `created_at` | `string \| null` | yes |
| `default_language` | `string` | no |
| `description` | `string \| null` | yes |
| `discussion_post_roles` | `string[]` | no |
| `donation_eligible_ios` | `boolean` | no |
| `donation_embed_url` | `string \| null` | yes |
| `enterprise_adopted_at` | `string \| null` | yes |
| `enterprise_id` | `string \| null` | yes |
| `enterprise_nav_synced_at` | `string \| null` | yes |
| `enterprise_relationship_type` | `string \| null` | yes |
| `event_settings` | `Json` | no |
| `feed_post_roles` | `string[]` | no |
| `hide_donor_names` | `boolean` | no |
| `id` | `string` | no |
| `job_post_roles` | `string[]` | no |
| `linkedin_resync_enabled` | `boolean` | no |
| `logo_url` | `string \| null` | yes |
| `media_upload_roles` | `string[]` | no |
| `name` | `string` | no |
| `nav_config` | `Json \| null` | yes |
| `org_type` | `string` | no |
| `original_subscription_id` | `string \| null` | yes |
| `original_subscription_status` | `string \| null` | yes |
| `primary_color` | `string \| null` | yes |
| `purpose` | `string \| null` | yes |
| `require_invite_approval` | `boolean` | no |
| `secondary_color` | `string \| null` | yes |
| `settings` | `Json` | no |
| `slug` | `string` | no |
| `stripe_connect_account_id` | `string \| null` | yes |
| `timezone` | `string` | no |

## Related tables

- enterprise_alumni_counts (view or external relation)
- [enterprises](./enterprises.md)

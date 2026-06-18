---
type: db-table
title: "organization_subscriptions"
description: "Postgres table `organization_subscriptions`: 18 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, organization]
timestamp: 2026-06-17T00:00:00Z
---

# organization_subscriptions

Postgres table `organization_subscriptions`: 18 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `ai_monthly_cap_cents` | `number \| null` | yes |
| `alumni_bucket` | `string` | no |
| `alumni_plan_interval` | `string \| null` | yes |
| `base_plan_interval` | `string` | no |
| `created_at` | `string` | no |
| `current_period_end` | `string \| null` | yes |
| `grace_period_ends_at` | `string \| null` | yes |
| `id` | `string` | no |
| `is_trial` | `boolean` | no |
| `media_storage_quota_bytes` | `number \| null` | yes |
| `organization_id` | `string` | no |
| `parents_bucket` | `string` | no |
| `pricing_model_version` | `string` | no |
| `pricing_v2_snapshot` | `Json \| null` | yes |
| `status` | `string` | no |
| `stripe_customer_id` | `string \| null` | yes |
| `stripe_subscription_id` | `string \| null` | yes |
| `updated_at` | `string` | no |

## Related tables

- [organizations](./organizations.md)

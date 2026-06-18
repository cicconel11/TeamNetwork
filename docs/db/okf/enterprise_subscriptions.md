---
type: db-table
title: "enterprise_subscriptions"
description: "Postgres table `enterprise_subscriptions`: 16 columns. References enterprise_alumni_counts, enterprises."
resource: /apps/web/src/types/database.ts
tags: [db, schema, enterprise]
timestamp: 2026-06-17T00:00:00Z
---

# enterprise_subscriptions

Postgres table `enterprise_subscriptions`: 16 columns. References enterprise_alumni_counts, enterprises.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `alumni_bucket_quantity` | `number` | no |
| `billing_interval` | `string` | no |
| `created_at` | `string` | no |
| `current_period_end` | `string \| null` | yes |
| `enterprise_id` | `string` | no |
| `grace_period_ends_at` | `string \| null` | yes |
| `id` | `string` | no |
| `price_per_sub_org_cents` | `number \| null` | yes |
| `pricing_model` | `string \| null` | yes |
| `pricing_model_version` | `string` | no |
| `pricing_v2_snapshot` | `Json \| null` | yes |
| `status` | `string` | no |
| `stripe_customer_id` | `string \| null` | yes |
| `stripe_subscription_id` | `string \| null` | yes |
| `sub_org_quantity` | `number \| null` | yes |
| `updated_at` | `string` | no |

## Related tables

- enterprise_alumni_counts (view or external relation)
- [enterprises](./enterprises.md)

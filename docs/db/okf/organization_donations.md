---
type: db-table
title: "organization_donations"
description: "Postgres table `organization_donations`: 17 columns. References events, organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, organization]
timestamp: 2026-06-17T00:00:00Z
---

# organization_donations

Postgres table `organization_donations`: 17 columns. References events, organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `amount_cents` | `number` | no |
| `anonymous` | `boolean` | no |
| `created_at` | `string` | no |
| `currency` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `donor_email` | `string \| null` | yes |
| `donor_name` | `string \| null` | yes |
| `event_id` | `string \| null` | yes |
| `id` | `string` | no |
| `metadata` | `Json \| null` | yes |
| `organization_id` | `string` | no |
| `purpose` | `string \| null` | yes |
| `status` | `string` | no |
| `stripe_checkout_session_id` | `string \| null` | yes |
| `stripe_payment_intent_id` | `string \| null` | yes |
| `updated_at` | `string` | no |
| `visibility` | `string` | no |

## Related tables

- [events](./events.md)
- [organizations](./organizations.md)

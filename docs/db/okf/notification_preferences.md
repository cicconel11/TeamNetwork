---
type: db-table
title: "notification_preferences"
description: "Postgres table `notification_preferences`: 33 columns. References organizations."
resource: /apps/web/src/types/database.ts
tags: [db, schema, notification]
timestamp: 2026-06-17T00:00:00Z
---

# notification_preferences

Postgres table `notification_preferences`: 33 columns. References organizations.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `announcement_emails_enabled` | `boolean` | no |
| `announcement_push_enabled` | `boolean` | no |
| `chat_push_enabled` | `boolean` | no |
| `competition_emails_enabled` | `boolean` | no |
| `competition_push_enabled` | `boolean` | no |
| `created_at` | `string \| null` | yes |
| `digest_push_enabled` | `boolean` | no |
| `discussion_emails_enabled` | `boolean` | no |
| `discussion_push_enabled` | `boolean` | no |
| `donation_push_enabled` | `boolean` | no |
| `email_address` | `string \| null` | yes |
| `email_enabled` | `boolean \| null` | yes |
| `event_emails_enabled` | `boolean` | no |
| `event_push_enabled` | `boolean` | no |
| `event_reminder_push_enabled` | `boolean` | no |
| `id` | `string` | no |
| `job_push_enabled` | `boolean` | no |
| `mention_push_enabled` | `boolean` | no |
| `mentorship_emails_enabled` | `boolean` | no |
| `mentorship_push_enabled` | `boolean` | no |
| `organization_id` | `string` | no |
| `phone_number` | `string \| null` | yes |
| `push_enabled` | `boolean \| null` | yes |
| `quiet_hours_end` | `string` | no |
| `quiet_hours_start` | `string` | no |
| `quiet_hours_timezone` | `string` | no |
| `reaction_push_enabled` | `boolean` | no |
| `reengagement_push_enabled` | `boolean` | no |
| `sms_enabled` | `boolean \| null` | yes |
| `updated_at` | `string \| null` | yes |
| `user_id` | `string` | no |
| `workout_emails_enabled` | `boolean` | no |
| `workout_push_enabled` | `boolean` | no |

## Related tables

- [organizations](./organizations.md)

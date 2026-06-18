---
type: db-table
title: "dsr_requests"
description: "Postgres table `dsr_requests`: 25 columns. References data_access_log, organizations, user_deletion_requests."
resource: /apps/web/src/types/database.ts
tags: [db, schema]
timestamp: 2026-06-17T00:00:00Z
---

# dsr_requests

Postgres table `dsr_requests`: 25 columns. References data_access_log, organizations, user_deletion_requests.

## Columns

| Column | Type | Nullable |
| --- | --- | --- |
| `ack_due_at` | `string` | no |
| `acknowledged_at` | `string \| null` | yes |
| `acknowledgement_method` | `string \| null` | yes |
| `created_at` | `string` | no |
| `deleted_at` | `string \| null` | yes |
| `id` | `string` | no |
| `linked_access_log_id` | `string \| null` | yes |
| `linked_deletion_request_id` | `string \| null` | yes |
| `organization_id` | `string \| null` | yes |
| `received_at` | `string` | no |
| `request_type` | `string` | no |
| `requester_email` | `string \| null` | yes |
| `requester_name` | `string \| null` | yes |
| `requester_relationship` | `string` | no |
| `resolution_method` | `string \| null` | yes |
| `resolution_notes` | `string \| null` | yes |
| `resolve_due_at` | `string` | no |
| `resolved_at` | `string \| null` | yes |
| `school_owner_user_id` | `string \| null` | yes |
| `source` | `string` | no |
| `status` | `string` | no |
| `subject_identifier` | `string \| null` | yes |
| `subject_identifier_type` | `string \| null` | yes |
| `subject_user_id` | `string \| null` | yes |
| `updated_at` | `string` | no |

## Related tables

- [data_access_log](./data_access_log.md)
- [organizations](./organizations.md)
- [user_deletion_requests](./user_deletion_requests.md)

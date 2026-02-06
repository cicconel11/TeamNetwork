# Chat Group Member Management

## Schema: `chat_group_members`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Row identifier |
| `chat_group_id` | uuid FK → chat_groups | Group this membership belongs to |
| `user_id` | uuid FK → auth.users | The member |
| `organization_id` | uuid FK → organizations | Org context |
| `role` | chat_group_role enum | `admin`, `moderator`, or `member` |
| `joined_at` | timestamptz | When the member was added |
| `last_read_at` | timestamptz | Last time the member read messages |
| `added_by` | uuid FK → auth.users | Who added this member (nullable for legacy rows) |
| `removed_at` | timestamptz | Soft-removal timestamp; NULL = active |

**Unique constraint**: `(chat_group_id, user_id)` — one row per user per group.

## Soft Removal via `removed_at`

- Setting `removed_at` makes a member inactive. They lose access to the group and its messages.
- Hard `DELETE` is restricted to org admins for data cleanup only.
- The `is_chat_group_member()` and `is_chat_group_moderator()` helper functions filter `removed_at IS NULL`, so all existing RLS policies that reference them automatically exclude removed members.

## Re-adding a Member

Because of the unique constraint on `(chat_group_id, user_id)`, re-adding a previously removed member is done via UPDATE (clear `removed_at`, set `added_by`) rather than INSERT. The client-side flow:

1. Attempt INSERT
2. On error code `23505` (unique violation), UPDATE the existing row to clear `removed_at` and set `added_by`

## Permission Model

| Action | Who Can Do It |
|--------|--------------|
| **Add members** | Org admins, group moderators, group creator |
| **Remove members** | Org admins, group moderators, group creator |
| **Leave group** (self-remove) | Any member (sets own `removed_at`) |
| **Hard delete** | Org admins only |
| **View removed members** | Org admins, group moderators, group creator |

## Helper Functions

- `is_chat_group_member(group_id)` — TRUE if `auth.uid()` has an active (non-removed) membership
- `is_chat_group_moderator(group_id)` — TRUE if `auth.uid()` is admin/moderator and not removed
- `is_chat_group_creator(group_id)` — TRUE if `auth.uid()` is the `created_by` on `chat_groups`

## Migration

`supabase/migrations/20260429100000_chat_group_member_management.sql`

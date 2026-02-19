-- Add 'uploading' value to media_status enum
-- Must run in a separate transaction before the moderation migration
-- because Postgres requires new enum values to be committed before use.
ALTER TYPE public.media_status ADD VALUE IF NOT EXISTS 'uploading' BEFORE 'pending';

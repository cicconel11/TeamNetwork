-- =====================================================
-- Migration: Push Notifications Support
-- =====================================================
-- 1. Creates user_push_tokens table to store Expo push tokens
-- 2. Adds push_enabled column to notification_preferences

-- Table: user_push_tokens
-- Stores Expo push tokens for each user's device
CREATE TABLE IF NOT EXISTS public.user_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  device_id text, -- Optional device identifier for managing multiple devices
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, expo_push_token)
);

-- Add push_enabled column to notification_preferences (default true)
ALTER TABLE public.notification_preferences
  ADD COLUMN IF NOT EXISTS push_enabled boolean DEFAULT true;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS user_push_tokens_user_id_idx ON public.user_push_tokens(user_id);
CREATE INDEX IF NOT EXISTS user_push_tokens_token_idx ON public.user_push_tokens(expo_push_token);

-- Enable RLS
ALTER TABLE public.user_push_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_push_tokens
-- Users can only manage their own push tokens

DROP POLICY IF EXISTS user_push_tokens_select ON public.user_push_tokens;
CREATE POLICY user_push_tokens_select ON public.user_push_tokens
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_push_tokens_insert ON public.user_push_tokens;
CREATE POLICY user_push_tokens_insert ON public.user_push_tokens
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_push_tokens_update ON public.user_push_tokens;
CREATE POLICY user_push_tokens_update ON public.user_push_tokens
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_push_tokens_delete ON public.user_push_tokens;
CREATE POLICY user_push_tokens_delete ON public.user_push_tokens
  FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_user_push_tokens_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_push_tokens_updated_at ON public.user_push_tokens;
CREATE TRIGGER user_push_tokens_updated_at
  BEFORE UPDATE ON public.user_push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_push_tokens_updated_at();

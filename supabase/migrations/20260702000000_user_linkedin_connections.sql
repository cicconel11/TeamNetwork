-- LinkedIn OAuth connection storage (user-scoped, verified via OpenID Connect)
-- Pattern follows user_calendar_connections (Google Calendar)

CREATE TABLE public.user_linkedin_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_sub text NOT NULL,
  linkedin_email text,
  linkedin_name text,
  linkedin_given_name text,
  linkedin_family_name text,
  linkedin_picture_url text,
  linkedin_profile_url text,
  access_token_encrypted text NOT NULL,
  refresh_token_encrypted text,
  token_expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'disconnected', 'error')),
  last_synced_at timestamptz,
  sync_error text,
  linkedin_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_linkedin_connections_user_id_key UNIQUE (user_id)
);

-- Indexes
CREATE UNIQUE INDEX user_linkedin_connections_linkedin_sub_idx
  ON public.user_linkedin_connections (linkedin_sub);

CREATE INDEX user_linkedin_connections_status_idx
  ON public.user_linkedin_connections (status);

-- updated_at trigger (reuses shared function)
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.user_linkedin_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.user_linkedin_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_linkedin_connections_select
  ON public.user_linkedin_connections FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY user_linkedin_connections_insert
  ON public.user_linkedin_connections FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_linkedin_connections_update
  ON public.user_linkedin_connections FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY user_linkedin_connections_delete
  ON public.user_linkedin_connections FOR DELETE
  USING (auth.uid() = user_id);

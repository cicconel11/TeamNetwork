-- Revoke direct access to enterprise_alumni_counts from authenticated users.
-- Access should go through the service role only (server-side service client / RPC).
REVOKE SELECT ON public.enterprise_alumni_counts FROM authenticated;

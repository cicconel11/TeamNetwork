-- Tighten record_user_activity() so anon cannot call it. The function is a
-- no-op for anon (auth.uid() is null and it returns early), but explicit
-- revokes are easier to audit than implicit no-ops.
revoke execute on function public.record_user_activity() from anon;

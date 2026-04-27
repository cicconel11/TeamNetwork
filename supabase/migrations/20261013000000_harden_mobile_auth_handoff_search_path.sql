-- Harden consume_mobile_auth_handoff by pinning search_path to '' so that
-- unqualified table references can never resolve to attacker-controlled
-- objects placed in earlier schemas. The function body already qualifies
-- public.mobile_auth_handoffs, so behavior is unchanged.

ALTER FUNCTION public.consume_mobile_auth_handoff(text) SET search_path = '';

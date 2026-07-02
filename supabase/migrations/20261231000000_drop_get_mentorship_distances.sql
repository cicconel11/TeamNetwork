-- Drop get_mentorship_distances (Option A: people-graph served from Postgres).
--
-- Kept by 20261221000000/20261222000000 as "the Postgres-native traversal we are
-- standardizing on", but it has zero callers: suggest_connections and the rest of
-- src/lib/people-graph/ compute suggestions entirely via mentorship_pairs +
-- member/alumni projections in application code, never through this RPC.

DROP FUNCTION IF EXISTS public.get_mentorship_distances(uuid, uuid);

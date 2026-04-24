-- Inline pending-action diff: add columns for diff-of-edit + revise lineage
-- previous_payload stores the prior payload (for revise) or the pre-existing
-- entity snapshot (for edit-type actions) so the card can render a Replaces
-- section. revise_count enforces the 3-loop cap at the CAS layer in the
-- update-in-place revise path.

ALTER TABLE ai_pending_actions
  ADD COLUMN IF NOT EXISTS previous_payload jsonb;

ALTER TABLE ai_pending_actions
  ADD COLUMN IF NOT EXISTS revise_count integer NOT NULL DEFAULT 0;

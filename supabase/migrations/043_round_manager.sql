-- ============================================================
-- Migration 043: Round Manager — end structure + target face
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- Adds to scoring.rounds what the Round Manager and the Arrow Plotter need:
--   • arrows_per_end / ends — the end format (plotting is enforced per end)
--   • target_face           — which face config the plotter shows (slug)
-- distance_m already exists (migration 004) and feeds the distance analytics.
--
-- Also fixes grants: rounds previously had SELECT only, so admin
-- create/edit through public.rounds would be "permission denied"
-- (same view-grant gap as the org tables, fixed in migration 035).
-- ============================================================

ALTER TABLE scoring.rounds
  ADD COLUMN IF NOT EXISTS arrows_per_end int,
  ADD COLUMN IF NOT EXISTS ends           int,
  ADD COLUMN IF NOT EXISTS target_face    text;

-- Re-assert the passthrough view so new columns reach PostgREST.
CREATE OR REPLACE VIEW public.rounds
  WITH (security_invoker = true) AS
SELECT * FROM scoring.rounds;

-- Write grants (RLS scoring_rounds_admin_manage already restricts to admins).
GRANT SELECT, INSERT, UPDATE ON scoring.rounds TO authenticated;
GRANT SELECT                 ON public.rounds  TO authenticated, anon;
GRANT INSERT, UPDATE         ON public.rounds  TO authenticated;

-- Best-effort backfill of end structure for seeded rounds:
-- default to 6-arrow ends outdoors, 3-arrow ends for 18m indoor.
UPDATE scoring.rounds
   SET arrows_per_end = COALESCE(arrows_per_end, CASE WHEN distance_m IS NOT NULL AND distance_m <= 18 THEN 3 ELSE 6 END),
       ends           = COALESCE(ends, GREATEST(1, total_arrows / NULLIF(COALESCE(arrows_per_end, CASE WHEN distance_m IS NOT NULL AND distance_m <= 18 THEN 3 ELSE 6 END), 0)))
 WHERE arrows_per_end IS NULL OR ends IS NULL;

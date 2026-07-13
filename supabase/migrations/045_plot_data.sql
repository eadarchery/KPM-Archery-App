-- ============================================================
-- Migration 045: Arrow plot positions (spread-monitor foundation)
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- Stores WHERE each plotted arrow landed, in real centimetres from the face
-- centre (x right+, y down+), plus which face was used:
--   plot_data = { "face": "wa-122", "arrows": [ { "s": "X", "x": -1.2, "y": 3.4 }, … ] }
-- Only set for submissions made with the "Plot on target" entry mode.
-- cm units make sessions comparable across face sizes for spread analytics
-- (group size, centre drift) split by round distance.
-- ============================================================

ALTER TABLE scoring.score_submissions
  ADD COLUMN IF NOT EXISTS plot_data jsonb;

CREATE OR REPLACE VIEW public.score_submissions
  WITH (security_invoker = true) AS
SELECT * FROM scoring.score_submissions;

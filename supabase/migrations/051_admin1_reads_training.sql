-- ============================================================
-- Migration 051: Admin 1 reads training logs (national arrows trend)
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
-- The National Overview needs total-arrows / sessions trends, but
-- scoring.training_logs had no Admin 1 read policy, so those figures
-- silently showed 0 for Admin 1. Mirrors scoring_submissions_admin1_reads.
-- ============================================================

DROP POLICY IF EXISTS "scoring_training_admin1_reads" ON scoring.training_logs;
CREATE POLICY "scoring_training_admin1_reads"
  ON scoring.training_logs FOR SELECT TO authenticated
  USING (core.current_role() = 'admin1' AND core.is_approved());

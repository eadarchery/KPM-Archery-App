-- ============================================================
-- Migration 011: Profile Change Requests
-- Table, RLS, public view, storage policies.
-- Run in Supabase Dashboard → SQL Editor.
-- ============================================================

-- ─── TABLE ───────────────────────────────────────────────────

CREATE TABLE core.profile_change_requests (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  requested_by           uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  field_key              text        NOT NULL,
  field_label            text        NOT NULL,
  current_value          text,
  requested_value        text        NOT NULL,
  reason                 text        NOT NULL,
  status                 text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','approved','rejected','withdrawn')),
  supporting_file_bucket text,
  supporting_file_path   text,
  reviewed_by            uuid        REFERENCES core.profiles(id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  review_note            text,
  rejection_reason       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pcr_user_id_idx    ON core.profile_change_requests(user_id);
CREATE INDEX pcr_status_idx     ON core.profile_change_requests(status);
CREATE INDEX pcr_created_at_idx ON core.profile_change_requests(created_at DESC);

CREATE OR REPLACE TRIGGER profile_change_requests_updated_at
  BEFORE UPDATE ON core.profile_change_requests
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── ROW LEVEL SECURITY ──────────────────────────────────────

ALTER TABLE core.profile_change_requests ENABLE ROW LEVEL SECURITY;

-- Archer reads their own requests
CREATE POLICY "pcr_archer_reads_own"
  ON core.profile_change_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Archer submits requests only for themselves
CREATE POLICY "pcr_archer_inserts_own"
  ON core.profile_change_requests FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND requested_by = auth.uid());

-- Archer can only withdraw their own pending requests (no other update)
CREATE POLICY "pcr_archer_withdraws_pending"
  ON core.profile_change_requests FOR UPDATE TO authenticated
  USING  (user_id = auth.uid() AND status = 'pending')
  WITH CHECK (user_id = auth.uid() AND status = 'withdrawn');

-- Admin2 (and super_admin) have full access
CREATE POLICY "pcr_admin2_full"
  ON core.profile_change_requests FOR ALL TO authenticated
  USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── PUBLIC VIEW ─────────────────────────────────────────────

CREATE OR REPLACE VIEW public.profile_change_requests
  WITH (security_invoker = true) AS
SELECT * FROM core.profile_change_requests;

-- ─── GRANTS ──────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE ON core.profile_change_requests  TO authenticated;
GRANT ALL                    ON core.profile_change_requests  TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.profile_change_requests TO authenticated;

-- ─── STORAGE POLICIES (profile-change-requests bucket) ───────
-- NOTE: Create the bucket manually before using:
--   Supabase Dashboard → Storage → New bucket
--   Name: profile-change-requests | Type: Private (not public)

CREATE POLICY "pcr_storage_archer_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-change-requests'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "pcr_storage_archer_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-change-requests'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "pcr_storage_admin2_full"
  ON storage.objects FOR ALL TO authenticated
  USING  (bucket_id = 'profile-change-requests' AND core.is_admin())
  WITH CHECK (bucket_id = 'profile-change-requests' AND core.is_admin());

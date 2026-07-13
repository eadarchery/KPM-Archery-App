-- ============================================================
-- Migration 030: Account Recovery Requests
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--
-- Public "Forgot Email / Account Recovery" submissions for admin review.
-- A user who forgot their LOGIN EMAIL submits identifying details; Admin 2 /
-- Super Admin verify them out-of-band (via User Management) and follow up.
--
-- Security model:
--   • Anyone (incl. unauthenticated/anon) may INSERT a request.
--   • NO public SELECT — the public can never read submitted requests.
--   • Only Admin 2 + Super Admin (core.is_admin()) may SELECT and UPDATE.
--   • Admin 1 and normal users have no access.
--   • This table never stores passwords, emails-to-reveal, or auth tokens, and
--     submitting a request changes NO account, role or status by itself.
--
-- Real table:  support.account_recovery_requests
-- Public view: public.account_recovery_requests (security_invoker = true)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS support;
GRANT USAGE ON SCHEMA support TO authenticated, anon, service_role;

-- ─── TABLE ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS support.account_recovery_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name    text NOT NULL,
  role         text CHECK (role IN ('archer','coach','admin1','admin2')),
  phone        text,
  archer_id    text,
  school_name  text,
  state_name   text,
  pld_name     text,
  coach_name   text,
  notes        text,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','reviewing','resolved','rejected')),
  reviewed_by  uuid REFERENCES core.profiles(id),
  reviewed_at  timestamptz,
  admin_notes  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_recovery_status_idx  ON support.account_recovery_requests(status);
CREATE INDEX IF NOT EXISTS account_recovery_created_idx ON support.account_recovery_requests(created_at DESC);

CREATE OR REPLACE TRIGGER account_recovery_updated_at
  BEFORE UPDATE ON support.account_recovery_requests
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────

ALTER TABLE support.account_recovery_requests ENABLE ROW LEVEL SECURITY;

-- INSERT: anyone (anon + authenticated). New rows must start as a clean,
-- unreviewed 'pending' request — submitters can never pre-set review fields.
DROP POLICY IF EXISTS "account_recovery_public_insert" ON support.account_recovery_requests;
CREATE POLICY "account_recovery_public_insert" ON support.account_recovery_requests
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND char_length(full_name) BETWEEN 1 AND 200
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND admin_notes IS NULL
  );

-- SELECT: Admin 2 + Super Admin only. No anon, no normal users, no Admin 1.
DROP POLICY IF EXISTS "account_recovery_admin_select" ON support.account_recovery_requests;
CREATE POLICY "account_recovery_admin_select" ON support.account_recovery_requests
  FOR SELECT TO authenticated
  USING (core.is_admin());

-- UPDATE: Admin 2 + Super Admin only (status / admin_notes / reviewer fields).
DROP POLICY IF EXISTS "account_recovery_admin_update" ON support.account_recovery_requests;
CREATE POLICY "account_recovery_admin_update" ON support.account_recovery_requests
  FOR UPDATE TO authenticated
  USING (core.is_admin())
  WITH CHECK (core.is_admin());

-- No DELETE policy → the API cannot delete requests (service_role bypasses RLS
-- for back-office maintenance only).

-- ─── GRANTS ────────────────────────────────────────────────────

GRANT INSERT         ON support.account_recovery_requests TO anon, authenticated;
GRANT SELECT, UPDATE ON support.account_recovery_requests TO authenticated;
GRANT ALL            ON support.account_recovery_requests TO service_role;

-- ─── PUBLIC VIEW ───────────────────────────────────────────────
-- Frontend queries supabase.from('account_recovery_requests') → this view.
-- security_invoker = true means the table RLS above is enforced as the caller.

CREATE OR REPLACE VIEW public.account_recovery_requests
  WITH (security_invoker = true) AS
SELECT * FROM support.account_recovery_requests;

GRANT INSERT         ON public.account_recovery_requests TO anon, authenticated;
GRANT SELECT, UPDATE ON public.account_recovery_requests TO authenticated;

-- ─── NOTES ─────────────────────────────────────────────────────
--  • Public INSERT is intentional (anon can submit). The frontend inserts WITHOUT
--    a .select() so anon never reads back any row (no SELECT policy for anon).
--  • This flow reveals nothing about whether an account/email exists.
--  • Account changes (email update, password reset) are NOT done here — admins act
--    via existing User Management, which already blocks Admin 2 from Super Admin.
--  • TODO (production hardening): add CAPTCHA or server-side rate limiting before
--    public launch if spam becomes a problem. No file/proof uploads in this flow.

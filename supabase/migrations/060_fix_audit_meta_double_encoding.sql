-- ============================================================================
-- 060 — Repair double-encoded audit_logs.meta
-- ============================================================================
-- Bug: writeAuditLog() passed JSON.stringify(meta) into the jsonb p_meta
-- param of log_audit(). supabase-js serializes RPC params itself, so the
-- value landed in audit.audit_logs.meta as a jsonb *string scalar* holding
-- serialized JSON (e.g. '"{\"coach_name\":\"...\"}"') instead of an object.
-- Reading it back gave the client a JS string, and the audit viewer's
-- `'name' in meta` check threw:
--   TypeError: Cannot use 'in' operator to search for 'name' in {...}
-- which took down the whole Audit Logs page.
--
-- The client writer is fixed (services/auditLog.ts no longer stringifies) and
-- the reader now tolerates both shapes (services/audit.ts normalizeMeta).
-- This migration repairs the stored rows so the data itself is clean.
--
-- Idempotent: re-running finds no jsonb string-scalar rows and does nothing.
-- Rows whose string content is not valid JSON, or decodes to something other
-- than an object/array, are left untouched.
-- ============================================================================

DO $$
DECLARE
  r      RECORD;
  fixed  jsonb;
  n_done integer := 0;
  n_skip integer := 0;
BEGIN
  FOR r IN
    SELECT id, meta
    FROM audit.audit_logs
    WHERE jsonb_typeof(meta) = 'string'
  LOOP
    BEGIN
      -- Unwrap the string scalar, then parse its text content as JSON.
      fixed := (r.meta #>> '{}')::jsonb;

      IF jsonb_typeof(fixed) IN ('object', 'array') THEN
        UPDATE audit.audit_logs SET meta = fixed WHERE id = r.id;
        n_done := n_done + 1;
      ELSE
        -- A genuine string value (not serialized JSON) — leave as-is.
        n_skip := n_skip + 1;
      END IF;
    EXCEPTION WHEN others THEN
      -- String content isn't valid JSON — leave the row untouched.
      n_skip := n_skip + 1;
    END;
  END LOOP;

  RAISE NOTICE 'audit meta repair: % rows fixed, % skipped', n_done, n_skip;
END $$;

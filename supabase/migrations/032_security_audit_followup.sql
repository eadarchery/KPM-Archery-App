-- ============================================================
-- Migration 032: Security Audit Follow-up
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Run AFTER 031.
--
--   FIX A (audit forgery): public.log_audit trusted the p_actor_id passed by the
--     client, so a caller could attribute an audit entry to another user. The
--     actor is now taken from auth.uid() (the authenticated caller); the passed
--     id is only a fallback for service_role/system calls (auth.uid() = NULL).
--
--   FIX B (profile field hardening): extend the self-update guard from migration
--     031 so a user cannot change ANY privileged field on their OWN profile —
--     role, status, approval/lifecycle attribution, scope (school/PLD/state) or
--     coach link. (archer_id is intentionally allowed because it is assigned
--     during the archer's own sign-up upsert.)
-- ============================================================

-- ─── FIX A: unforgeable audit actor ────────────────────────────

CREATE OR REPLACE FUNCTION public.log_audit(
  p_actor_id    uuid,
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   uuid DEFAULT NULL,
  p_meta        jsonb DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id    uuid;
  v_actor uuid;
BEGIN
  -- The authenticated caller is the source of truth; clients cannot forge an
  -- actor. Fall back to the passed id only when there is no JWT (service_role).
  v_actor := COALESCE(auth.uid(), p_actor_id);

  INSERT INTO audit.audit_logs (actor_id, action, target_type, target_id, meta)
  VALUES (v_actor, p_action, p_target_type, p_target_id, p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── FIX B: extended self-profile privilege guard ──────────────
-- Supersedes the function from 031 (the trigger created there keeps working);
-- the trigger is re-asserted below in case 031 has not been applied yet.

CREATE OR REPLACE FUNCTION core.guard_profile_privilege()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Super admins are trusted; SQL Editor / service_role has auth.uid() = NULL.
  IF auth.uid() IS NULL OR core.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.id = auth.uid()
       AND (NEW.role NOT IN ('archer','coach') OR NEW.status <> 'pending') THEN
      RAISE EXCEPTION 'Self-registered accounts must be a pending archer or coach.';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: a user may not change privileged fields on their OWN row.
  IF auth.uid() = OLD.id AND (
        NEW.role              IS DISTINCT FROM OLD.role
     OR NEW.status            IS DISTINCT FROM OLD.status
     OR NEW.approved_by       IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at       IS DISTINCT FROM OLD.approved_at
     OR NEW.rejected_by       IS DISTINCT FROM OLD.rejected_by
     OR NEW.rejected_at       IS DISTINCT FROM OLD.rejected_at
     OR NEW.suspended_by      IS DISTINCT FROM OLD.suspended_by
     OR NEW.suspended_at      IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
     OR NEW.admin_notes       IS DISTINCT FROM OLD.admin_notes
     OR NEW.school_id         IS DISTINCT FROM OLD.school_id
     OR NEW.pld_id            IS DISTINCT FROM OLD.pld_id
     OR NEW.state_id          IS DISTINCT FROM OLD.state_id
     OR NEW.coach_id          IS DISTINCT FROM OLD.coach_id
  ) THEN
    RAISE EXCEPTION 'You cannot change protected account fields (role, status, approval, scope or coach link) on your own profile.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS core_profiles_guard_privilege ON core.profiles;
CREATE TRIGGER core_profiles_guard_privilege
  BEFORE INSERT OR UPDATE ON core.profiles
  FOR EACH ROW EXECUTE FUNCTION core.guard_profile_privilege();

-- ─── NOTES ─────────────────────────────────────────────────────
--  • Legitimate self-edits (name, phone, avatar_url) are unaffected — those
--    columns are not in the protected list. School/PLD/State changes flow through
--    the admin-applied profile-change-request process, not self-update.
--  • Admins acting on OTHER users' rows (auth.uid() <> row id) are unaffected and
--    remain governed by RLS (admin2_nonsuper / super_full / admin1_approve_in_scope).

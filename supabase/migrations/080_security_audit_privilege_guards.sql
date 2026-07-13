-- ============================================================
-- Migration 080: Security audit — close privilege-escalation gaps
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. Recreates two guard functions + two RLS policies.
--       No columns, no views changed. Safe to re-run.
--
-- WHY: Codex security review (2026-07-09) found four privilege gaps in the
--      RLS/trigger layer. The UI + service layers already narrow intent, but
--      RLS must enforce it too (defense in depth — same class as 031/032/033):
--
--   CRITICAL  is_pld_coach was added in 049 AFTER the profile guard (033) was
--             finalised, so it was never in the guard's denylist. An approved
--             coach could PATCH their own profiles.is_pld_coach = true and
--             self-promote into the PLD validation lane.
--   HIGH #1   core_profiles_admin1_approve_in_scope (018) is a full-row UPDATE.
--             A scoped Admin 1 could change role / org / coach_id / is_pld_coach
--             / admin_notes on any in-scope profile, not just approve/reject.
--   HIGH #2   coaching_coach_profiles_own_update (006) let a coach flip their
--             own is_certified / certification_level.
--   MEDIUM #1 notification_reads_admin_read (054) let ANY Admin 1 read every
--             read-receipt row, ignoring their state/PLD/school scope.
--   MEDIUM #3 legacy core.app_settings was writable by Admin 2 (is_admin);
--             the current model makes settings Super-Admin-only (app_config).
--
-- NOTE: the profile guard denylist has now missed a privileged column TWICE
--       (scope fields → 033, is_pld_coach → here). Consider converting it to a
--       column ALLOWLIST for self-editable fields in a future migration so the
--       NEXT privileged column can't silently slip through. Left as follow-up
--       to avoid blocking legitimate self-edits (name, avatar, language, …).
-- ============================================================

-- ─── PART 1 (CRITICAL + HIGH #1): profile privilege guard ────────
-- Supersedes the function from 033. Two behaviour changes:
--   • adds is_pld_coach to the fields a user cannot flip on their OWN row
--   • adds an Admin-1-on-another-user branch: the broad approve-in-scope
--     UPDATE policy may now change ONLY approval/rejection bookkeeping.
-- admin2 / super_admin are unaffected (super returns early; admin2 fails the
-- current_role()='admin1' test and keeps full control via admin2_full).

CREATE OR REPLACE FUNCTION core.guard_profile_privilege()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_sensitive_changed boolean;
BEGIN
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

  -- Privileged identity/scope fields a non-super actor must never flip on ANY
  -- profile row (own or a target), regardless of which policy let the UPDATE in.
  v_sensitive_changed := (
        NEW.role               IS DISTINCT FROM OLD.role
     OR NEW.school_id          IS DISTINCT FROM OLD.school_id
     OR NEW.pld_id             IS DISTINCT FROM OLD.pld_id
     OR NEW.state_id           IS DISTINCT FROM OLD.state_id
     OR NEW.coach_id           IS DISTINCT FROM OLD.coach_id
     OR NEW.is_pld_coach       IS DISTINCT FROM OLD.is_pld_coach   -- 049 column, now guarded
     OR NEW.scope_type         IS DISTINCT FROM OLD.scope_type
     OR NEW.assigned_state_id  IS DISTINCT FROM OLD.assigned_state_id
     OR NEW.assigned_pld_id    IS DISTINCT FROM OLD.assigned_pld_id
     OR NEW.assigned_school_id IS DISTINCT FROM OLD.assigned_school_id
  );

  -- SELF-EDIT: a user cannot change their own privileged fields, nor the
  -- approval / suspension bookkeeping, nor admin_notes.
  IF auth.uid() = OLD.id AND (
        v_sensitive_changed
     OR NEW.status             IS DISTINCT FROM OLD.status
     OR NEW.approved_by        IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at        IS DISTINCT FROM OLD.approved_at
     OR NEW.rejected_by        IS DISTINCT FROM OLD.rejected_by
     OR NEW.rejected_at        IS DISTINCT FROM OLD.rejected_at
     OR NEW.suspended_by       IS DISTINCT FROM OLD.suspended_by
     OR NEW.suspended_at       IS DISTINCT FROM OLD.suspended_at
     OR NEW.suspension_reason  IS DISTINCT FROM OLD.suspension_reason
     OR NEW.admin_notes        IS DISTINCT FROM OLD.admin_notes
  ) THEN
    RAISE EXCEPTION 'You cannot change protected account fields (role, status, approval, scope, coach link or PLD-coach flag) on your own profile.';
  END IF;

  -- ADMIN 1 acting on ANOTHER user's profile (via core_profiles_admin1_approve_in_scope):
  -- may change ONLY approval/rejection fields. Block every privileged field plus
  -- suspension + admin_notes so the broad in-scope UPDATE cannot be used to flip
  -- role, move org/scope, reassign a coach, grant is_pld_coach, or edit notes.
  IF auth.uid() <> OLD.id
     AND core.current_role() = 'admin1'
     AND NOT core.is_admin() THEN
    IF v_sensitive_changed
       OR NEW.suspended_by      IS DISTINCT FROM OLD.suspended_by
       OR NEW.suspended_at      IS DISTINCT FROM OLD.suspended_at
       OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
       OR NEW.admin_notes       IS DISTINCT FROM OLD.admin_notes
    THEN
      RAISE EXCEPTION 'Admin 1 may only approve or reject in-scope users — not change their role, scope, coach link, PLD-coach flag, suspension or notes.';
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS core_profiles_guard_privilege ON core.profiles;
CREATE TRIGGER core_profiles_guard_privilege
  BEFORE INSERT OR UPDATE ON core.profiles
  FOR EACH ROW EXECUTE FUNCTION core.guard_profile_privilege();

-- ─── PART 2 (HIGH #2): coach cannot self-certify ─────────────────
-- coaching_coach_profiles_own_update stays (coaches edit bio, specialization,
-- coach_code, …) but is_certified / certification_level become read-only to the
-- coach themselves. Admin 2 / Super Admin (verify certifications) are exempt.

CREATE OR REPLACE FUNCTION core.guard_coach_certification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL OR core.is_admin() OR core.is_super_admin() THEN
    RETURN NEW;
  END IF;
  IF auth.uid() = OLD.profile_id AND (
        NEW.is_certified        IS DISTINCT FROM OLD.is_certified
     OR NEW.certification_level IS DISTINCT FROM OLD.certification_level
  ) THEN
    RAISE EXCEPTION 'You cannot change your own certification status — an admin verifies certifications.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS coaching_coach_profiles_guard_cert ON coaching.coach_profiles;
CREATE TRIGGER coaching_coach_profiles_guard_cert
  BEFORE UPDATE ON coaching.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION core.guard_coach_certification();

-- ─── PART 3 (MEDIUM #1): scope Admin 1's notification_reads reads ─
-- Admin 2 / Super keep full read (reach counts). Admin 1 sees only read
-- receipts for profiles inside their state/PLD/school scope.

DROP POLICY IF EXISTS "notification_reads_admin_read" ON notification.notification_reads;
CREATE POLICY "notification_reads_admin_read" ON notification.notification_reads
  FOR SELECT TO authenticated
  USING (
    core.is_admin()
    OR (
      core.current_role() = 'admin1' AND core.is_approved()
      AND EXISTS (
        SELECT 1 FROM core.profiles p
        WHERE p.id = notification.notification_reads.profile_id
          AND core.admin1_in_scope(auth.uid(), p.state_id, p.pld_id, p.school_id)
      )
    )
  );

-- ─── PART 4 (MEDIUM #3): legacy app_settings → Super Admin only ───
-- No frontend path writes core.app_settings anymore (settings moved to
-- core.app_config, Super-Admin-only). Tighten the legacy surface so an Admin 2
-- cannot mutate settings contrary to the documented model.

DROP POLICY IF EXISTS "core_app_settings_admin_manage" ON core.app_settings;
CREATE POLICY "core_app_settings_super_manage" ON core.app_settings FOR ALL TO authenticated
  USING (core.is_super_admin()) WITH CHECK (core.is_super_admin());

-- ─── Reload PostgREST schema cache ───────────────────────────────
NOTIFY pgrst, 'reload schema';

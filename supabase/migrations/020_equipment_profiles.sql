-- 020_equipment_profiles.sql
-- Full equipment profile support.
-- Extends scoring.equipment_setups with detailed competition fields,
-- enforces one profile per archer, adds a coach-edit RLS policy gated by
-- the coaches_can_edit_archer_equipment system rule, and seeds new
-- permission keys for the role-permissions system.
--
-- RUN MANUALLY in Supabase SQL Editor.

-- ─── EXTEND TABLE ─────────────────────────────────────────────────────────────

ALTER TABLE scoring.equipment_setups
  ADD COLUMN IF NOT EXISTS riser_brand      text,
  ADD COLUMN IF NOT EXISTS riser_model      text,
  ADD COLUMN IF NOT EXISTS riser_length     text,
  ADD COLUMN IF NOT EXISTS limb_brand       text,
  ADD COLUMN IF NOT EXISTS limb_model       text,
  ADD COLUMN IF NOT EXISTS limb_length      text,
  ADD COLUMN IF NOT EXISTS limb_poundage    numeric(5,2),
  ADD COLUMN IF NOT EXISTS draw_length      numeric(5,2),
  ADD COLUMN IF NOT EXISTS string_brand     text,
  ADD COLUMN IF NOT EXISTS string_material  text,
  ADD COLUMN IF NOT EXISTS arrow_model      text,
  ADD COLUMN IF NOT EXISTS point_weight     numeric(5,2),
  ADD COLUMN IF NOT EXISTS nock             text,
  ADD COLUMN IF NOT EXISTS vane             text,
  ADD COLUMN IF NOT EXISTS sight_model      text,
  ADD COLUMN IF NOT EXISTS stabilizer_brand text,
  ADD COLUMN IF NOT EXISTS stabilizer_model text,
  ADD COLUMN IF NOT EXISTS clicker          text,
  ADD COLUMN IF NOT EXISTS plunger          text,
  ADD COLUMN IF NOT EXISTS arrow_rest       text,
  ADD COLUMN IF NOT EXISTS scope            text,
  ADD COLUMN IF NOT EXISTS peep             text,
  ADD COLUMN IF NOT EXISTS release          text,
  ADD COLUMN IF NOT EXISTS finger_tab       text,
  ADD COLUMN IF NOT EXISTS sling            text,
  ADD COLUMN IF NOT EXISTS updated_by       uuid REFERENCES core.profiles(id);

-- ─── ONE PROFILE PER ARCHER ───────────────────────────────────────────────────
-- Remove duplicates first (keep most recently updated row per archer)

DELETE FROM scoring.equipment_setups
WHERE id NOT IN (
  SELECT DISTINCT ON (profile_id) id
  FROM scoring.equipment_setups
  ORDER BY profile_id, updated_at DESC NULLS LAST, id DESC
);

ALTER TABLE scoring.equipment_setups
  DROP CONSTRAINT IF EXISTS equipment_setups_profile_unique;
ALTER TABLE scoring.equipment_setups
  ADD CONSTRAINT equipment_setups_profile_unique UNIQUE (profile_id);

-- ─── COACH-EDIT HELPER ────────────────────────────────────────────────────────
-- SECURITY DEFINER so the RLS policy can read core.system_rules without
-- granting direct SELECT on that table to all authenticated users.

CREATE OR REPLACE FUNCTION core.coaches_can_edit_equipment()
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = core
AS $$
  SELECT COALESCE(
    (SELECT value::text = 'true'
     FROM core.system_rules
     WHERE key = 'coaches_can_edit_archer_equipment'),
    false
  );
$$;

GRANT EXECUTE ON FUNCTION core.coaches_can_edit_equipment() TO authenticated;

-- ─── COACH UPDATE RLS POLICY ─────────────────────────────────────────────────

DROP POLICY IF EXISTS "scoring_equipment_coach_update_linked" ON scoring.equipment_setups;
CREATE POLICY "scoring_equipment_coach_update_linked"
  ON scoring.equipment_setups
  FOR UPDATE
  TO authenticated
  USING (
    core.coaches_can_edit_equipment()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id  = auth.uid()
        AND cal.archer_id = scoring.equipment_setups.profile_id
        AND cal.status    = 'active'
    )
  )
  WITH CHECK (
    core.coaches_can_edit_equipment()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id  = auth.uid()
        AND cal.archer_id = scoring.equipment_setups.profile_id
        AND cal.status    = 'active'
    )
  );

-- Coach INSERT for linked archers (when archer has no profile yet)
DROP POLICY IF EXISTS "scoring_equipment_coach_insert_linked" ON scoring.equipment_setups;
CREATE POLICY "scoring_equipment_coach_insert_linked"
  ON scoring.equipment_setups
  FOR INSERT
  TO authenticated
  WITH CHECK (
    core.coaches_can_edit_equipment()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id  = auth.uid()
        AND cal.archer_id = scoring.equipment_setups.profile_id
        AND cal.status    = 'active'
    )
  );

-- ─── REFRESH PUBLIC VIEW ──────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.equipment_setups
  WITH (security_invoker = true) AS
SELECT * FROM scoring.equipment_setups;

-- Recreating the view may clear previous grants; restore them.
GRANT SELECT, INSERT, UPDATE ON public.equipment_setups TO authenticated;

-- ─── SEED NEW PERMISSION KEYS ─────────────────────────────────────────────────

INSERT INTO system.role_permissions
  (role, permission_key, label, description, category, enabled, locked, locked_reason, updated_by)
VALUES
  ('archer',      'view_own_equipment',           'View own equipment',           null, 'equipment', true,  false, null, null),
  ('archer',      'edit_own_equipment',            'Edit own equipment',           null, 'equipment', true,  false, null, null),
  ('coach',       'access_coach_equipment',        'Access: Coach equipment',      null, 'navigation', true, false, null, null),
  ('coach',       'view_linked_archer_equipment',  'View linked archer equipment', null, 'equipment', true,  false, null, null),
  ('coach',       'edit_linked_archer_equipment',  'Edit linked archer equipment', null, 'equipment', false, false, null, null),
  ('admin2',      'view_all_equipment',            'View all equipment',           null, 'equipment', true,  false, null, null),
  ('admin2',      'edit_all_equipment',            'Edit all equipment',           null, 'equipment', true,  false, null, null),
  ('super_admin', 'view_all_equipment',            'View all equipment',           null, 'equipment', true,  false, null, null),
  ('super_admin', 'edit_all_equipment',            'Edit all equipment',           null, 'equipment', true,  false, null, null)
ON CONFLICT (role, permission_key) DO NOTHING;

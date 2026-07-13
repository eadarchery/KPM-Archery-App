-- ============================================================
-- Migration 072: KPM Retention Archer List — per-archer drill-down
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE only). Run AFTER 064.
--       Additive only — nothing renamed, dropped, or altered.
--
-- WHY: the Retention cards (Active current/previous, Returning, New
--      active, Retained, Dropout) only had COUNTS. This exposes the
--      per-archer rows behind those counts so the report can list
--      exactly WHO is active, retained, newly active or dropped out.
--
-- REUSE: reads public.kpm_archer_activity_windows (064) verbatim — the
--   SAME active_current / active_previous / days-inactive logic that the
--   summary counts use, so the lists always reconcile with the numbers.
--   SECURITY INVOKER + existing RLS scope (admin2 national, admin1 scope).
--
-- HOW EACH CARD MAPS (client filters this one list):
--   Active (current)  = active_current
--   Active (previous) = active_previous
--   Returning/Retained= active_current AND active_previous
--   New active        = active_current AND NOT active_previous
--   Dropout           = active_previous AND NOT active_current
-- ============================================================

CREATE OR REPLACE FUNCTION public.kpm_retention_archers(p_filters jsonb DEFAULT '{}'::jsonb)
RETURNS TABLE (
  archer_id uuid, archer_name text, archer_code text,
  state text, pld text, school text,
  age_group text, gender text,
  registered_at date, last_activity date,
  active_current boolean, active_previous boolean,
  days_inactive int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH aw AS (SELECT * FROM public.kpm_archer_activity_windows(p_filters))
  SELECT
    aw.archer_id, p.name, p.archer_id,
    st.name, pl.name, sc.name,
    aw.age_group, aw.gender,
    aw.registered_at, aw.last_activity,
    aw.active_current, aw.active_previous,
    aw.effective_inactive_days
  FROM aw
  JOIN core.profiles p ON p.id = aw.archer_id
  LEFT JOIN org.states  st ON st.id = aw.state_id
  LEFT JOIN org.plds    pl ON pl.id = aw.pld_id
  LEFT JOIN org.schools sc ON sc.id = aw.school_id
  ORDER BY aw.active_current DESC, aw.last_activity DESC NULLS LAST, p.name;
$$;
REVOKE EXECUTE ON FUNCTION public.kpm_retention_archers(jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.kpm_retention_archers(jsonb) TO authenticated;

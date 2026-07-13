-- ============================================================
-- Migration 057: Enable coach editing of linked archers' equipment
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent and safe to re-run. Run AFTER 020.
--
-- The full machinery already exists from migration 020:
--   • RLS "scoring_equipment_coach_update/insert_linked" — coaches can write
--     ONLY rows whose profile_id is an ACTIVE coach_archer_link of theirs,
--     and only while core.coaches_can_edit_equipment() (system rule) is true
--   • equipment_setups.updated_by column (who last changed it)
--   • role-permission key coach/edit_linked_archer_equipment
--   • app service coachUpdateEquipment() with audit logging
--
-- It shipped DISABLED by default. Product decision (launch readiness item 4):
-- coaches keep their own archers' equipment accurate, reducing admin workload.
-- This migration flips the two switches ON. Super Admin can still turn the
-- system rule off at any time from System Rules — the RLS gate reads it live.
-- ============================================================

-- 1. System rule: allow the RLS coach-edit policies to pass.
UPDATE core.system_rules
   SET value = 'true'
 WHERE key = 'coaches_can_edit_archer_equipment';

-- 2. Role permission: what the app UI checks before showing edit controls.
UPDATE system.role_permissions
   SET enabled = true, updated_at = now()
 WHERE role = 'coach'
   AND permission_key = 'edit_linked_archer_equipment';

-- ─── SCOPE GUARANTEES (unchanged, for the reviewer) ─────────────
--  • Coach → only linked archers (RLS joins coach_archer_links status='active').
--  • Archer → own row only (existing self policies).
--  • Admin 2 / Super Admin → all rows (existing admin policies).
--  • Admin 1 → read within scope via existing view policies; no write policy.
--  • Every save stamps updated_by + updated_at and writes an audit log entry
--    ('equipment.coach_updated' when a coach saves).

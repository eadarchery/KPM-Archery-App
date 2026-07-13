-- ============================================================
-- Migration 016: Role Permissions (per-role capability matrix)
-- Super-admin-managed. NEW table in a NEW `system` schema so it does
-- NOT collide with the legacy core.permission_rules (public.permissions)
-- or core.role_permissions (jsonb blob) tables.
--   Real table : system.role_permissions
--   Public view: public.role_permissions  (security_invoker)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS system;
GRANT USAGE ON SCHEMA system TO authenticated, anon, service_role;

-- ─── TABLE ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system.role_permissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role           text NOT NULL CHECK (role IN ('archer','coach','admin1','admin2','super_admin')),
  permission_key text NOT NULL,
  label          text NOT NULL,
  description    text,
  category       text NOT NULL,
  enabled        boolean NOT NULL DEFAULT false,
  locked         boolean NOT NULL DEFAULT false,
  locked_reason  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES core.profiles(id),
  CONSTRAINT system_role_permissions_role_key UNIQUE (role, permission_key)
);

CREATE INDEX IF NOT EXISTS role_permissions_role_idx     ON system.role_permissions(role);
CREATE INDEX IF NOT EXISTS role_permissions_category_idx ON system.role_permissions(category);

CREATE OR REPLACE TRIGGER system_role_permissions_updated_at
  BEFORE UPDATE ON system.role_permissions
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────
-- Super admin: full control. Admin2: read-all (operational visibility).
-- Other approved users: read only their OWN role's rows. No anon access.

ALTER TABLE system.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_super_admin_all" ON system.role_permissions;
CREATE POLICY "role_permissions_super_admin_all" ON system.role_permissions
  FOR ALL TO authenticated
  USING (core.is_super_admin())
  WITH CHECK (core.is_super_admin());

DROP POLICY IF EXISTS "role_permissions_admin2_read" ON system.role_permissions;
CREATE POLICY "role_permissions_admin2_read" ON system.role_permissions
  FOR SELECT TO authenticated
  USING (core.is_admin());   -- admin2 + super_admin (read-only here)

DROP POLICY IF EXISTS "role_permissions_own_role_read" ON system.role_permissions;
CREATE POLICY "role_permissions_own_role_read" ON system.role_permissions
  FOR SELECT TO authenticated
  USING (core.is_approved() AND role = core.current_role()::text);

-- ─── GRANTS ────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON system.role_permissions TO authenticated;
GRANT ALL                           ON system.role_permissions TO service_role;

-- ─── PUBLIC VIEW ───────────────────────────────────────────────
-- Frontend queries supabase.from('role_permissions') → this view.

CREATE OR REPLACE VIEW public.role_permissions
  WITH (security_invoker = true) AS
SELECT * FROM system.role_permissions;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;

-- ─── SEED DEFAULTS ─────────────────────────────────────────────
-- Catalog (key, label, category) × 5 roles, with enabled/locked computed.
-- Idempotent: ON CONFLICT (role, permission_key) DO NOTHING. Mirrors
-- PERMISSION_CATALOG + per-role defaults in src/services/rolePermissions.ts.

WITH cat(key, label, category) AS (VALUES
  -- Navigation
  ('access_archer_dashboard','Access: Archer dashboard','navigation'),
  ('access_archer_scores','Access: Archer scores','navigation'),
  ('access_archer_achievements','Access: Archer achievements','navigation'),
  ('access_archer_notifications','Access: Archer notifications','navigation'),
  ('access_archer_equipment','Access: Archer equipment','navigation'),
  ('access_coach_dashboard','Access: Coach dashboard','navigation'),
  ('access_coach_archers','Access: Coach archers','navigation'),
  ('access_coach_scores','Access: Coach scores','navigation'),
  ('access_coach_achievements','Access: Coach achievements','navigation'),
  ('access_coach_notifications','Access: Coach notifications','navigation'),
  ('access_coach_certifications','Access: Coach certifications','navigation'),
  ('access_admin1_dashboard','Access: Admin 1 dashboard','navigation'),
  ('access_admin1_approvals','Access: Admin 1 approvals','navigation'),
  ('access_admin1_schools','Access: Admin 1 schools','navigation'),
  ('access_admin1_coaches','Access: Admin 1 coaches','navigation'),
  ('access_admin1_notifications','Access: Admin 1 notifications','navigation'),
  ('access_admin1_reports','Access: Admin 1 reports','navigation'),
  ('access_admin2_dashboard','Access: Admin 2 dashboard','navigation'),
  ('access_admin2_achievements','Access: Admin 2 achievements','navigation'),
  ('access_admin2_notifications','Access: Admin 2 notifications','navigation'),
  ('access_admin2_articles','Access: Admin 2 articles','navigation'),
  ('access_admin2_users','Access: Admin 2 users','navigation'),
  ('access_admin2_schools','Access: Admin 2 schools','navigation'),
  ('access_admin2_plds','Access: Admin 2 PLDs','navigation'),
  ('access_admin2_states','Access: Admin 2 states','navigation'),
  ('access_admin2_reports','Access: Admin 2 reports','navigation'),
  ('access_admin2_audit','Access: Admin 2 audit','navigation'),
  ('access_super_admin_dashboard','Access: Super Admin dashboard','navigation'),
  ('access_super_admin_system_rules','Access: Super Admin system rules','navigation'),
  ('access_super_admin_role_permissions','Access: Super Admin role permissions','navigation'),
  ('access_super_admin_users','Access: Super Admin users','navigation'),
  ('access_super_admin_settings','Access: Super Admin settings','navigation'),
  ('access_super_admin_audit_logs','Access: Super Admin audit logs','navigation'),
  ('access_super_admin_change_requests','Access: Super Admin change requests','navigation'),
  ('access_articles','Access: Articles','navigation'),
  -- Users
  ('view_users','View users','users'),
  ('create_users','Create users','users'),
  ('edit_users','Edit users','users'),
  ('approve_users','Approve users','users'),
  ('reject_users','Reject users','users'),
  ('suspend_users','Suspend users','users'),
  ('reactivate_users','Reactivate users','users'),
  ('change_user_role','Change user role','users'),
  ('assign_user_school','Assign user school','users'),
  ('assign_user_pld','Assign user PLD','users'),
  ('assign_user_state','Assign user state','users'),
  ('link_coach_to_archer','Link coach to archer','users'),
  ('unlink_coach_from_archer','Unlink coach from archer','users'),
  ('delete_users','Delete users','users'),
  ('manage_admin1_users','Manage Admin 1 users','users'),
  ('manage_admin2_users','Manage Admin 2 users','users'),
  ('manage_super_admin_users','Manage Super Admin users','users'),
  -- Scores
  ('submit_own_training_score','Submit own training score','scores'),
  ('submit_own_tournament_score','Submit own tournament score','scores'),
  ('submit_score_for_archer','Submit score for archer','scores'),
  ('edit_own_score','Edit own score','scores'),
  ('edit_archer_score','Edit archer score','scores'),
  ('delete_own_score','Delete own score','scores'),
  ('delete_archer_score','Delete archer score','scores'),
  ('validate_training_score','Validate training score','scores'),
  ('validate_tournament_score','Validate tournament score','scores'),
  ('reject_score','Reject score','scores'),
  ('request_score_resubmission','Request score resubmission','scores'),
  ('upload_tournament_proof','Upload tournament proof','scores'),
  ('review_tournament_proof','Review tournament proof','scores'),
  ('approve_tournament_proof','Approve tournament proof','scores'),
  -- Achievements
  ('view_own_achievements','View own achievements','achievements'),
  ('view_linked_archer_achievements','View linked archer achievements','achievements'),
  ('view_all_achievements','View all achievements','achievements'),
  ('create_achievement_definition','Create achievement definition','achievements'),
  ('edit_achievement_definition','Edit achievement definition','achievements'),
  ('activate_achievement_definition','Activate achievement definition','achievements'),
  ('deactivate_achievement_definition','Deactivate achievement definition','achievements'),
  ('upload_achievement_badge','Upload achievement badge','achievements'),
  ('manually_grant_achievement','Manually grant achievement','achievements'),
  ('revoke_achievement','Revoke achievement','achievements'),
  -- Notifications
  ('view_own_notifications','View own notifications','notifications'),
  ('mark_notification_read','Mark notification read','notifications'),
  ('create_notification','Create notification','notifications'),
  ('edit_notification','Edit notification','notifications'),
  ('publish_notification','Publish notification','notifications'),
  ('schedule_notification','Schedule notification','notifications'),
  ('archive_notification','Archive notification','notifications'),
  ('delete_notification','Delete notification','notifications'),
  ('send_global_notification','Send global notification','notifications'),
  ('send_role_notification','Send role notification','notifications'),
  ('send_scope_notification','Send scope notification','notifications'),
  ('send_archer_notification','Send archer notification','notifications'),
  -- Articles
  ('view_articles','View articles','articles'),
  ('create_article','Create article','articles'),
  ('edit_article','Edit article','articles'),
  ('publish_article','Publish article','articles'),
  ('archive_article','Archive article','articles'),
  ('delete_article','Delete article','articles'),
  ('duplicate_article','Duplicate article','articles'),
  ('upload_article_media','Upload article media','articles'),
  ('submit_article_suggestion','Submit article suggestion','articles'),
  ('review_article_suggestion','Review article suggestion','articles'),
  -- Organization
  ('view_schools','View schools','organization'),
  ('create_school','Create school','organization'),
  ('edit_school','Edit school','organization'),
  ('archive_school','Archive school','organization'),
  ('delete_school','Delete school','organization'),
  ('view_plds','View PLDs','organization'),
  ('create_pld','Create PLD','organization'),
  ('edit_pld','Edit PLD','organization'),
  ('archive_pld','Archive PLD','organization'),
  ('delete_pld','Delete PLD','organization'),
  ('view_states','View states','organization'),
  ('create_state','Create state','organization'),
  ('edit_state','Edit state','organization'),
  ('archive_state','Archive state','organization'),
  ('delete_state','Delete state','organization'),
  -- Reports & Audit
  ('view_own_reports','View own reports','reports'),
  ('view_linked_archer_reports','View linked archer reports','reports'),
  ('view_school_reports','View school reports','reports'),
  ('view_pld_reports','View PLD reports','reports'),
  ('view_state_reports','View state reports','reports'),
  ('view_national_reports','View national reports','reports'),
  ('export_reports','Export reports','reports'),
  ('view_audit_logs','View audit logs','reports'),
  ('export_audit_logs','Export audit logs','reports'),
  -- System
  ('manage_system_rules','Manage system rules','system'),
  ('manage_role_permissions','Manage role permissions','system'),
  ('manage_feature_flags','Manage feature flags','system'),
  ('enable_maintenance_mode','Enable maintenance mode','system'),
  ('disable_maintenance_mode','Disable maintenance mode','system'),
  ('manage_app_settings','Manage app settings','system'),
  ('view_change_requests','View change requests','system'),
  ('approve_change_requests','Approve change requests','system'),
  ('reject_change_requests','Reject change requests','system')
),
roles(role) AS (VALUES ('archer'),('coach'),('admin1'),('admin2'),('super_admin'))
INSERT INTO system.role_permissions (role, permission_key, label, description, category, enabled, locked, locked_reason)
SELECT
  r.role, c.key, c.label, NULL, c.category,
  -- enabled: per-role default, but locked-OFF keys are forced false for lower roles
  (CASE
    WHEN r.role = 'super_admin' THEN true
    WHEN r.role = 'archer' AND c.key IN (
      'access_archer_dashboard','access_archer_scores','access_archer_achievements',
      'access_archer_notifications','access_archer_equipment','access_articles',
      'submit_own_training_score','submit_own_tournament_score','edit_own_score',
      'upload_tournament_proof','view_own_achievements','view_own_notifications',
      'mark_notification_read','view_articles','view_own_reports'
    ) THEN true
    WHEN r.role = 'coach' AND c.key IN (
      'access_coach_dashboard','access_coach_archers','access_coach_scores',
      'access_coach_achievements','access_coach_notifications','access_coach_certifications',
      'access_articles','submit_score_for_archer','view_linked_archer_achievements',
      'view_own_notifications','mark_notification_read','view_articles',
      'view_linked_archer_reports','validate_training_score','edit_archer_score'
    ) THEN true
    WHEN r.role = 'admin1' AND c.key IN (
      'access_admin1_dashboard','access_admin1_approvals','access_admin1_schools',
      'access_admin1_coaches','access_admin1_notifications','access_admin1_reports',
      'access_articles','view_users','view_schools','view_school_reports',
      'view_pld_reports','view_state_reports','view_own_notifications',
      'mark_notification_read','view_articles','send_scope_notification'
    ) THEN true
    WHEN r.role = 'admin2' AND c.key IN (
      'access_admin2_dashboard','access_admin2_achievements','access_admin2_notifications',
      'access_admin2_articles','access_admin2_users','access_admin2_schools',
      'access_admin2_plds','access_admin2_states','access_admin2_reports','access_admin2_audit',
      'access_articles','view_users','create_users','edit_users','approve_users','reject_users',
      'suspend_users','reactivate_users','change_user_role','assign_user_school','assign_user_pld',
      'assign_user_state','link_coach_to_archer','unlink_coach_from_archer','validate_training_score',
      'validate_tournament_score','reject_score','request_score_resubmission','review_tournament_proof',
      'approve_tournament_proof','view_all_achievements','create_achievement_definition',
      'edit_achievement_definition','activate_achievement_definition','deactivate_achievement_definition',
      'upload_achievement_badge','view_own_notifications','mark_notification_read','create_notification',
      'edit_notification','publish_notification','schedule_notification','archive_notification',
      'delete_notification','send_global_notification','send_role_notification','send_scope_notification',
      'view_articles','create_article','edit_article','publish_article','archive_article','delete_article',
      'duplicate_article','upload_article_media','view_schools','create_school','edit_school','archive_school',
      'view_plds','create_pld','edit_pld','archive_pld','view_states','create_state','edit_state','archive_state',
      'view_national_reports','export_reports','view_audit_logs'
    ) THEN true
    ELSE false
  END)
  AND NOT (r.role <> 'super_admin' AND c.key IN (
    'manage_role_permissions','manage_system_rules','manage_super_admin_users',
    'access_super_admin_role_permissions','access_super_admin_system_rules',
    'enable_maintenance_mode','disable_maintenance_mode'
  )) AS enabled,
  -- locked
  (CASE
    WHEN r.role = 'super_admin' AND c.key IN (
      'manage_system_rules','manage_role_permissions','access_super_admin_dashboard',
      'access_super_admin_system_rules','access_super_admin_role_permissions'
    ) THEN true
    WHEN r.role <> 'super_admin' AND c.key IN (
      'manage_role_permissions','manage_system_rules','manage_super_admin_users',
      'access_super_admin_role_permissions','access_super_admin_system_rules',
      'enable_maintenance_mode','disable_maintenance_mode'
    ) THEN true
    ELSE false
  END) AS locked,
  -- locked_reason
  (CASE
    WHEN r.role = 'super_admin' AND c.key IN (
      'manage_system_rules','manage_role_permissions','access_super_admin_dashboard',
      'access_super_admin_system_rules','access_super_admin_role_permissions'
    ) THEN 'Required for Super Admin — cannot be disabled.'
    WHEN r.role <> 'super_admin' AND c.key IN (
      'manage_role_permissions','manage_system_rules','manage_super_admin_users',
      'access_super_admin_role_permissions','access_super_admin_system_rules',
      'enable_maintenance_mode','disable_maintenance_mode'
    ) THEN 'Restricted to Super Admin.'
    ELSE NULL
  END) AS locked_reason
FROM cat c CROSS JOIN roles r
ON CONFLICT (role, permission_key) DO NOTHING;

-- ─── NOTES ─────────────────────────────────────────────────────
-- The frontend keeps the same catalog + per-role defaults in
-- src/services/rolePermissions.ts (PERMISSION_CATALOG + ROLE_ENABLED) for
-- "reset role to default" and "restore missing defaults". Keep them in sync.

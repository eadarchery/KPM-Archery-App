-- ============================================================
-- Migration 015: System Rules (global feature flags / app rules)
-- Super-admin-controlled, app-wide rules and feature flags.
--   Real table : core.system_rules
--   Public view: public.system_rules  (security_invoker)
-- Follows the same pattern as core.app_settings (003/006/008).
-- ============================================================

-- ─── TABLE ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS core.system_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  label       text NOT NULL,
  description text,
  category    text NOT NULL,
  value       jsonb NOT NULL DEFAULT 'false'::jsonb,
  value_type  text NOT NULL DEFAULT 'boolean'
    CHECK (value_type IN ('boolean', 'string', 'number', 'json')),
  is_public   boolean NOT NULL DEFAULT false,
  editable_by text[] NOT NULL DEFAULT ARRAY['super_admin'],
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES core.profiles(id)
);

CREATE INDEX IF NOT EXISTS system_rules_category_idx ON core.system_rules(category);
CREATE INDEX IF NOT EXISTS system_rules_public_idx   ON core.system_rules(is_public) WHERE is_public;

CREATE OR REPLACE TRIGGER core_system_rules_updated_at
  BEFORE UPDATE ON core.system_rules
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── RLS ───────────────────────────────────────────────────────
-- Super admin: full control. Admin2: read-all (operational visibility).
-- Everyone approved: read public feature flags only. No anon access.

ALTER TABLE core.system_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_rules_super_admin_all" ON core.system_rules;
CREATE POLICY "system_rules_super_admin_all" ON core.system_rules
  FOR ALL TO authenticated
  USING (core.is_super_admin())
  WITH CHECK (core.is_super_admin());

DROP POLICY IF EXISTS "system_rules_admin2_read" ON core.system_rules;
CREATE POLICY "system_rules_admin2_read" ON core.system_rules
  FOR SELECT TO authenticated
  USING (core.is_admin());   -- admin2 + super_admin (read-only here)

DROP POLICY IF EXISTS "system_rules_public_read" ON core.system_rules;
CREATE POLICY "system_rules_public_read" ON core.system_rules
  FOR SELECT TO authenticated
  USING (is_public = true AND core.is_approved());

-- ─── GRANTS ────────────────────────────────────────────────────
-- Table-level grants are required before RLS runs (rows still filtered).

GRANT SELECT, INSERT, UPDATE, DELETE ON core.system_rules TO authenticated;
GRANT ALL                           ON core.system_rules TO service_role;

-- ─── PUBLIC VIEW ───────────────────────────────────────────────
-- Frontend queries supabase.from('system_rules') → this view.
-- security_invoker = true so the underlying table's RLS applies.

CREATE OR REPLACE VIEW public.system_rules
  WITH (security_invoker = true) AS
SELECT * FROM core.system_rules;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_rules TO authenticated;

-- ─── SEED DEFAULT RULES ────────────────────────────────────────
-- ON CONFLICT (key) DO NOTHING → idempotent; never overwrites a value
-- a super admin has already customised. Safe to re-run.

INSERT INTO core.system_rules (key, label, description, category, value, value_type, is_public) VALUES
-- 1. Modules (feature flags — public so the frontend can gate pages)
('module_scores_enabled',          'Scores module',          'Enable the scoring module across the app.',                'modules', 'true',  'boolean', true),
('module_achievements_enabled',    'Achievements module',    'Enable the achievements / badges module.',                 'modules', 'true',  'boolean', true),
('module_notifications_enabled',   'Notifications module',   'Enable the notifications module.',                         'modules', 'true',  'boolean', true),
('module_articles_enabled',        'Articles module',        'Enable the articles / learning content module.',           'modules', 'true',  'boolean', true),
('module_equipment_enabled',       'Equipment module',       'Enable archer/coach equipment profiles.',                  'modules', 'true',  'boolean', true),
('module_reports_enabled',         'Reports module',         'Enable reporting dashboards.',                             'modules', 'true',  'boolean', true),
('module_leaderboard_enabled',     'Leaderboard module',     'Enable the leaderboard module.',                           'modules', 'true',  'boolean', true),
('module_certifications_enabled',  'Certifications module',  'Enable coach certifications.',                             'modules', 'true',  'boolean', true),

-- 2. Registration and approval
('archer_registration_requires_approval', 'Archer registration needs approval', 'New archer accounts require approval before access.', 'registration', 'true',  'boolean', false),
('coach_registration_requires_approval',  'Coach registration needs approval',  'New coach accounts require approval before access.',  'registration', 'true',  'boolean', false),
('student_requires_school_approval',      'Student needs school approval',      'Students must be approved by their school.',          'registration', 'false', 'boolean', false),
('coach_requires_admin_approval',         'Coach needs admin approval',         'Coaches must be approved by an admin.',               'registration', 'true',  'boolean', false),
('admin1_can_approve_archers',            'Admin 1 can approve archers',        'Allow Admin 1 to approve archer registrations.',      'registration', 'false', 'boolean', false),
('admin1_can_approve_coaches',            'Admin 1 can approve coaches',        'Allow Admin 1 to approve coach registrations.',       'registration', 'false', 'boolean', false),
('admin2_can_approve_all_users',          'Admin 2 can approve all users',      'Allow Admin 2 to approve any user registration.',     'registration', 'true',  'boolean', false),

-- 3. Score submission
('archers_can_submit_training_scores',         'Archers submit training scores',     'Archers may submit their own training scores.',           'scores', 'true',  'boolean', true),
('archers_can_submit_tournament_scores',       'Archers submit tournament scores',   'Archers may submit their own tournament scores.',         'scores', 'true',  'boolean', true),
('coaches_can_submit_scores_for_archers',      'Coaches submit for archers',         'Coaches may submit scores on behalf of linked archers.',  'scores', 'true',  'boolean', false),
('allow_score_edit_after_submission',          'Allow score edit after submit',      'Allow editing a score after it has been submitted.',      'scores', 'true',  'boolean', false),
('score_edit_time_limit_hours',                'Score edit time limit (hours)',      'Hours during which a submitted score may still be edited.','scores', '24',    'number',  false),
('require_score_validation_before_leaderboard','Validate before leaderboard',        'Scores must be validated before counting on leaderboard.','scores', 'true',  'boolean', false),

-- 4. Score validation
('coach_can_validate_training_scores',      'Coach validates training scores',    'Coaches may validate training scores.',                 'validation', 'true',  'boolean', false),
('coach_can_validate_tournament_scores',    'Coach validates tournament scores',  'Coaches may validate tournament scores.',               'validation', 'false', 'boolean', false),
('admin1_can_validate_training_scores',     'Admin 1 validates training scores',  'Allow Admin 1 to validate training scores.',            'validation', 'false', 'boolean', false),
('admin2_can_validate_tournament_scores',   'Admin 2 validates tournament scores','Allow Admin 2 to validate tournament scores.',          'validation', 'true',  'boolean', false),
('tournament_scores_require_proof',         'Tournament scores need proof',       'Tournament scores require uploaded proof.',             'validation', 'true',  'boolean', false),
('tournament_scores_require_admin2_approval','Tournament needs Admin 2 approval', 'Tournament scores require final Admin 2 approval.',      'validation', 'true',  'boolean', false),
('rejected_scores_can_be_resubmitted',      'Rejected scores can resubmit',       'Allow resubmission of rejected scores.',                'validation', 'true',  'boolean', false),

-- 5. Achievements
('achievements_auto_grant_enabled',           'Auto-grant achievements',        'Automatically grant achievements when earned.',          'achievements', 'true', 'boolean', false),
('achievements_show_locked_badges',           'Show locked badges',             'Show locked / not-yet-earned badges to users.',          'achievements', 'true', 'boolean', true),
('achievements_show_progress',                'Show achievement progress',      'Show progress toward locked achievements.',              'achievements', 'true', 'boolean', true),
('achievement_badges_public_to_coach',        'Badges visible to coach',        'Coaches can see their archers'' earned badges.',         'achievements', 'true', 'boolean', false),
('achievement_badges_public_to_school_admin', 'Badges visible to school admin', 'School admins can see earned badges.',                   'achievements', 'true', 'boolean', false),

-- 6. Notifications
('notifications_enabled',                  'Notifications enabled',           'Master switch for sending notifications.',               'notifications', 'true',  'boolean', true),
('admin2_can_send_global_notifications',   'Admin 2 global notifications',    'Allow Admin 2 to send app-wide notifications.',          'notifications', 'true',  'boolean', false),
('admin1_can_send_scope_notifications',    'Admin 1 scoped notifications',    'Allow Admin 1 to send notifications within its scope.',  'notifications', 'true',  'boolean', false),
('coaches_can_send_archer_notifications',  'Coaches notify archers',          'Allow coaches to notify their linked archers.',          'notifications', 'false', 'boolean', false),
('urgent_notifications_enabled',           'Urgent notifications',            'Allow high-priority / urgent notifications.',            'notifications', 'true',  'boolean', false),

-- 7. Articles
('articles_enabled',                      'Articles enabled',                 'Master switch for the articles feature.',                'articles', 'true',  'boolean', true),
('admin2_can_publish_articles',           'Admin 2 publishes articles',       'Allow Admin 2 to publish articles.',                     'articles', 'true',  'boolean', false),
('admin1_can_create_articles',            'Admin 1 creates articles',         'Allow Admin 1 to create articles.',                      'articles', 'false', 'boolean', false),
('coaches_can_submit_article_suggestions','Coaches suggest articles',         'Allow coaches to submit article suggestions.',           'articles', 'false', 'boolean', false),
('articles_require_review_before_publish', 'Articles need review',            'Articles require review before they can be published.',   'articles', 'false', 'boolean', false),

-- 8. Equipment
('equipment_profiles_enabled',        'Equipment profiles enabled', 'Enable equipment setup profiles.',                'equipment', 'true',  'boolean', true),
('archers_can_edit_own_equipment',    'Archers edit own equipment', 'Allow archers to edit their own equipment setup.','equipment', 'true',  'boolean', false),
('coaches_can_view_archer_equipment', 'Coaches view equipment',     'Allow coaches to view linked archers'' equipment.','equipment', 'true',  'boolean', false),
('coaches_can_edit_archer_equipment', 'Coaches edit equipment',     'Allow coaches to edit linked archers'' equipment.','equipment', 'false', 'boolean', false),
('equipment_change_requires_approval','Equipment change needs approval','Equipment changes require approval.',           'equipment', 'false', 'boolean', false),

-- 9. Leaderboard and reports
('leaderboard_enabled',                    'Leaderboard enabled',          'Master switch for the leaderboard.',                 'leaderboard', 'true', 'boolean', true),
('leaderboard_requires_validated_scores',  'Leaderboard validated only',   'Only validated scores appear on the leaderboard.',   'leaderboard', 'true', 'boolean', false),
('leaderboard_show_school',                'Leaderboard shows school',     'Show school column on the leaderboard.',             'leaderboard', 'true', 'boolean', true),
('leaderboard_show_state',                 'Leaderboard shows state',      'Show state column on the leaderboard.',              'leaderboard', 'true', 'boolean', true),
('leaderboard_show_pld',                   'Leaderboard shows PLD',        'Show PLD column on the leaderboard.',                'leaderboard', 'true', 'boolean', true),
('admin1_reports_scope_limited',           'Admin 1 reports scope-limited','Limit Admin 1 reports to its assigned scope.',       'leaderboard', 'true', 'boolean', false),
('coach_reports_limited_to_linked_archers','Coach reports linked only',    'Limit coach reports to linked archers only.',        'leaderboard', 'true', 'boolean', false),

-- 10. System
('maintenance_mode',                'Maintenance mode',            'Put the app in maintenance mode for non-admin users.',     'system', 'false', 'boolean', true),
('allow_new_registrations',         'Allow new registrations',     'Allow new users to register.',                            'system', 'true',  'boolean', true),
('show_beta_features',              'Show beta features',          'Expose beta / experimental features.',                    'system', 'false', 'boolean', true),
('enable_audit_log_export',         'Enable audit log export',     'Allow exporting audit logs.',                             'system', 'false', 'boolean', false),
('strict_role_permissions_enabled', 'Strict role permissions',     'Enforce strict role permission checks everywhere.',       'system', 'false', 'boolean', false)
ON CONFLICT (key) DO NOTHING;

-- ─── NOTES ─────────────────────────────────────────────────────
-- The frontend keeps a matching catalog in src/services/systemRules.ts
-- (DEFAULT_SYSTEM_RULES) for "restore missing defaults" and "reset to
-- default". Keep the two in sync when adding new rules.

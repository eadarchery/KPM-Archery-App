-- ============================================================
-- Migration 026: App Config (general app settings, key-value)
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--
-- Distinct from system.system_rules (operational feature toggles).
-- This table stores general app behavior defaults:
--   display, contact, registration text, pagination, notifications,
--   articles, reports, and advanced settings.
--
-- Real table : core.app_config
-- Public view: public.app_config  (security_invoker = true)
--
-- Follows the exact same pattern as core.system_rules / public.system_rules
-- (migrations 015, 006).
-- ============================================================

-- ─── TABLE ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS core.app_config (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        UNIQUE NOT NULL,
  label       text        NOT NULL,
  description text,
  category    text        NOT NULL,
  value       jsonb       NOT NULL DEFAULT 'null'::jsonb,
  value_type  text        NOT NULL DEFAULT 'string'
              CHECK (value_type IN ('boolean', 'string', 'number', 'json')),
  is_public   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES core.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS app_config_category_idx ON core.app_config(category);
CREATE INDEX IF NOT EXISTS app_config_public_idx   ON core.app_config(is_public) WHERE is_public;

CREATE OR REPLACE TRIGGER core_app_config_updated_at
  BEFORE UPDATE ON core.app_config
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────
-- Super admin: full control.
-- Admin 2: read-all (operational visibility in future admin2 view).
-- All approved: read public settings only.

ALTER TABLE core.app_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_config_super_admin_all" ON core.app_config;
CREATE POLICY "app_config_super_admin_all" ON core.app_config
  FOR ALL TO authenticated
  USING (core.is_super_admin()) WITH CHECK (core.is_super_admin());

DROP POLICY IF EXISTS "app_config_admin2_read" ON core.app_config;
CREATE POLICY "app_config_admin2_read" ON core.app_config
  FOR SELECT TO authenticated
  USING (core.is_admin());

DROP POLICY IF EXISTS "app_config_public_read" ON core.app_config;
CREATE POLICY "app_config_public_read" ON core.app_config
  FOR SELECT TO authenticated
  USING (is_public = true AND core.is_approved());

-- ─── GRANTS ───────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON core.app_config TO authenticated;
GRANT ALL                            ON core.app_config TO service_role;

-- ─── PUBLIC VIEW ──────────────────────────────────────────────
-- Frontend queries supabase.from('app_config') → this view.
-- security_invoker = true so the underlying table's RLS applies.

CREATE OR REPLACE VIEW public.app_config
  WITH (security_invoker = true) AS
SELECT * FROM core.app_config;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_config TO authenticated;

-- ─── SEED DEFAULT SETTINGS ────────────────────────────────────
-- ON CONFLICT (key) DO NOTHING → idempotent; never overwrites a value
-- a super admin has already customised. Safe to re-run.

INSERT INTO core.app_config (key, label, description, category, value, value_type, is_public) VALUES

-- ── General ──────────────────────────────────────────────────
('app_display_name',   'App display name',   'Full name shown in headers and page titles.',                                               'app_general', '"EAD Archery Scene Monitor"',                                                  'string',  true),
('app_short_name',     'App short name',      'Short name used in compact areas and mobile headers.',                                     'app_general', '"EAD ASM"',                                                                    'string',  true),
('default_country',    'Default country',     'Default country for addresses and phone number formats.',                                  'app_general', '"Malaysia"',                                                                   'string',  false),
('default_timezone',   'Default timezone',    'Default timezone for date/time display. Changing this affects all date formatting.',       'app_general', '"Asia/Kuala_Lumpur"',                                                          'string',  false),
('default_date_format','Date format',         'Format for displaying dates (e.g. DD/MM/YYYY or YYYY-MM-DD).',                            'app_general', '"DD/MM/YYYY"',                                                                 'string',  true),
('default_time_format','Time format',         'Format for displaying times (e.g. HH:mm or hh:mm a).',                                   'app_general', '"HH:mm"',                                                                      'string',  false),

-- ── Contact ───────────────────────────────────────────────────
('support_email',      'Support email',       'Email shown to users on help and pending-approval screens. Changing this updates the contact shown to new registrants.', 'app_contact', '""', 'string', true),
('support_phone',      'Support phone',       'Phone number shown on help and contact screens.',                                         'app_contact', '""',                                                                           'string',  true),
('support_whatsapp',   'Support WhatsApp',    'WhatsApp number for user support. Shown on the pending-approval page.',                   'app_contact', '""',                                                                           'string',  true),
('help_center_url',    'Help centre URL',     'Link to external help documentation or knowledge base.',                                  'app_contact', '""',                                                                           'string',  true),

-- ── Registration ──────────────────────────────────────────────
('registration_help_text',        'Registration help text',   'Shown at the top of the registration page. Changing this updates the onboarding message for all new users.',    'app_registration', '"Register to join the EAD Archery Scene Monitor. An admin will review and approve your account."',             'string', true),
('coach_registration_help_text',  'Coach registration help',  'Extra help text shown during coach registration.',                                                              'app_registration', '"Coaches must provide certification details. Accounts are reviewed before access is granted."',                  'string', true),
('archer_registration_help_text', 'Archer registration help', 'Extra help text shown during archer registration.',                                                            'app_registration', '"Archers must be linked to a school. Your account will be reviewed before access is granted."',                  'string', true),
('approval_pending_message',      'Approval pending message', 'Shown to users whose account is still pending. Changing this updates the holding message for all new registrants.', 'app_registration', '"Your account is pending review. You will be notified when it is approved."',                              'string', true),

-- ── Display ───────────────────────────────────────────────────
('default_page_size',           'Default page size',         'Default number of rows per page in list views. Affects all admin tables.',                'app_display', '20',                                                        'number',  false),
('default_dashboard_date_range','Dashboard date range',      'Default date range on dashboards (1d, 1w, 1m, 3m, 6m, 1y, all).',                        'app_display', '"3m"',                                                      'string',  false),
('show_footer_text',            'Show footer text',          'Show the footer text at the bottom of the app.',                                          'app_display', 'true',                                                      'boolean', true),
('footer_text',                 'Footer text',               'Text shown in the app footer. Visible to all users.',                                     'app_display', '"© 2025 EAD Archery Scene Monitor. All rights reserved."', 'string',  true),
('show_beta_badge',             'Show beta badge',           'Show a beta indicator badge on experimental features.',                                   'app_display', 'false',                                                     'boolean', true),

-- ── Notifications ─────────────────────────────────────────────
('notification_auto_mark_read',      'Auto-mark notifications read',    'Automatically mark notifications as read when viewed.',                                     'app_notifications', 'false',    'boolean', false),
('notification_default_priority',    'Default notification priority',   'Default priority for new notifications (low, normal, high, urgent).',                       'app_notifications', '"normal"', 'string',  false),
('notification_show_expired_days',   'Show expired notifications (days)', 'How many days to keep showing expired notifications in the inbox.',                       'app_notifications', '7',        'number',  false),

-- ── Articles ──────────────────────────────────────────────────
('articles_default_sort',        'Default article sort',         'Default sort order for articles (newest, oldest, featured). Affects browsing order for all users.', 'app_articles', '"newest"', 'string',  false),
('articles_show_featured_first', 'Featured articles first',      'Featured articles always appear at the top of article lists.',                                       'app_articles', 'true',     'boolean', false),
('articles_cards_per_page',      'Article cards per page',       'Number of article cards per page. Changing this affects the browsing experience.',                   'app_articles', '12',       'number',  false),

-- ── Reports ───────────────────────────────────────────────────
('reports_default_date_range',  'Default report date range',    'Default time window on report pages (1d, 1w, 1m, 3m, 6m, 1y, all).',                     'app_reports', '"3m"',     'string',  false),
('reports_default_grouping',    'Default report grouping',      'Default breakdown grouping for reports (state, pld, school).',                            'app_reports', '"state"',  'string',  false),
('reports_show_export_button',  'Show export button on reports', 'Show the CSV export button on report pages.',                                             'app_reports', 'true',     'boolean', false),

-- ── Advanced ──────────────────────────────────────────────────
('session_inactivity_warning_minutes', 'Inactivity warning (minutes)', 'Show an inactivity warning after this many minutes. Display-only; does not force logout.', 'app_advanced', '30', 'number', false),
('max_upload_size_mb',                 'Max upload size (MB)',          'Maximum allowed file upload size in megabytes.',                                           'app_advanced', '10', 'number', false)

ON CONFLICT (key) DO NOTHING;

-- ─── NOTES ────────────────────────────────────────────────────
--  • This table intentionally excludes branding assets (logo, favicon, colors) —
--    those belong in the future Super Admin Branding page.
--  • Settings marked is_public = true are readable by all approved users;
--    they can safely be used in frontend registration/help screens.
--  • Do not store API keys, secrets, or passwords here.

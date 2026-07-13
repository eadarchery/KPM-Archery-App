-- ============================================================
-- Migration 008: Schema & Table Grants
-- RLS policies restrict rows, but PostgreSQL also requires
-- explicit GRANT at the table/schema level before RLS runs.
-- ============================================================

-- ─── SCHEMA USAGE ────────────────────────────────────────────

GRANT USAGE ON SCHEMA core          TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA org           TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA coaching      TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA scoring       TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA certification TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA achievement   TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA notification  TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA content       TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA audit         TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA analytics     TO authenticated, anon, service_role;

-- ─── CORE SCHEMA ─────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE        ON core.profiles         TO authenticated;
GRANT SELECT                        ON core.user_roles        TO authenticated;
GRANT SELECT, UPDATE                ON core.permission_rules  TO authenticated;
GRANT SELECT, UPDATE                ON core.role_permissions  TO authenticated;
GRANT SELECT, UPDATE                ON core.app_settings      TO authenticated;

-- ─── ORG SCHEMA ──────────────────────────────────────────────
-- anon needs SELECT on reference tables for registration form

GRANT SELECT ON org.states  TO authenticated, anon;
GRANT SELECT ON org.plds    TO authenticated, anon;
GRANT SELECT ON org.schools TO authenticated, anon;

GRANT SELECT, INSERT, UPDATE ON org.states  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON org.plds    TO authenticated;
GRANT SELECT, INSERT, UPDATE ON org.schools TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON org.school_assignments TO authenticated;

-- ─── COACHING SCHEMA ─────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON coaching.archer_profiles    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON coaching.coach_profiles     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON coaching.coach_archer_links TO authenticated;

-- ─── SCORING SCHEMA ──────────────────────────────────────────

GRANT SELECT ON scoring.rounds TO authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON scoring.score_submissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scoring.training_logs     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON scoring.equipment_setups  TO authenticated;

-- ─── CERTIFICATION SCHEMA ────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON certification.certifications TO authenticated;

-- ─── ACHIEVEMENT SCHEMA ──────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON achievement.achievement_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON achievement.user_achievements       TO authenticated;

-- ─── NOTIFICATION SCHEMA ─────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON notification.notifications      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON notification.notification_reads TO authenticated;

-- ─── CONTENT SCHEMA ──────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON content.articles TO authenticated;

-- ─── AUDIT SCHEMA ────────────────────────────────────────────
-- authenticated can only INSERT via the log_audit() function.
-- SELECT for admin2 is handled by RLS, but needs table grant too.

GRANT SELECT, INSERT ON audit.audit_logs TO authenticated;

-- ─── SERVICE ROLE — FULL ACCESS ──────────────────────────────
-- Needed by triggers (handle_new_user, achievement check, etc.)

GRANT ALL ON ALL TABLES IN SCHEMA core          TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA org           TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA coaching      TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA scoring       TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA certification TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA achievement   TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA notification  TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA content       TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA audit         TO service_role;

-- ─── PUBLIC COMPATIBILITY VIEWS ──────────────────────────────
-- Views are not tables — grants on the underlying tables do NOT
-- automatically apply to the views. Each view needs its own grant.

GRANT SELECT, INSERT, UPDATE        ON public.profiles               TO authenticated;
GRANT SELECT                        ON public.profiles               TO anon;

GRANT SELECT                        ON public.states                 TO authenticated, anon;
GRANT SELECT                        ON public.plds                   TO authenticated, anon;
GRANT SELECT                        ON public.schools                TO authenticated, anon;
GRANT SELECT                        ON public.rounds                 TO authenticated, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.coach_archer_links    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_submissions     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.training_logs         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.equipment_setups      TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certifications        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.achievement_definitions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_achievements     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_reads    TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.articles              TO authenticated;
GRANT SELECT                         ON public.audit_logs            TO authenticated;
GRANT SELECT                         ON public.permissions           TO authenticated;
GRANT SELECT                         ON public.app_settings          TO authenticated;

-- ─── API VIEWS ───────────────────────────────────────────────
-- Already granted in 006 but repeated here for completeness.

GRANT USAGE ON SCHEMA api TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO authenticated;

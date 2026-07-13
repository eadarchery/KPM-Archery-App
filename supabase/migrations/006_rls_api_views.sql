-- ============================================================
-- Migration 006: RLS, API Views, Public Compatibility Views
-- ============================================================

-- ─── ENABLE RLS ──────────────────────────────────────────────

ALTER TABLE org.states                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.plds                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.schools                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE org.school_assignments        ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.user_roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.permission_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.role_permissions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.app_settings             ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.profiles                 ENABLE ROW LEVEL SECURITY;

ALTER TABLE coaching.archer_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching.coach_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE coaching.coach_archer_links   ENABLE ROW LEVEL SECURITY;

ALTER TABLE scoring.rounds                ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.score_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.training_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring.equipment_setups      ENABLE ROW LEVEL SECURITY;

ALTER TABLE certification.certifications  ENABLE ROW LEVEL SECURITY;

ALTER TABLE achievement.achievement_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievement.user_achievements       ENABLE ROW LEVEL SECURITY;

ALTER TABLE notification.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.notification_reads   ENABLE ROW LEVEL SECURITY;

ALTER TABLE content.articles              ENABLE ROW LEVEL SECURITY;

ALTER TABLE audit.audit_logs              ENABLE ROW LEVEL SECURITY;

-- ─── RLS HELPER FUNCTIONS ────────────────────────────────────
-- SECURITY DEFINER bypasses RLS internally for these lookups.

CREATE OR REPLACE FUNCTION core.current_profile_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT id FROM core.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION core.current_role()
RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM core.profiles WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION core.is_approved()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT status = 'approved' FROM core.profiles WHERE id = auth.uid()),
    false
  )
$$;

CREATE OR REPLACE FUNCTION core.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role IN ('admin2','super_admin') AND status = 'approved'
     FROM core.profiles WHERE id = auth.uid()),
    false
  )
$$;

CREATE OR REPLACE FUNCTION core.is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role = 'super_admin' AND status = 'approved'
     FROM core.profiles WHERE id = auth.uid()),
    false
  )
$$;

-- ─── ORG RLS POLICIES ────────────────────────────────────────

CREATE POLICY "org_states_approved_read"   ON org.states FOR SELECT TO authenticated USING (core.is_approved());
CREATE POLICY "org_states_admin_manage"    ON org.states FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "org_plds_approved_read"     ON org.plds   FOR SELECT TO authenticated USING (core.is_approved());
CREATE POLICY "org_plds_admin_manage"      ON org.plds   FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "org_schools_approved_read"  ON org.schools FOR SELECT TO authenticated USING (core.is_approved());
CREATE POLICY "org_schools_admin_manage"   ON org.schools FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "org_school_assignments_own_read"   ON org.school_assignments FOR SELECT TO authenticated USING (profile_id = auth.uid() AND core.is_approved());
CREATE POLICY "org_school_assignments_admin"      ON org.school_assignments FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── CORE RLS POLICIES ───────────────────────────────────────

CREATE POLICY "core_user_roles_approved_read"    ON core.user_roles       FOR SELECT TO authenticated USING (core.is_approved());
CREATE POLICY "core_user_roles_super_manage"     ON core.user_roles       FOR ALL    TO authenticated USING (core.is_super_admin()) WITH CHECK (core.is_super_admin());

CREATE POLICY "core_permission_rules_approved_read" ON core.permission_rules FOR SELECT TO authenticated USING (core.is_approved());
CREATE POLICY "core_permission_rules_super_manage"  ON core.permission_rules FOR ALL    TO authenticated USING (core.is_super_admin()) WITH CHECK (core.is_super_admin());

CREATE POLICY "core_role_permissions_approved_read" ON core.role_permissions FOR SELECT TO authenticated USING (core.is_approved());
CREATE POLICY "core_role_permissions_super_manage"  ON core.role_permissions FOR ALL    TO authenticated USING (core.is_super_admin()) WITH CHECK (core.is_super_admin());

CREATE POLICY "core_app_settings_approved_read"  ON core.app_settings FOR SELECT TO authenticated USING (core.is_approved());
CREATE POLICY "core_app_settings_admin_manage"   ON core.app_settings FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "core_profiles_own_read"   ON core.profiles FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "core_profiles_own_update" ON core.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "core_profiles_own_insert" ON core.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "core_profiles_coach_reads_linked" ON core.profiles FOR SELECT TO authenticated
  USING (
    core.current_role() = 'coach' AND core.is_approved()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid() AND cal.archer_id = core.profiles.id AND cal.status = 'active'
    )
  );

CREATE POLICY "core_profiles_admin1_read_all" ON core.profiles FOR SELECT TO authenticated
  USING (core.current_role() = 'admin1' AND core.is_approved());

CREATE POLICY "core_profiles_admin2_full" ON core.profiles FOR ALL TO authenticated
  USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── COACHING RLS POLICIES ───────────────────────────────────

CREATE POLICY "coaching_archer_profiles_own_read"   ON coaching.archer_profiles FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "coaching_archer_profiles_own_update" ON coaching.archer_profiles FOR UPDATE TO authenticated USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY "coaching_archer_profiles_coach_reads_linked" ON coaching.archer_profiles FOR SELECT TO authenticated
  USING (
    core.current_role() = 'coach' AND core.is_approved()
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid() AND cal.archer_id = coaching.archer_profiles.profile_id AND cal.status = 'active'
    )
  );
CREATE POLICY "coaching_archer_profiles_admin_full" ON coaching.archer_profiles FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "coaching_coach_profiles_own_read"    ON coaching.coach_profiles FOR SELECT TO authenticated USING (profile_id = auth.uid());
CREATE POLICY "coaching_coach_profiles_own_update"  ON coaching.coach_profiles FOR UPDATE TO authenticated USING (profile_id = auth.uid()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY "coaching_coach_profiles_admin_full"  ON coaching.coach_profiles FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "coaching_cal_archer_reads_own"  ON coaching.coach_archer_links FOR SELECT TO authenticated USING (archer_id = auth.uid() AND core.is_approved());
CREATE POLICY "coaching_cal_coach_reads_own"   ON coaching.coach_archer_links FOR SELECT TO authenticated USING (coach_id  = auth.uid() AND core.is_approved());
CREATE POLICY "coaching_cal_coach_manages_own" ON coaching.coach_archer_links FOR ALL TO authenticated
  USING  (coach_id = auth.uid() AND core.current_role() = 'coach' AND core.is_approved())
  WITH CHECK (coach_id = auth.uid() AND core.current_role() = 'coach');
CREATE POLICY "coaching_cal_admin_full"        ON coaching.coach_archer_links FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── SCORING RLS POLICIES ────────────────────────────────────

CREATE POLICY "scoring_rounds_approved_read"  ON scoring.rounds FOR SELECT TO authenticated USING (core.is_approved() AND active = true);
CREATE POLICY "scoring_rounds_admin_manage"   ON scoring.rounds FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "scoring_submissions_archer_reads_own" ON scoring.score_submissions FOR SELECT TO authenticated USING (archer_id = auth.uid() AND core.is_approved());
CREATE POLICY "scoring_submissions_archer_inserts"   ON scoring.score_submissions FOR INSERT TO authenticated WITH CHECK (archer_id = auth.uid() AND core.current_role() = 'archer' AND core.is_approved());
CREATE POLICY "scoring_submissions_archer_updates_pending" ON scoring.score_submissions FOR UPDATE TO authenticated
  USING (archer_id = auth.uid() AND status = 'pending') WITH CHECK (archer_id = auth.uid());
CREATE POLICY "scoring_submissions_coach_reads_linked" ON scoring.score_submissions FOR SELECT TO authenticated
  USING (
    core.current_role() = 'coach' AND core.is_approved()
    AND (coach_id = auth.uid() OR EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid() AND cal.archer_id = scoring.score_submissions.archer_id AND cal.status = 'active'
    ))
  );
CREATE POLICY "scoring_submissions_coach_approves" ON scoring.score_submissions FOR UPDATE TO authenticated
  USING (core.current_role() = 'coach' AND core.is_approved() AND coach_id = auth.uid() AND status = 'pending')
  WITH CHECK (core.current_role() = 'coach');
CREATE POLICY "scoring_submissions_admin1_reads"  ON scoring.score_submissions FOR SELECT TO authenticated USING (core.current_role() = 'admin1' AND core.is_approved());
CREATE POLICY "scoring_submissions_admin2_full"   ON scoring.score_submissions FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "scoring_training_archer_reads_own"    ON scoring.training_logs FOR SELECT TO authenticated USING (archer_id = auth.uid() AND core.is_approved());
CREATE POLICY "scoring_training_archer_inserts"      ON scoring.training_logs FOR INSERT TO authenticated WITH CHECK (archer_id = auth.uid() AND core.is_approved());
CREATE POLICY "scoring_training_archer_updates_own"  ON scoring.training_logs FOR UPDATE TO authenticated USING (archer_id = auth.uid()) WITH CHECK (archer_id = auth.uid());
CREATE POLICY "scoring_training_archer_deletes_own"  ON scoring.training_logs FOR DELETE TO authenticated USING (archer_id = auth.uid());
CREATE POLICY "scoring_training_coach_reads_linked"  ON scoring.training_logs FOR SELECT TO authenticated
  USING (core.current_role() = 'coach' AND core.is_approved() AND EXISTS (
    SELECT 1 FROM coaching.coach_archer_links cal WHERE cal.coach_id = auth.uid() AND cal.archer_id = scoring.training_logs.archer_id AND cal.status = 'active'
  ));
CREATE POLICY "scoring_training_coach_inserts_linked" ON scoring.training_logs FOR INSERT TO authenticated
  WITH CHECK (core.current_role() = 'coach' AND core.is_approved() AND EXISTS (
    SELECT 1 FROM coaching.coach_archer_links cal WHERE cal.coach_id = auth.uid() AND cal.archer_id = scoring.training_logs.archer_id AND cal.status = 'active'
  ));
CREATE POLICY "scoring_training_admin2_full"         ON scoring.training_logs FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "scoring_equipment_own_access"          ON scoring.equipment_setups FOR ALL TO authenticated USING (profile_id = auth.uid() AND core.is_approved()) WITH CHECK (profile_id = auth.uid());
CREATE POLICY "scoring_equipment_coach_reads_linked"  ON scoring.equipment_setups FOR SELECT TO authenticated
  USING (core.current_role() = 'coach' AND core.is_approved() AND EXISTS (
    SELECT 1 FROM coaching.coach_archer_links cal WHERE cal.coach_id = auth.uid() AND cal.archer_id = scoring.equipment_setups.profile_id AND cal.status = 'active'
  ));
CREATE POLICY "scoring_equipment_admin2_full"         ON scoring.equipment_setups FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── CERTIFICATION RLS ───────────────────────────────────────

CREATE POLICY "cert_coach_reads_own"          ON certification.certifications FOR SELECT TO authenticated USING (coach_id = auth.uid() AND core.is_approved());
CREATE POLICY "cert_coach_inserts_own"        ON certification.certifications FOR INSERT TO authenticated WITH CHECK (coach_id = auth.uid() AND core.current_role() = 'coach');
CREATE POLICY "cert_coach_updates_own_pending" ON certification.certifications FOR UPDATE TO authenticated USING (coach_id = auth.uid() AND status = 'pending') WITH CHECK (coach_id = auth.uid());
CREATE POLICY "cert_admin2_full"              ON certification.certifications FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── ACHIEVEMENT RLS ─────────────────────────────────────────

CREATE POLICY "achievement_defs_approved_read"  ON achievement.achievement_definitions FOR SELECT TO authenticated USING (core.is_approved() AND active = true);
CREATE POLICY "achievement_defs_admin_manage"   ON achievement.achievement_definitions FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "user_achievements_own_read"      ON achievement.user_achievements FOR SELECT TO authenticated USING (profile_id = auth.uid() AND core.is_approved());
CREATE POLICY "user_achievements_admin_manage"  ON achievement.user_achievements FOR ALL    TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── NOTIFICATION RLS ────────────────────────────────────────

CREATE POLICY "notifications_approved_read" ON notification.notifications FOR SELECT TO authenticated
  USING (
    core.is_approved()
    AND published_at IS NOT NULL AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND (
      audience = 'all'
      OR audience::text = (SELECT role::text FROM core.profiles WHERE id = auth.uid())
      OR (audience = 'state' AND audience_ref = (SELECT state_id FROM core.profiles WHERE id = auth.uid()))
      OR (audience = 'pld'   AND audience_ref = (SELECT pld_id   FROM core.profiles WHERE id = auth.uid()))
      OR (audience = 'school' AND audience_ref = (SELECT school_id FROM core.profiles WHERE id = auth.uid()))
    )
  );
CREATE POLICY "notifications_admin2_full" ON notification.notifications FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

CREATE POLICY "notification_reads_own" ON notification.notification_reads FOR ALL TO authenticated
  USING (profile_id = auth.uid() AND core.is_approved()) WITH CHECK (profile_id = auth.uid());

-- ─── CONTENT RLS ─────────────────────────────────────────────

CREATE POLICY "articles_approved_read_published" ON content.articles FOR SELECT TO authenticated
  USING (core.is_approved() AND published_at IS NOT NULL AND published_at <= now());
CREATE POLICY "articles_admin2_full"             ON content.articles FOR ALL TO authenticated USING (core.is_admin()) WITH CHECK (core.is_admin());

-- ─── AUDIT RLS ───────────────────────────────────────────────

CREATE POLICY "audit_logs_admin2_reads" ON audit.audit_logs FOR SELECT TO authenticated USING (core.is_admin());
-- Insert only via SECURITY DEFINER function — no direct user insert policy

-- ============================================================
-- API SCHEMA VIEWS
-- Exposed via PostgREST when "api" is in db_schema list.
-- security_invoker=true means RLS on underlying tables applies.
-- ============================================================

CREATE OR REPLACE VIEW api.profiles
  WITH (security_invoker = true) AS
SELECT
  p.id, p.email, p.name, p.age, p.role, p.status,
  p.rejection_reason, p.approved_by, p.approved_at,
  p.archer_id, p.coach_id, p.bow_category, p.avatar_url,
  p.phone, p.date_of_birth, p.gender,
  p.school_id, p.pld_id, p.state_id,
  p.created_at, p.updated_at,
  s.name  AS school_name,
  pl.name AS pld_name,
  st.name AS state_name,
  st.code AS state_code
FROM core.profiles p
LEFT JOIN org.schools s  ON s.id  = p.school_id
LEFT JOIN org.plds    pl ON pl.id = p.pld_id
LEFT JOIN org.states  st ON st.id = p.state_id;

CREATE OR REPLACE VIEW api.states
  WITH (security_invoker = true) AS
SELECT id, name, code, active, created_at, updated_at FROM org.states;

CREATE OR REPLACE VIEW api.plds
  WITH (security_invoker = true) AS
SELECT pl.id, pl.name, pl.state_id, pl.active, pl.created_at, pl.updated_at,
       st.name AS state_name, st.code AS state_code
FROM org.plds pl JOIN org.states st ON st.id = pl.state_id;

CREATE OR REPLACE VIEW api.schools
  WITH (security_invoker = true) AS
SELECT s.id, s.name, s.pld_id, s.state_id, s.active, s.created_at, s.updated_at,
       pl.name AS pld_name, st.name AS state_name, st.code AS state_code
FROM org.schools s
LEFT JOIN org.plds pl ON pl.id = s.pld_id
JOIN org.states st ON st.id = s.state_id;

CREATE OR REPLACE VIEW api.coach_archer_links
  WITH (security_invoker = true) AS
SELECT
  cal.id, cal.coach_id, cal.archer_id, cal.status,
  cal.linked_at, cal.approved_at, cal.approved_by,
  cal.rejected_at, cal.rejection_reason, cal.unlinked_at,
  cal.created_at, cal.updated_at,
  cp.name AS coach_name, cp.email AS coach_email,
  ap.name AS archer_name, ap.email AS archer_email,
  ap.archer_id AS archer_code,
  ap.school_id AS archer_school_id,
  ap.state_id  AS archer_state_id
FROM coaching.coach_archer_links cal
JOIN core.profiles cp ON cp.id = cal.coach_id
JOIN core.profiles ap ON ap.id = cal.archer_id;

CREATE OR REPLACE VIEW api.user_roles
  WITH (security_invoker = true) AS
SELECT id, name, display_name, description, sort_order, active
FROM core.user_roles WHERE active = true ORDER BY sort_order;

CREATE OR REPLACE VIEW api.permission_rules
  WITH (security_invoker = true) AS
SELECT id, role, permission_key, allowed, description, updated_by, created_at, updated_at
FROM core.permission_rules;

CREATE OR REPLACE VIEW api.certifications
  WITH (security_invoker = true) AS
SELECT
  c.id, c.coach_id, c.title, c.issuer, c.certificate_level,
  c.certificate_number, c.issued_date, c.expiry_date, c.cert_url,
  c.status, c.reviewed_by, c.reviewed_at, c.rejection_reason,
  c.notes, c.created_at, c.updated_at,
  p.name AS coach_name, p.email AS coach_email
FROM certification.certifications c
JOIN core.profiles p ON p.id = c.coach_id;

CREATE OR REPLACE VIEW api.score_submissions
  WITH (security_invoker = true) AS
SELECT
  s.id, s.archer_id, s.round_id, s.coach_id, s.date,
  s.total_score, s.max_score, s.arrows_data, s.status,
  s.proof_url, s.notes, s.coach_approved_at, s.admin_approved_at,
  s.approved_by, s.rejection_reason, s.sync_source,
  s.created_at, s.updated_at,
  a.name AS archer_name, a.archer_id AS archer_code,
  r.name AS round_name, r.max_score AS round_max_score
FROM scoring.score_submissions s
JOIN core.profiles   a ON a.id = s.archer_id
JOIN scoring.rounds  r ON r.id = s.round_id;

-- ─── API SCHEMA GRANTS ───────────────────────────────────────

GRANT USAGE ON SCHEMA api TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA api TO authenticated;

-- ============================================================
-- PUBLIC SCHEMA COMPATIBILITY VIEWS
-- security_invoker=true → RLS on underlying schema tables applies.
-- Simple single-table views are automatically updatable by
-- PostgreSQL — INSERT/UPDATE/DELETE work without triggers.
-- ============================================================

-- public.profiles → core.profiles (writable)
CREATE OR REPLACE VIEW public.profiles
  WITH (security_invoker = true) AS
SELECT * FROM core.profiles;

-- public.states → org.states (writable)
CREATE OR REPLACE VIEW public.states
  WITH (security_invoker = true) AS
SELECT * FROM org.states;

-- public.plds → org.plds (writable)
CREATE OR REPLACE VIEW public.plds
  WITH (security_invoker = true) AS
SELECT * FROM org.plds;

-- public.schools → org.schools (writable)
CREATE OR REPLACE VIEW public.schools
  WITH (security_invoker = true) AS
SELECT * FROM org.schools;

-- public.rounds → scoring.rounds (writable)
CREATE OR REPLACE VIEW public.rounds
  WITH (security_invoker = true) AS
SELECT * FROM scoring.rounds;

-- public.coach_archer_links → coaching.coach_archer_links (writable)
CREATE OR REPLACE VIEW public.coach_archer_links
  WITH (security_invoker = true) AS
SELECT * FROM coaching.coach_archer_links;

-- public.score_submissions → scoring.score_submissions (writable)
CREATE OR REPLACE VIEW public.score_submissions
  WITH (security_invoker = true) AS
SELECT * FROM scoring.score_submissions;

-- public.training_logs → scoring.training_logs (writable)
CREATE OR REPLACE VIEW public.training_logs
  WITH (security_invoker = true) AS
SELECT * FROM scoring.training_logs;

-- public.equipment_setups → scoring.equipment_setups (writable)
CREATE OR REPLACE VIEW public.equipment_setups
  WITH (security_invoker = true) AS
SELECT * FROM scoring.equipment_setups;

-- public.certifications → certification.certifications (writable)
CREATE OR REPLACE VIEW public.certifications
  WITH (security_invoker = true) AS
SELECT * FROM certification.certifications;

-- public.achievement_definitions → achievement.achievement_definitions (writable)
CREATE OR REPLACE VIEW public.achievement_definitions
  WITH (security_invoker = true) AS
SELECT * FROM achievement.achievement_definitions;

-- public.user_achievements → achievement.user_achievements (writable)
CREATE OR REPLACE VIEW public.user_achievements
  WITH (security_invoker = true) AS
SELECT * FROM achievement.user_achievements;

-- public.notifications → notification.notifications (writable)
CREATE OR REPLACE VIEW public.notifications
  WITH (security_invoker = true) AS
SELECT * FROM notification.notifications;

-- public.notification_reads → notification.notification_reads (writable)
CREATE OR REPLACE VIEW public.notification_reads
  WITH (security_invoker = true) AS
SELECT * FROM notification.notification_reads;

-- public.articles → content.articles (writable)
CREATE OR REPLACE VIEW public.articles
  WITH (security_invoker = true) AS
SELECT * FROM content.articles;

-- public.audit_logs → audit.audit_logs (writable)
CREATE OR REPLACE VIEW public.audit_logs
  WITH (security_invoker = true) AS
SELECT * FROM audit.audit_logs;

-- public.permissions → core.permission_rules with legacy column names
CREATE OR REPLACE VIEW public.permissions
  WITH (security_invoker = true) AS
SELECT
  id,
  role      AS role_name,
  permission_key,
  allowed   AS enabled,
  description,
  updated_by,
  created_at,
  updated_at
FROM core.permission_rules;

-- public.app_settings → core.app_settings (writable)
CREATE OR REPLACE VIEW public.app_settings
  WITH (security_invoker = true) AS
SELECT * FROM core.app_settings;

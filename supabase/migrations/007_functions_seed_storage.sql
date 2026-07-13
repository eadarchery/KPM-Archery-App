-- ============================================================
-- Migration 007: Functions, Triggers, Seed Data, Storage
-- ============================================================

-- ─── AUTH TRIGGER: AUTO-CREATE PROFILE ON SIGN-UP ────────────
-- Supabase calls this after auth.users INSERT.
-- Reads name and role from raw_user_meta_data (passed at sign-up).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO core.profiles (id, email, name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'archer'),
    'pending'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── AUDIT LOG HELPER ────────────────────────────────────────
-- Call from application code to write audit entries safely.

CREATE OR REPLACE FUNCTION public.log_audit(
  p_actor_id    uuid,
  p_action      text,
  p_target_type text DEFAULT NULL,
  p_target_id   uuid DEFAULT NULL,
  p_meta        jsonb DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO audit.audit_logs (actor_id, action, target_type, target_id, meta)
  VALUES (p_actor_id, p_action, p_target_type, p_target_id, p_meta)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── PROFILE STATUS AUDIT TRIGGER ────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_profile_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.log_audit(
      NEW.approved_by,
      CASE NEW.status
        WHEN 'approved' THEN 'user.approved'
        WHEN 'rejected' THEN 'user.rejected'
        ELSE 'user.status_changed'
      END,
      'profile',
      NEW.id,
      jsonb_build_object('role', NEW.role, 'name', NEW.name, 'status', NEW.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER profile_status_audit
  AFTER UPDATE OF status ON core.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_profile_status_change();

-- ─── SCORE STATUS AUDIT TRIGGER ──────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_score_status_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM public.log_audit(
      COALESCE(NEW.approved_by, auth.uid()),
      CASE NEW.status
        WHEN 'pending'        THEN 'score.submitted'
        WHEN 'coach_approved' THEN 'score.coach_approved'
        WHEN 'admin_approved' THEN 'score.admin_approved'
        WHEN 'rejected'       THEN 'score.rejected'
        ELSE 'score.status_changed'
      END,
      'score_submission',
      NEW.id,
      jsonb_build_object('archer_id', NEW.archer_id, 'total_score', NEW.total_score, 'max_score', NEW.max_score)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER score_status_audit
  AFTER UPDATE OF status ON scoring.score_submissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_score_status_change();

-- ─── ACHIEVEMENT AUTO-GRANT ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.check_and_grant_achievements(p_profile_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_total_arrows bigint;
  v_best_score   int;
  v_ach_id       uuid;
BEGIN
  SELECT COALESCE(SUM(arrows_shot), 0) INTO v_total_arrows
  FROM scoring.training_logs WHERE archer_id = p_profile_id;

  SELECT MAX(total_score) INTO v_best_score
  FROM scoring.score_submissions WHERE archer_id = p_profile_id AND status = 'admin_approved';

  FOR v_ach_id IN
    SELECT id FROM achievement.achievement_definitions
    WHERE category = 'score' AND active = true AND threshold IS NOT NULL
      AND threshold <= COALESCE(v_best_score, 0)
  LOOP
    INSERT INTO achievement.user_achievements (profile_id, achievement_id, context)
    VALUES (p_profile_id, v_ach_id, jsonb_build_object('best_score', v_best_score))
    ON CONFLICT (profile_id, achievement_id) DO NOTHING;
  END LOOP;

  FOR v_ach_id IN
    SELECT id FROM achievement.achievement_definitions
    WHERE category = 'practice' AND active = true AND threshold IS NOT NULL
      AND threshold <= v_total_arrows
  LOOP
    INSERT INTO achievement.user_achievements (profile_id, achievement_id, context)
    VALUES (p_profile_id, v_ach_id, jsonb_build_object('total_arrows', v_total_arrows))
    ON CONFLICT (profile_id, achievement_id) DO NOTHING;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trigger_achievement_check()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status = 'admin_approved' AND OLD.status != 'admin_approved' THEN
    PERFORM public.check_and_grant_achievements(NEW.archer_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER score_achievement_check
  AFTER UPDATE OF status ON scoring.score_submissions
  FOR EACH ROW EXECUTE FUNCTION public.trigger_achievement_check();

-- ─── LEADERBOARD VIEW (in api schema) ────────────────────────

CREATE OR REPLACE VIEW api.leaderboard AS
SELECT
  p.id          AS archer_id,
  p.name        AS archer_name,
  p.archer_id   AS archer_code,
  p.state_id,
  p.bow_category,
  r.name        AS round_name,
  s.total_score,
  s.max_score,
  s.date,
  RANK() OVER (
    PARTITION BY p.state_id, p.bow_category
    ORDER BY s.total_score DESC, s.date DESC
  ) AS state_rank
FROM scoring.score_submissions s
JOIN core.profiles   p ON p.id = s.archer_id
JOIN scoring.rounds  r ON r.id = s.round_id
WHERE s.status = 'admin_approved' AND p.status = 'approved' AND p.role = 'archer';

-- Grant new api view
GRANT SELECT ON api.leaderboard TO authenticated;

-- ============================================================
-- SEED DATA
-- ============================================================

-- core.user_roles ─────────────────────────────────────────────

INSERT INTO core.user_roles (name, display_name, description, sort_order) VALUES
  ('archer',      'Archer',      'Student archer participating in competitions',    1),
  ('coach',       'Coach',       'Registered coach managing archers',               2),
  ('admin1',      'Admin 1',     'KPM/State-level administrator (read access)',     3),
  ('admin2',      'Admin 2',     'National administrator with management access',   4),
  ('super_admin', 'Super Admin', 'System administrator with unrestricted access',   5)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description,
  sort_order   = EXCLUDED.sort_order;

-- org.states — Malaysian states ───────────────────────────────

INSERT INTO org.states (name, code) VALUES
  ('Johor',           'JHR'),
  ('Kedah',           'KDH'),
  ('Kelantan',        'KTN'),
  ('Melaka',          'MLK'),
  ('Negeri Sembilan', 'NSN'),
  ('Pahang',          'PHG'),
  ('Perak',           'PRK'),
  ('Perlis',          'PLS'),
  ('Pulau Pinang',    'PNG'),
  ('Sabah',           'SBH'),
  ('Sarawak',         'SWK'),
  ('Selangor',        'SGR'),
  ('Terengganu',      'TRG'),
  ('Kuala Lumpur',    'KUL'),
  ('Labuan',          'LBN'),
  ('Putrajaya',       'PJY')
ON CONFLICT (code) DO NOTHING;

-- scoring.rounds ──────────────────────────────────────────────

INSERT INTO scoring.rounds (name, total_arrows, max_score, distance_m, bow_categories) VALUES
  ('WA 18m (60 arrows)',      60,  600,  18, ARRAY['recurve','compound','barebow','longbow']::bow_category[]),
  ('WA 18m (30 arrows)',      30,  300,  18, ARRAY['recurve','compound','barebow','longbow']::bow_category[]),
  ('WA 25m (60 arrows)',      60,  600,  25, ARRAY['recurve','compound']::bow_category[]),
  ('WA 30m Outdoor',          36,  360,  30, ARRAY['recurve','compound']::bow_category[]),
  ('WA 70m Round',            72,  720,  70, ARRAY['recurve']::bow_category[]),
  ('WA 50m Round',            72,  720,  50, ARRAY['compound']::bow_category[]),
  ('WA 1440 (Full)',         144, 1440, NULL, ARRAY['recurve','compound']::bow_category[]),
  ('MABF 18m Standard',       60,  600,  18, ARRAY['recurve','compound','barebow','longbow','traditional']::bow_category[]),
  ('Junior 15m (30 arrows)',  30,  300,  15, ARRAY['recurve','barebow']::bow_category[]),
  ('Mini Archer 10m',         30,  300,  10, ARRAY['recurve','barebow']::bow_category[])
ON CONFLICT DO NOTHING;

-- achievement.achievement_definitions ─────────────────────────

INSERT INTO achievement.achievement_definitions (slug, name, description, category, threshold, icon) VALUES
  ('score_200',  'First Century Double', 'Achieved a score of 200 or above.',       'score',     200, '🎯'),
  ('score_250',  'Silver Target',        'Achieved a score of 250 or above.',       'score',     250, '🥈'),
  ('score_290',  'Elite Approach',       'Achieved a score of 290 or above.',       'score',     290, '⭐'),
  ('score_300',  'Perfect 300',          'Achieved the perfect score of 300.',      'score',     300, '🏆'),
  ('score_320',  'Gold Ring',            'Achieved a score of 320 or above.',       'score',     320, '🥇'),
  ('score_350',  'Legend',               'Achieved a score of 350 or above.',       'score',     350, '👑'),
  ('arrows_100',  'First Hundred',       'Shot 100 training arrows.',              'practice',   100, '🏹'),
  ('arrows_1k',   'Thousand Strong',     'Shot 1,000 training arrows.',            'practice',  1000, '🔥'),
  ('arrows_5k',   'Five Thousand',       'Shot 5,000 training arrows.',            'practice',  5000, '⚡'),
  ('arrows_10k',  'Ten Thousand',        'Shot 10,000 training arrows.',           'practice', 10000, '🌟'),
  ('arrows_50k',  'Fifty Thousand',      'Shot 50,000 training arrows.',           'practice', 50000, '🚀')
ON CONFLICT (slug) DO NOTHING;

-- core.permission_rules ───────────────────────────────────────

INSERT INTO core.permission_rules (role, permission_key, allowed) VALUES
  -- Archer
  ('archer', 'can_view_dashboard',        true),
  ('archer', 'can_submit_own_score',      true),
  ('archer', 'can_view_own_scores',       true),
  ('archer', 'can_view_leaderboard',      true),
  ('archer', 'can_view_achievements',     true),
  ('archer', 'can_view_notifications',    true),
  ('archer', 'can_view_articles',         true),
  ('archer', 'can_manage_own_equipment',  true),
  ('archer', 'can_upload_excel',          false),
  ('archer', 'can_approve_archers',       false),
  ('archer', 'can_approve_scores',        false),
  ('archer', 'can_manage_notifications',  false),
  ('archer', 'can_manage_articles',       false),
  ('archer', 'can_manage_achievements',   false),
  ('archer', 'can_view_audit_logs',       false),
  ('archer', 'can_manage_certifications', false),
  ('archer', 'can_edit_permissions',      false),
  ('archer', 'can_access_super_admin',    false),
  -- Coach
  ('coach', 'can_view_dashboard',         true),
  ('coach', 'can_submit_own_score',       true),
  ('coach', 'can_view_own_scores',        true),
  ('coach', 'can_view_leaderboard',       true),
  ('coach', 'can_view_achievements',      true),
  ('coach', 'can_view_notifications',     true),
  ('coach', 'can_view_articles',          true),
  ('coach', 'can_manage_own_equipment',   true),
  ('coach', 'can_upload_excel',           true),
  ('coach', 'can_approve_archers',        true),
  ('coach', 'can_approve_scores',         true),
  ('coach', 'can_manage_notifications',   false),
  ('coach', 'can_manage_articles',        false),
  ('coach', 'can_manage_achievements',    false),
  ('coach', 'can_view_audit_logs',        false),
  ('coach', 'can_manage_certifications',  true),
  ('coach', 'can_edit_permissions',       false),
  ('coach', 'can_access_super_admin',     false),
  -- Admin 1
  ('admin1', 'can_view_dashboard',        true),
  ('admin1', 'can_submit_own_score',      false),
  ('admin1', 'can_view_own_scores',       false),
  ('admin1', 'can_view_leaderboard',      true),
  ('admin1', 'can_view_achievements',     true),
  ('admin1', 'can_view_notifications',    true),
  ('admin1', 'can_view_articles',         true),
  ('admin1', 'can_manage_own_equipment',  false),
  ('admin1', 'can_upload_excel',          false),
  ('admin1', 'can_approve_archers',       false),
  ('admin1', 'can_approve_scores',        false),
  ('admin1', 'can_manage_notifications',  false),
  ('admin1', 'can_manage_articles',       false),
  ('admin1', 'can_manage_achievements',   false),
  ('admin1', 'can_view_audit_logs',       false),
  ('admin1', 'can_manage_certifications', false),
  ('admin1', 'can_edit_permissions',      false),
  ('admin1', 'can_access_super_admin',    false),
  -- Admin 2
  ('admin2', 'can_view_dashboard',        true),
  ('admin2', 'can_submit_own_score',      false),
  ('admin2', 'can_view_own_scores',       false),
  ('admin2', 'can_view_leaderboard',      true),
  ('admin2', 'can_view_achievements',     true),
  ('admin2', 'can_view_notifications',    true),
  ('admin2', 'can_view_articles',         true),
  ('admin2', 'can_manage_own_equipment',  false),
  ('admin2', 'can_upload_excel',          true),
  ('admin2', 'can_approve_archers',       true),
  ('admin2', 'can_approve_scores',        true),
  ('admin2', 'can_manage_notifications',  true),
  ('admin2', 'can_manage_articles',       true),
  ('admin2', 'can_manage_achievements',   true),
  ('admin2', 'can_view_audit_logs',       true),
  ('admin2', 'can_manage_certifications', true),
  ('admin2', 'can_edit_permissions',      false),
  ('admin2', 'can_access_super_admin',    false),
  -- Super Admin (all true)
  ('super_admin', 'can_view_dashboard',        true),
  ('super_admin', 'can_submit_own_score',      true),
  ('super_admin', 'can_view_own_scores',       true),
  ('super_admin', 'can_view_leaderboard',      true),
  ('super_admin', 'can_view_achievements',     true),
  ('super_admin', 'can_view_notifications',    true),
  ('super_admin', 'can_view_articles',         true),
  ('super_admin', 'can_manage_own_equipment',  true),
  ('super_admin', 'can_upload_excel',          true),
  ('super_admin', 'can_approve_archers',       true),
  ('super_admin', 'can_approve_scores',        true),
  ('super_admin', 'can_manage_notifications',  true),
  ('super_admin', 'can_manage_articles',       true),
  ('super_admin', 'can_manage_achievements',   true),
  ('super_admin', 'can_view_audit_logs',       true),
  ('super_admin', 'can_manage_certifications', true),
  ('super_admin', 'can_edit_permissions',      true),
  ('super_admin', 'can_access_super_admin',    true)
ON CONFLICT (role, permission_key) DO NOTHING;

-- core.app_settings ───────────────────────────────────────────

INSERT INTO core.app_settings (key, value) VALUES
  ('app_name',            '"KPM Archery App"'),
  ('app_tagline',         '"Bring archers'' next step further."'),
  ('app_partner',         '"KPM"'),
  ('primary_color',       '"#E85D04"'),
  ('default_theme',       '"light"'),
  ('default_font_size',   '"normal"'),
  ('score_approval_flow', '"coach_then_admin"'),
  ('archer_registration', '"open"'),
  ('coach_registration',  '"open"')
ON CONFLICT (key) DO NOTHING;

-- ─── STORAGE BUCKET POLICIES ─────────────────────────────────
-- Buckets must be created in Supabase Dashboard → Storage first:
--   proof-photos  (private, 10 MB, image/*)
--   avatars       (public,  2 MB,  image/*)
--   certifications (private, 20 MB, pdf + image)
--   articles      (public,  10 MB, image/*)
--   branding      (public,  5 MB,  image/*)

CREATE POLICY "proof_photos_archer_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proof-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "proof_photos_archer_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'proof-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "proof_photos_coach_reads_linked"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'proof-photos'
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid()
        AND cal.archer_id::text = (storage.foldername(name))[1]
        AND cal.status = 'active'
    )
  );

CREATE POLICY "proof_photos_admin2_full"
  ON storage.objects FOR ALL TO authenticated
  USING  (bucket_id = 'proof-photos' AND core.is_admin())
  WITH CHECK (bucket_id = 'proof-photos' AND core.is_admin());

CREATE POLICY "avatars_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'avatars');

CREATE POLICY "avatars_own_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_own_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "certifications_coach_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'certifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND core.current_role() = 'coach'
  );

CREATE POLICY "certifications_coach_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'certifications' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "certifications_admin2_full"
  ON storage.objects FOR ALL TO authenticated
  USING  (bucket_id = 'certifications' AND core.is_admin())
  WITH CHECK (bucket_id = 'certifications' AND core.is_admin());

CREATE POLICY "articles_storage_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'articles');

CREATE POLICY "articles_storage_admin2_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'articles' AND core.is_admin());

CREATE POLICY "articles_storage_admin2_delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'articles' AND core.is_admin());

CREATE POLICY "branding_public_read"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'branding');

CREATE POLICY "branding_super_admin_manage"
  ON storage.objects FOR ALL TO authenticated
  USING  (bucket_id = 'branding' AND core.is_super_admin())
  WITH CHECK (bucket_id = 'branding' AND core.is_super_admin());

-- ============================================================
-- Migration 054: Scoped Admin-1 visibility + engagement features
-- ------------------------------------------------------------
--   Run in the Supabase SQL Editor. Idempotent, safe to re-run.
--
--  PART 1 (C5) Admin 1 sees ONLY their scope — read policies for profiles,
--         score submissions and training logs now require admin1_in_scope.
--         ⚠ An Admin 1 with NO scope (no ticks, no legacy assignment, no own
--         location) sees no archers/coaches/scores until scoped.
--  PART 2 (C6) A coach may validate any actively-linked archer's pending
--         score even if it was submitted before the link existed (the
--         approve/reject write stamps coach_id).
--  PART 3 (D2) Admins can read notification_reads → "read by N" counts.
--  PART 4 (D4) Personal notifications: notifications.recipient_id + a trigger
--         that notifies an archer/coach when they earn an achievement.
--  PART 5 (D1) Server-side aggregation functions for the National Overview
--         (SECURITY INVOKER → they respect the new scoped RLS automatically).
-- ============================================================

-- ─── PART 1: Admin 1 scoped READ ─────────────────────────────────

DROP POLICY IF EXISTS "core_profiles_admin1_read_all" ON core.profiles;
CREATE POLICY "core_profiles_admin1_read_all" ON core.profiles FOR SELECT TO authenticated
  USING (
    core.current_role() = 'admin1' AND core.is_approved()
    AND role IN ('archer', 'coach')
    AND core.admin1_in_scope(auth.uid(), state_id, pld_id, school_id)
  );

DROP POLICY IF EXISTS "scoring_submissions_admin1_reads" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_admin1_reads" ON scoring.score_submissions FOR SELECT TO authenticated
  USING (
    core.current_role() = 'admin1' AND core.is_approved()
    AND EXISTS (
      SELECT 1 FROM core.profiles p
      WHERE p.id = scoring.score_submissions.archer_id
        AND core.admin1_in_scope(auth.uid(), p.state_id, p.pld_id, p.school_id)
    )
  );

DROP POLICY IF EXISTS "scoring_training_admin1_reads" ON scoring.training_logs;
CREATE POLICY "scoring_training_admin1_reads" ON scoring.training_logs FOR SELECT TO authenticated
  USING (
    core.current_role() = 'admin1' AND core.is_approved()
    AND EXISTS (
      SELECT 1 FROM core.profiles p
      WHERE p.id = scoring.training_logs.archer_id
        AND core.admin1_in_scope(auth.uid(), p.state_id, p.pld_id, p.school_id)
    )
  );

-- ─── PART 2: Coach validates linked archers' pending scores ──────

DROP POLICY IF EXISTS "scoring_submissions_coach_validates_linked" ON scoring.score_submissions;
CREATE POLICY "scoring_submissions_coach_validates_linked" ON scoring.score_submissions
  FOR UPDATE TO authenticated
  USING (
    core.current_role() = 'coach' AND core.is_approved()
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM coaching.coach_archer_links cal
      WHERE cal.coach_id = auth.uid()
        AND cal.archer_id = scoring.score_submissions.archer_id
        AND cal.status = 'active'
    )
  )
  WITH CHECK (
    coach_id = auth.uid()                      -- the write stamps the validator
    AND status IN ('admin_approved', 'rejected')
  );

-- ─── PART 3: Admins read notification_reads (reach counts) ───────

DROP POLICY IF EXISTS "notification_reads_admin_read" ON notification.notification_reads;
CREATE POLICY "notification_reads_admin_read" ON notification.notification_reads
  FOR SELECT TO authenticated
  USING (core.is_admin() OR (core.current_role() = 'admin1' AND core.is_approved()));

-- ─── PART 4: Personal notifications + achievement notify ─────────

ALTER TABLE notification.notifications
  ADD COLUMN IF NOT EXISTS recipient_id uuid REFERENCES core.profiles(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notifications_recipient_idx ON notification.notifications(recipient_id);

CREATE OR REPLACE VIEW public.notifications
  WITH (security_invoker = true) AS
SELECT * FROM notification.notifications;

-- Read policy: personal rows visible only to their recipient.
DROP POLICY IF EXISTS "notifications_approved_read" ON notification.notifications;
CREATE POLICY "notifications_approved_read" ON notification.notifications FOR SELECT TO authenticated
  USING (
    core.is_approved()
    AND published_at IS NOT NULL AND published_at <= now()
    AND (expires_at IS NULL OR expires_at > now())
    AND (recipient_id IS NULL OR recipient_id = auth.uid())
    AND (
      audience = 'all'
      OR audience::text = (SELECT role::text FROM core.profiles WHERE id = auth.uid())
      OR (audience = 'state'  AND audience_ref = (SELECT state_id  FROM core.profiles WHERE id = auth.uid()))
      OR (audience = 'pld'    AND audience_ref = (SELECT pld_id    FROM core.profiles WHERE id = auth.uid()))
      OR (audience = 'school' AND audience_ref = (SELECT school_id FROM core.profiles WHERE id = auth.uid()))
    )
  );

-- Achievement → personal notification (fires for archer AND coach badges).
CREATE OR REPLACE FUNCTION public.notify_achievement_earned()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_name text;
  v_desc text;
  v_role text;
BEGIN
  SELECT d.name, d.description INTO v_name, v_desc
  FROM achievement.achievement_definitions d WHERE d.id = NEW.achievement_id;
  SELECT role::text INTO v_role FROM core.profiles WHERE id = NEW.profile_id;
  IF v_name IS NULL OR v_role IS NULL THEN RETURN NEW; END IF;

  INSERT INTO notification.notifications
    (title, body, audience, recipient_id, category, priority, status, created_by, published_at)
  VALUES (
    '🏅 Achievement unlocked: ' || v_name,
    COALESCE(v_desc, 'You earned a new badge — see it on your Achievements page.'),
    v_role,             -- audience must match the recipient's role for the read policy
    NEW.profile_id,
    'announcement',
    'normal',
    'published',
    NEW.profile_id,
    now()
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS achievement_notify ON achievement.user_achievements;
CREATE TRIGGER achievement_notify
  AFTER INSERT ON achievement.user_achievements
  FOR EACH ROW EXECUTE FUNCTION public.notify_achievement_earned();

-- ─── PART 5: Server-side overview aggregation (SECURITY INVOKER) ─

-- Weekly national scoring trend, split coached / uncoached. Respects the
-- caller's RLS: an Admin 1 gets THEIR scope's weekly averages automatically.
CREATE OR REPLACE FUNCTION public.overview_weekly_trend(p_days int DEFAULT 90)
RETURNS TABLE (week date, all_avg numeric, linked_avg numeric, unlinked_avg numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    date_trunc('week', s.date)::date AS week,
    ROUND(AVG(s.total_score::numeric / NULLIF(s.max_score, 0)) * 100, 1)                                        AS all_avg,
    ROUND(AVG(s.total_score::numeric / NULLIF(s.max_score, 0)) FILTER (WHERE p.coach_id IS NOT NULL) * 100, 1)  AS linked_avg,
    ROUND(AVG(s.total_score::numeric / NULLIF(s.max_score, 0)) FILTER (WHERE p.coach_id IS NULL) * 100, 1)      AS unlinked_avg
  FROM public.score_submissions s
  JOIN public.profiles p ON p.id = s.archer_id AND p.role = 'archer'
  WHERE s.status = 'admin_approved'
    AND s.date >= (current_date - p_days)
  GROUP BY 1
  ORDER BY 1
$$;

REVOKE ALL     ON FUNCTION public.overview_weekly_trend(int) FROM public;
GRANT  EXECUTE ON FUNCTION public.overview_weekly_trend(int) TO authenticated;

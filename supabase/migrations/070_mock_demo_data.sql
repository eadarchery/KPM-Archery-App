-- ============================================================
-- Migration 070: KPM Demo / Mock Data — safe, tagged, removable
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent (CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS).
--       Safe to re-run. Additive only — no real data is touched.
--
-- WHAT THIS GIVES YOU
--   A one-click way to POPULATE the app with realistic demo data so every
--   dashboard, leaderboard, talent monitor, coach-gap report, school activity
--   view and KPM/Admin report has something meaningful to show — and a
--   one-click way to REMOVE it again, leaving real data untouched.
--
-- SAFETY MODEL (this is the important part)
--   • Every demo row is tagged:
--       is_mock_data = true,  mock_batch_id,  mock_created_at,  mock_seed_name
--   • clear_kpm_demo_mock_data() deletes ONLY rows where is_mock_data = true.
--     It can never delete a real archer, coach, score, school, PLD or state.
--   • Real users are NEVER tagged as mock. Real states/schools that already
--     exist are RE-USED (not re-created, not tagged, never deleted) so demo
--     archers roll up under real org units for a realistic state report.
--   • seed_kpm_demo_mock_data() CLEARS the previous demo batch first, so
--     running it many times never produces duplicates.
--   • Both functions are SECURITY DEFINER but require the caller to be an
--     approved Super Admin (or a service_role / SQL-editor session where
--     auth.uid() IS NULL). No service-role key is needed in the frontend.
--   • Demo accounts have NO auth.users login (they are profile rows only), so
--     nobody can sign in as a demo user — they exist purely to fill reports.
--     Their emails use the reserved .invalid TLD so they can never be real.
--
-- WHAT IT CREATES (per run)
--   • 6 states: Selangor, Kuala Lumpur, Melaka, Johor, Penang, Sabah
--     (re-used if they already exist by name, else created + tagged)
--   • 1 PLD per state (re-used if any exists, else created + tagged)
--   • 3 schools per state (re-uses existing active schools, tops up with
--     "SMK Demo <State> N" mock schools to reach 3)
--   • 6 archers per state (36 total): approved + active, spread across the
--     3 schools, across age groups U12/U15/U18/Open, bows recurve/compound/
--     barebow, mixed gender, in Good / Medium / Low performance pairs
--   • 2 coaches per state (12 total): each linked to archers from 2 schools
--   • 6 score sessions per archer (~216 scores) spread over ~5 months, all
--     admin_approved, showing realistic improvement over time (720 system)
--   • 3 training logs per archer for training-volume metrics
-- ============================================================


-- ─── PART 1: MOCK-TRACKING COLUMNS (additive, idempotent) ──────
-- Added to every table that will hold demo rows. Nullable / defaulted so the
-- change is metadata-only on existing large tables (Postgres fast default).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'core.profiles',
    'org.states',
    'org.plds',
    'org.schools',
    'scoring.score_submissions',
    'scoring.training_logs',
    'scoring.equipment_setups',
    'coaching.coach_archer_links'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS is_mock_data  boolean NOT NULL DEFAULT false', t);
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS mock_batch_id uuid', t);
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS mock_created_at timestamptz', t);
    EXECUTE format('ALTER TABLE %s ADD COLUMN IF NOT EXISTS mock_seed_name text', t);
  END LOOP;
END $$;

-- Partial indexes so cleanup only ever scans demo rows.
CREATE INDEX IF NOT EXISTS core_profiles_mock_idx        ON core.profiles(is_mock_data)               WHERE is_mock_data;
CREATE INDEX IF NOT EXISTS org_states_mock_idx           ON org.states(is_mock_data)                  WHERE is_mock_data;
CREATE INDEX IF NOT EXISTS org_plds_mock_idx             ON org.plds(is_mock_data)                    WHERE is_mock_data;
CREATE INDEX IF NOT EXISTS org_schools_mock_idx          ON org.schools(is_mock_data)                 WHERE is_mock_data;
CREATE INDEX IF NOT EXISTS scoring_submissions_mock_idx  ON scoring.score_submissions(is_mock_data)   WHERE is_mock_data;
CREATE INDEX IF NOT EXISTS scoring_training_mock_idx     ON scoring.training_logs(is_mock_data)       WHERE is_mock_data;
CREATE INDEX IF NOT EXISTS scoring_equipment_mock_idx    ON scoring.equipment_setups(is_mock_data)    WHERE is_mock_data;
CREATE INDEX IF NOT EXISTS coaching_cal_mock_idx         ON coaching.coach_archer_links(is_mock_data) WHERE is_mock_data;


-- ─── PART 2: CLEANUP — removes ONLY demo rows ──────────────────
CREATE OR REPLACE FUNCTION public.clear_kpm_demo_mock_data()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  d_scores    int := 0;
  d_training  int := 0;
  d_equipment int := 0;
  d_links     int := 0;
  d_profiles  int := 0;
  d_schools   int := 0;
  d_plds      int := 0;
  d_states    int := 0;
BEGIN
  -- Only a Super Admin (or a keyless SQL / service_role session) may run this.
  IF auth.uid() IS NOT NULL AND NOT core.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can clear demo data.';
  END IF;

  -- FK-safe order: owned rows first, then profiles, then org units.
  -- (Deleting profiles would cascade most of these anyway; doing it explicitly
  --  avoids any NO-ACTION FK, e.g. score_submissions.coach_id.)
  DELETE FROM scoring.score_submissions   WHERE is_mock_data;  GET DIAGNOSTICS d_scores    = ROW_COUNT;
  DELETE FROM scoring.training_logs       WHERE is_mock_data;  GET DIAGNOSTICS d_training  = ROW_COUNT;
  DELETE FROM scoring.equipment_setups    WHERE is_mock_data;  GET DIAGNOSTICS d_equipment = ROW_COUNT;
  DELETE FROM coaching.coach_archer_links WHERE is_mock_data;  GET DIAGNOSTICS d_links     = ROW_COUNT;

  -- Deleting the demo profiles cascades their archer/coach profiles, equipment
  -- and any remaining owned rows. Real profiles are never is_mock_data.
  DELETE FROM core.profiles WHERE is_mock_data;                GET DIAGNOSTICS d_profiles = ROW_COUNT;

  -- Org units the seed created (real re-used ones are not tagged, so survive).
  DELETE FROM org.schools WHERE is_mock_data;                  GET DIAGNOSTICS d_schools  = ROW_COUNT;
  DELETE FROM org.plds    WHERE is_mock_data;                  GET DIAGNOSTICS d_plds     = ROW_COUNT;
  DELETE FROM org.states  WHERE is_mock_data;                  GET DIAGNOSTICS d_states   = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'removed', jsonb_build_object(
      'scores', d_scores, 'training_logs', d_training, 'equipment', d_equipment,
      'coach_links', d_links, 'profiles', d_profiles,
      'schools', d_schools, 'plds', d_plds, 'states', d_states
    )
  );
END $$;

REVOKE ALL     ON FUNCTION public.clear_kpm_demo_mock_data() FROM public;
GRANT  EXECUTE ON FUNCTION public.clear_kpm_demo_mock_data() TO authenticated;


-- ─── PART 3: SEED — populate a fresh demo batch ────────────────
CREATE OR REPLACE FUNCTION public.seed_kpm_demo_mock_data()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c_seed  constant text := 'kpm_demo_seed';
  v_caller uuid        := auth.uid();
  v_batch  uuid        := gen_random_uuid();
  v_now    timestamptz := now();
  v_year   int         := EXTRACT(YEAR FROM CURRENT_DATE)::int;

  -- 6 states (order fixes the tagged-code suffix for any we must create)
  v_states text[] := ARRAY['Selangor','Kuala Lumpur','Melaka','Johor','Penang','Sabah'];

  -- 6 archer templates per state → 2 good / 2 medium / 2 low, mixed everything.
  --   band, age_group (competition), bow, gender, coach-slot (1|2)
  v_band     text[] := ARRAY['good','good','medium','medium','low','low'];
  v_agegrp   text[] := ARRAY['U18','Open','U15','U12','Open','U15'];
  v_bow      text[] := ARRAY['recurve','compound','barebow','recurve','compound','barebow'];
  v_gender   text[] := ARRAY['male','female','male','female','male','female'];
  v_coachslot int[] := ARRAY[1,1,2,1,2,2];  -- coach1 covers schools {1,2}, coach2 {2,3}

  -- 6 score sessions: days-ago offsets (spans ~5 months; includes today so the
  -- 1-day / 1-week / 1-month filters all show data).
  v_offsets int[] := ARRAY[150,120,85,50,20,0];
  -- 3 training sessions per archer.
  v_toff    int[] := ARRAY[130,60,10];

  -- Score bands (720 system): start → finish (improvement over the 6 sessions)
  v_start int; v_finish int;

  -- Round handles (720 system): recurve/barebow → 70m, compound → 50m
  v_round_r uuid; v_round_c uuid;
  v_round_id uuid; v_round_dist int; v_round_cat text;

  -- loop vars
  s_idx int; a_idx int; k int;
  v_sname text;
  v_state_id uuid; v_pld_id uuid;
  v_school_ids uuid[]; v_sch_id uuid; v_existing int;
  v_coach1 uuid; v_coach2 uuid; v_coach_id uuid;
  v_arch_id uuid;
  v_birth int; v_age int; v_school uuid;
  v_score int; v_email text; v_code text;
  v_arch_seq int := 0; v_coach_seq int := 0; v_sch_seq int;
  n_states int := 0; n_schools int := 0; n_coaches int := 0;
  n_archers int := 0; n_scores int := 0; n_training int := 0; n_equipment int := 0;
BEGIN
  -- ── Auth: Super Admin only (keyless SQL/service_role allowed) ──
  IF v_caller IS NOT NULL AND NOT core.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can seed demo data.';
  END IF;

  -- ── Idempotency: wipe the previous demo batch before inserting ──
  PERFORM public.clear_kpm_demo_mock_data();

  -- ── Ensure the two 720 rounds exist (standard WA reference rounds) ──
  SELECT id INTO v_round_r FROM scoring.rounds WHERE name = 'WA 70m Round' LIMIT 1;
  IF v_round_r IS NULL THEN
    INSERT INTO scoring.rounds (name, total_arrows, max_score, distance_m, category, bow_categories)
    VALUES ('WA 70m Round', 72, 720, 70, 'tournament', ARRAY['recurve']::bow_category[])
    RETURNING id INTO v_round_r;
  END IF;
  SELECT id INTO v_round_c FROM scoring.rounds WHERE name = 'WA 50m Round' LIMIT 1;
  IF v_round_c IS NULL THEN
    INSERT INTO scoring.rounds (name, total_arrows, max_score, distance_m, category, bow_categories)
    VALUES ('WA 50m Round', 72, 720, 50, 'tournament', ARRAY['compound']::bow_category[])
    RETURNING id INTO v_round_c;
  END IF;

  -- ══ Per-state build ══
  FOR s_idx IN 1..array_length(v_states, 1) LOOP
    v_sname := v_states[s_idx];

    -- STATE: re-use by name, else create (tagged).
    SELECT id INTO v_state_id FROM org.states WHERE lower(name) = lower(v_sname) LIMIT 1;
    IF v_state_id IS NULL THEN
      INSERT INTO org.states (name, code, active, is_mock_data, mock_batch_id, mock_created_at, mock_seed_name)
      VALUES (v_sname, 'XD' || s_idx, true, true, v_batch, v_now, c_seed)
      RETURNING id INTO v_state_id;
      n_states := n_states + 1;
    END IF;

    -- PLD: re-use any in this state, else create one (tagged).
    SELECT id INTO v_pld_id FROM org.plds WHERE state_id = v_state_id AND active ORDER BY created_at LIMIT 1;
    IF v_pld_id IS NULL THEN
      INSERT INTO org.plds (name, state_id, active, is_mock_data, mock_batch_id, mock_created_at, mock_seed_name)
      VALUES ('PPD Demo ' || v_sname, v_state_id, true, true, v_batch, v_now, c_seed)
      RETURNING id INTO v_pld_id;
    END IF;

    -- SCHOOLS: re-use up to 3 existing active schools, top up to 3 with mock.
    v_school_ids := ARRAY(
      SELECT id FROM org.schools
      WHERE state_id = v_state_id AND active
      ORDER BY created_at
      LIMIT 3
    );
    v_sch_seq := COALESCE(array_length(v_school_ids, 1), 0);
    WHILE v_sch_seq < 3 LOOP
      v_sch_seq := v_sch_seq + 1;
      INSERT INTO org.schools (name, pld_id, state_id, active, is_mock_data, mock_batch_id, mock_created_at, mock_seed_name)
      VALUES ('SMK Demo ' || v_sname || ' ' || v_sch_seq, v_pld_id, v_state_id, true,
              true, v_batch, v_now, c_seed)
      RETURNING id INTO v_sch_id;
      v_school_ids := array_append(v_school_ids, v_sch_id);
      n_schools := n_schools + 1;
    END LOOP;

    -- COACHES: two per state. coach1 → schools {1,2}, coach2 → schools {2,3}.
    v_coach_seq := v_coach_seq + 1;
    v_email := 'demo.coach.' || v_coach_seq || '@kpm-demo.invalid';
    INSERT INTO core.profiles (id, email, name, role, status, approved_by, approved_at,
                               school_id, pld_id, state_id, created_at,
                               is_mock_data, mock_batch_id, mock_created_at, mock_seed_name)
    VALUES (gen_random_uuid(), v_email, 'Demo Coach ' || v_sname || ' 1', 'coach', 'approved',
            v_caller, v_now, v_school_ids[1], v_pld_id, v_state_id, v_now - interval '200 days',
            true, v_batch, v_now, c_seed)
    RETURNING id INTO v_coach1;
    INSERT INTO coaching.coach_profiles (profile_id, coach_code, is_certified, certification_level)
    VALUES (v_coach1, 'DEMO-C-' || lpad(v_coach_seq::text, 4, '0'), true, 'Level 1');
    n_coaches := n_coaches + 1;

    v_coach_seq := v_coach_seq + 1;
    v_email := 'demo.coach.' || v_coach_seq || '@kpm-demo.invalid';
    INSERT INTO core.profiles (id, email, name, role, status, approved_by, approved_at,
                               school_id, pld_id, state_id, created_at,
                               is_mock_data, mock_batch_id, mock_created_at, mock_seed_name)
    VALUES (gen_random_uuid(), v_email, 'Demo Coach ' || v_sname || ' 2', 'coach', 'approved',
            v_caller, v_now, v_school_ids[2], v_pld_id, v_state_id, v_now - interval '200 days',
            true, v_batch, v_now, c_seed)
    RETURNING id INTO v_coach2;
    INSERT INTO coaching.coach_profiles (profile_id, coach_code, is_certified, certification_level)
    VALUES (v_coach2, 'DEMO-C-' || lpad(v_coach_seq::text, 4, '0'), false, NULL);
    n_coaches := n_coaches + 1;

    -- ARCHERS: six per state.
    FOR a_idx IN 1..6 LOOP
      v_arch_seq := v_arch_seq + 1;

      -- competition age → birth_year
      v_birth := CASE v_agegrp[a_idx]
                   WHEN 'U12'  THEN v_year - 11
                   WHEN 'U15'  THEN v_year - 14
                   WHEN 'U18'  THEN v_year - 17
                   ELSE             v_year - 20
                 END;
      v_age    := v_year - v_birth;
      v_school := v_school_ids[((a_idx - 1) % 3) + 1];
      v_coach_id := CASE WHEN v_coachslot[a_idx] = 1 THEN v_coach1 ELSE v_coach2 END;
      v_email  := 'demo.archer.' || v_arch_seq || '@kpm-demo.invalid';
      v_code   := 'DEMO-' || v_year || '-' || lpad(v_arch_seq::text, 6, '0');

      INSERT INTO core.profiles (
        id, email, name, age, role, status, approved_by, approved_at, archer_id, coach_id,
        school_id, pld_id, state_id, bow_category, gender, birth_year,
        date_of_birth, created_at,
        is_mock_data, mock_batch_id, mock_created_at, mock_seed_name
      ) VALUES (
        gen_random_uuid(), v_email,
        'Demo Archer ' || v_sname || ' ' || a_idx, v_age, 'archer', 'approved', v_caller, v_now,
        v_code, v_coach_id, v_school, v_pld_id, v_state_id,
        v_bow[a_idx]::bow_category, v_gender[a_idx], v_birth,
        make_date(v_birth, 6, 15), v_now - interval '180 days',
        true, v_batch, v_now, c_seed
      ) RETURNING id INTO v_arch_id;

      INSERT INTO coaching.archer_profiles (profile_id, age_group, bow_category)
      VALUES (v_arch_id, lower(v_agegrp[a_idx]), v_bow[a_idx]::bow_category);

      -- Equipment setup — realistic gear matched to the archer's bow style.
      -- Barebow has no sight/stabiliser; compound is heavier draw + stiffer arrows.
      INSERT INTO scoring.equipment_setups (
        profile_id, bow_brand, bow_model, bow_category, draw_weight,
        arrow_brand, arrow_spine, arrow_length, sight_brand, stabilizer, notes, active,
        is_mock_data, mock_batch_id, mock_created_at, mock_seed_name
      ) VALUES (
        v_arch_id,
        CASE v_bow[a_idx] WHEN 'recurve' THEN 'Hoyt'      WHEN 'compound' THEN 'Mathews'   ELSE 'Gillo' END,
        CASE v_bow[a_idx] WHEN 'recurve' THEN 'Formula X' WHEN 'compound' THEN 'TRX 38'    ELSE 'GF Barebow' END,
        v_bow[a_idx]::bow_category,
        (CASE v_bow[a_idx] WHEN 'recurve' THEN 34 WHEN 'compound' THEN 52 ELSE 32 END + (a_idx - 3))::numeric(5,2),
        'Easton',
        CASE v_bow[a_idx] WHEN 'compound' THEN 400 ELSE 600 END,
        (28.5 + (a_idx % 3) * 0.5)::numeric(5,2),
        CASE v_bow[a_idx] WHEN 'barebow' THEN NULL WHEN 'compound' THEN 'Axcel' ELSE 'Shibuya' END,
        CASE v_bow[a_idx] WHEN 'barebow' THEN NULL ELSE 'Fivics Stabiliser Set' END,
        'Demo equipment setup', true,
        true, v_batch, v_now, c_seed
      );
      n_equipment := n_equipment + 1;

      -- Active coach link (approved), and point the archer's coach_id at it.
      INSERT INTO coaching.coach_archer_links (
        coach_id, archer_id, status, linked_at, approved_at, approved_by,
        is_mock_data, mock_batch_id, mock_created_at, mock_seed_name
      ) VALUES (
        v_coach_id, v_arch_id, 'active', v_now - interval '170 days', v_now - interval '170 days', v_caller,
        true, v_batch, v_now, c_seed
      );

      -- Round + performance band for this archer.
      IF v_bow[a_idx] = 'compound' THEN
        v_round_id := v_round_c; v_round_dist := 50;
      ELSE
        v_round_id := v_round_r; v_round_dist := 70;
      END IF;
      v_round_cat := 'tournament';

      v_start  := CASE v_band[a_idx] WHEN 'good' THEN 585 WHEN 'medium' THEN 490 ELSE 310 END;
      v_finish := CASE v_band[a_idx] WHEN 'good' THEN 630 WHEN 'medium' THEN 560 ELSE 420 END;

      -- 6 improving score sessions, all admin_approved.
      FOR k IN 1..array_length(v_offsets, 1) LOOP
        v_score := v_start + ((v_finish - v_start) * (k - 1)) / 5;             -- linear improvement
        v_score := v_score + (floor(random() * 11) - 5)::int;                  -- ±5 jitter
        v_score := GREATEST(0, LEAST(720, v_score));

        -- NOTE: distance_m / round_category are intentionally NOT written here.
        -- They are optional snapshot columns (migration 057); reports and the
        -- leaderboard read distance + category from the ROUND, so the demo does
        -- not need them and the seed stays runnable without migration 057.
        INSERT INTO scoring.score_submissions (
          archer_id, round_id, coach_id, date, total_score, max_score,
          status, admin_approved_at, coach_approved_at, approved_by,
          bow_category, sync_source,
          is_mock_data, mock_batch_id, mock_created_at, mock_seed_name
        ) VALUES (
          v_arch_id, v_round_id, v_coach_id,
          CURRENT_DATE - v_offsets[k], v_score, 720,
          'admin_approved', v_now, v_now, v_coach_id,
          v_bow[a_idx]::bow_category, 'manual',
          true, v_batch, v_now, c_seed
        );
        n_scores := n_scores + 1;
      END LOOP;

      -- 3 training logs for training-volume metrics.
      FOR k IN 1..array_length(v_toff, 1) LOOP
        INSERT INTO scoring.training_logs (
          archer_id, coach_id, date, arrows_shot, session_type, sync_source,
          is_mock_data, mock_batch_id, mock_created_at, mock_seed_name
        ) VALUES (
          v_arch_id, v_coach_id, CURRENT_DATE - v_toff[k],
          60 + floor(random() * 61)::int,
          (ARRAY['indoor','outdoor','field'])[1 + ((k - 1) % 3)], 'manual',
          true, v_batch, v_now, c_seed
        );
        n_training := n_training + 1;
      END LOOP;

      n_archers := n_archers + 1;
    END LOOP;  -- archers
  END LOOP;    -- states

  RETURN jsonb_build_object(
    'ok', true,
    'batch_id', v_batch,
    'seed', c_seed,
    'created', jsonb_build_object(
      'states_new', n_states, 'schools_new', n_schools,
      'coaches', n_coaches, 'archers', n_archers,
      'scores', n_scores, 'training_logs', n_training, 'equipment', n_equipment
    )
  );
END $$;

REVOKE ALL     ON FUNCTION public.seed_kpm_demo_mock_data() FROM public;
GRANT  EXECUTE ON FUNCTION public.seed_kpm_demo_mock_data() TO authenticated;


-- ─── NOTES ─────────────────────────────────────────────────────
--  • Re-run seed any time — it clears its own previous batch first, so it is
--    idempotent and never duplicates.
--  • To remove everything: SELECT public.clear_kpm_demo_mock_data();
--  • Demo scores are admin_approved so they appear in leaderboards, averages
--    and the "verified only" KPM metrics. Age group is computed live from
--    birth_year (same as the leaderboard), so squads roll over on 1 January.
--  • The two WA 720 rounds are standard reference rounds; if they were missing
--    they are created here (not tagged mock) and intentionally kept — they are
--    round definitions, not demo records.
--  • Achievements are NOT force-granted; run public.recheck_score_achievements()
--    afterwards if you want demo badges to populate too.

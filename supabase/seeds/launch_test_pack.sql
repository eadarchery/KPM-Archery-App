-- ============================================================
-- LAUNCH TEST PACK SEED — one test account per role
-- ------------------------------------------------------------
--   ⚠️  RUN MANUALLY, and ONLY on a project you are allowed to
--       seed with test data. Idempotent and safe to re-run.
--   ⚠️  NO real student data. NO Super Admin account.
--   ⚠️  Passwords are NEVER written here — see STEP 1.
--
-- HOW TO USE (two steps):
--
--   STEP 1 (Supabase Dashboard → Authentication → Users → "Add user"):
--     Create these 7 users with "Auto Confirm User" ticked and a strong
--     throwaway password you record in your OWN password manager
--     (never in this repo, the app UI, or shared documents):
--
--       test.archer@asm-test.example
--       test.coach@asm-test.example
--       test.admin1.school@asm-test.example
--       test.admin1.pld@asm-test.example
--       test.admin1.state@asm-test.example
--       test.admin1.multi@asm-test.example
--       test.admin2@asm-test.example
--
--     (Creating auth users via the Dashboard keeps this script free of
--     fragile auth.users inserts and never stores credentials in SQL.)
--
--   STEP 2: run this whole file in the SQL Editor. It creates the test
--     org entities and promotes/wires the 7 profiles by email.
--
--   CLEAN-UP after testing: delete the 7 users in the Dashboard (their
--     profiles cascade), then:  DELETE FROM org.schools WHERE code='ZZTS1';
--     DELETE FROM org.plds WHERE code='ZZTP'; DELETE FROM org.states WHERE code='ZZT';
-- ============================================================

-- ─── 1. TEST ORG ENTITIES (clearly-marked, inactive-looking names) ────

INSERT INTO org.states (name, code, active)
SELECT '_TEST State (ZZT)', 'ZZT', true
WHERE NOT EXISTS (SELECT 1 FROM org.states WHERE code = 'ZZT');

INSERT INTO org.plds (name, code, state_id, active)
SELECT '_TEST PLD (ZZTP)', 'ZZTP', s.id, true
FROM org.states s WHERE s.code = 'ZZT'
  AND NOT EXISTS (SELECT 1 FROM org.plds WHERE code = 'ZZTP');

INSERT INTO org.schools (name, code, state_id, pld_id, active)
SELECT '_TEST School (ZZTS1)', 'ZZTS1', s.id, p.id, true
FROM org.states s, org.plds p
WHERE s.code = 'ZZT' AND p.code = 'ZZTP'
  AND NOT EXISTS (SELECT 1 FROM org.schools WHERE code = 'ZZTS1');

-- ─── 2. WIRE THE PROFILES BY TEST EMAIL ────────────────────────────────
-- handle_new_user() created bare profiles at STEP 1; this promotes them.

DO $$
DECLARE
  v_state  uuid; v_pld uuid; v_school uuid;
  v_coach  uuid;
BEGIN
  SELECT id INTO v_state  FROM org.states  WHERE code = 'ZZT';
  SELECT id INTO v_pld    FROM org.plds    WHERE code = 'ZZTP';
  SELECT id INTO v_school FROM org.schools WHERE code = 'ZZTS1';
  IF v_school IS NULL THEN
    RAISE EXCEPTION 'Run section 1 first (test org rows missing).';
  END IF;

  -- Coach: approved, assigned to the test school.
  UPDATE core.profiles SET
    role = 'coach', status = 'approved', name = 'TEST Coach',
    school_id = v_school, pld_id = v_pld, state_id = v_state,
    approved_at = now()
  WHERE email = 'test.coach@asm-test.example';
  SELECT id INTO v_coach FROM core.profiles WHERE email = 'test.coach@asm-test.example';

  -- Archer: approved at the test school, linked to the test coach.
  UPDATE core.profiles SET
    role = 'archer', status = 'approved', name = 'TEST Archer',
    school_id = v_school, pld_id = v_pld, state_id = v_state,
    coach_id = v_coach, approved_at = now()
  WHERE email = 'test.archer@asm-test.example';

  IF v_coach IS NOT NULL THEN
    INSERT INTO coaching.coach_archer_links (coach_id, archer_id, status, linked_at, approved_at, approved_by)
    SELECT v_coach, p.id, 'active', now(), now(), v_coach
    FROM core.profiles p WHERE p.email = 'test.archer@asm-test.example'
    ON CONFLICT (coach_id, archer_id) DO UPDATE SET status = 'active', unlinked_at = NULL;
  END IF;

  -- "School Admin"  = Admin 1 scoped to the test school.
  UPDATE core.profiles SET role = 'admin1', status = 'approved', name = 'TEST School Admin', approved_at = now()
  WHERE email = 'test.admin1.school@asm-test.example';
  INSERT INTO core.admin1_scopes (admin_id, level, ref_id)
  SELECT id, 'school', v_school FROM core.profiles WHERE email = 'test.admin1.school@asm-test.example'
  ON CONFLICT (admin_id, level, ref_id) DO NOTHING;

  -- "PLD Admin"     = Admin 1 scoped to the test PLD.
  UPDATE core.profiles SET role = 'admin1', status = 'approved', name = 'TEST PLD Admin', approved_at = now()
  WHERE email = 'test.admin1.pld@asm-test.example';
  INSERT INTO core.admin1_scopes (admin_id, level, ref_id)
  SELECT id, 'pld', v_pld FROM core.profiles WHERE email = 'test.admin1.pld@asm-test.example'
  ON CONFLICT (admin_id, level, ref_id) DO NOTHING;

  -- "State Admin"   = Admin 1 scoped to the test state.
  UPDATE core.profiles SET role = 'admin1', status = 'approved', name = 'TEST State Admin', approved_at = now()
  WHERE email = 'test.admin1.state@asm-test.example';
  INSERT INTO core.admin1_scopes (admin_id, level, ref_id)
  SELECT id, 'state', v_state FROM core.profiles WHERE email = 'test.admin1.state@asm-test.example'
  ON CONFLICT (admin_id, level, ref_id) DO NOTHING;

  -- "Admin 1"       = Admin 1 with ALL THREE scopes (tests the scope switcher).
  UPDATE core.profiles SET role = 'admin1', status = 'approved', name = 'TEST Admin 1 Multi', approved_at = now()
  WHERE email = 'test.admin1.multi@asm-test.example';
  INSERT INTO core.admin1_scopes (admin_id, level, ref_id)
  SELECT p.id, v.level, v.ref
  FROM core.profiles p
  CROSS JOIN (VALUES ('state', v_state), ('pld', v_pld), ('school', v_school)) AS v(level, ref)
  WHERE p.email = 'test.admin1.multi@asm-test.example'
  ON CONFLICT (admin_id, level, ref_id) DO NOTHING;

  -- Admin 2: national operations.
  UPDATE core.profiles SET role = 'admin2', status = 'approved', name = 'TEST Admin 2', approved_at = now()
  WHERE email = 'test.admin2@asm-test.example';
END $$;

-- ─── 3. VERIFY ─────────────────────────────────────────────────────────
SELECT p.email, p.role, p.status, p.name,
       (SELECT count(*) FROM core.admin1_scopes s WHERE s.admin_id = p.id) AS scopes
FROM core.profiles p
WHERE p.email LIKE 'test.%@asm-test.example'
ORDER BY p.email;
-- Expect 7 rows: archer+coach approved at _TEST School; school/pld/state
-- admin1s with 1 scope each; multi admin1 with 3; admin2 with 0.

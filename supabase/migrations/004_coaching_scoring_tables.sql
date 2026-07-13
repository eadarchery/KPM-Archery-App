-- ============================================================
-- Migration 004: Coaching & Scoring Schema Tables
-- ============================================================

-- ─── COACHING ────────────────────────────────────────────────

-- coaching.archer_profiles — archer-specific extension data

CREATE TABLE coaching.archer_profiles (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid        NOT NULL UNIQUE REFERENCES core.profiles(id) ON DELETE CASCADE,
  age_group      text        CHECK (age_group IN ('u12','u15','u18','open','veteran')),
  bow_category   bow_category,
  dominant_hand  text        CHECK (dominant_hand IN ('left','right','ambidextrous')),
  draw_length_in numeric(4,1),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER coaching_archer_profiles_updated_at
  BEFORE UPDATE ON coaching.archer_profiles
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- coaching.coach_profiles — coach-specific extension data

CREATE TABLE coaching.coach_profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          uuid        NOT NULL UNIQUE REFERENCES core.profiles(id) ON DELETE CASCADE,
  coach_code          text        UNIQUE,
  specialization      text[],
  experience_years    int,
  affiliated_org      text,
  bio                 text,
  is_certified        boolean     NOT NULL DEFAULT false,
  certification_level text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER coaching_coach_profiles_updated_at
  BEFORE UPDATE ON coaching.coach_profiles
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- coaching.coach_archer_links — full lifecycle coach-archer relationship

CREATE TABLE coaching.coach_archer_links (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id         uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  archer_id        uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','active','rejected','inactive')),
  linked_at        timestamptz NOT NULL DEFAULT now(),
  approved_at      timestamptz,
  approved_by      uuid        REFERENCES core.profiles(id) ON DELETE SET NULL,
  rejected_at      timestamptz,
  rejection_reason text,
  unlinked_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coaching_cal_unique UNIQUE (coach_id, archer_id)
);

CREATE INDEX coaching_cal_coach_id_idx  ON coaching.coach_archer_links(coach_id);
CREATE INDEX coaching_cal_archer_id_idx ON coaching.coach_archer_links(archer_id);
CREATE INDEX coaching_cal_status_idx    ON coaching.coach_archer_links(status);

CREATE OR REPLACE TRIGGER coaching_cal_updated_at
  BEFORE UPDATE ON coaching.coach_archer_links
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── SCORING ─────────────────────────────────────────────────

-- scoring.rounds — archery round definitions

CREATE TABLE scoring.rounds (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  total_arrows   int         NOT NULL,
  max_score      int         NOT NULL,
  distance_m     int,
  min_age        int,
  max_age        int,
  bow_categories bow_category[],
  active         boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- scoring.score_submissions

CREATE TABLE scoring.score_submissions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  archer_id           uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  round_id            uuid        NOT NULL REFERENCES scoring.rounds(id),
  coach_id            uuid        REFERENCES core.profiles(id),
  date                date        NOT NULL,
  total_score         int         NOT NULL,
  max_score           int         NOT NULL,
  arrows_data         jsonb,
  status              text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','coach_approved','admin_approved','rejected')),
  proof_url           text,
  notes               text,
  coach_approved_at   timestamptz,
  admin_approved_at   timestamptz,
  approved_by         uuid        REFERENCES core.profiles(id),
  rejection_reason    text,
  sync_source         text        NOT NULL DEFAULT 'manual'
                                  CHECK (sync_source IN ('manual','excel','offline')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scoring_submissions_archer_idx ON scoring.score_submissions(archer_id);
CREATE INDEX scoring_submissions_status_idx ON scoring.score_submissions(status);
CREATE INDEX scoring_submissions_date_idx   ON scoring.score_submissions(date DESC);
CREATE INDEX scoring_submissions_coach_idx  ON scoring.score_submissions(coach_id);

CREATE OR REPLACE TRIGGER scoring_submissions_updated_at
  BEFORE UPDATE ON scoring.score_submissions
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- scoring.training_logs

CREATE TABLE scoring.training_logs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  archer_id    uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  coach_id     uuid        REFERENCES core.profiles(id),
  date         date        NOT NULL,
  arrows_shot  int         NOT NULL DEFAULT 0,
  session_type text        CHECK (session_type IN ('indoor','outdoor','field','3d','virtual')),
  notes        text,
  sync_source  text        NOT NULL DEFAULT 'manual',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scoring_training_archer_idx ON scoring.training_logs(archer_id);
CREATE INDEX scoring_training_date_idx   ON scoring.training_logs(date DESC);

-- scoring.equipment_setups

CREATE TABLE scoring.equipment_setups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  bow_brand     text,
  bow_model     text,
  bow_category  bow_category,
  draw_weight   numeric(5,2),
  arrow_brand   text,
  arrow_spine   int,
  arrow_length  numeric(5,2),
  sight_brand   text,
  stabilizer    text,
  notes         text,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER scoring_equipment_updated_at
  BEFORE UPDATE ON scoring.equipment_setups
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ============================================================
-- Migration 002: Org Schema Tables
-- org.states → org.plds → org.schools
-- ============================================================

-- org.states ──────────────────────────────────────────────────

CREATE TABLE org.states (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  code       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT org_states_code_unique UNIQUE (code)
);

CREATE OR REPLACE TRIGGER org_states_updated_at
  BEFORE UPDATE ON org.states
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- org.plds ─────────────────────────────────────────────────────

CREATE TABLE org.plds (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  state_id   uuid        NOT NULL REFERENCES org.states(id) ON DELETE RESTRICT,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_plds_state_id_idx ON org.plds(state_id);

CREATE OR REPLACE TRIGGER org_plds_updated_at
  BEFORE UPDATE ON org.plds
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- org.schools ──────────────────────────────────────────────────

CREATE TABLE org.schools (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  pld_id     uuid        REFERENCES org.plds(id)   ON DELETE SET NULL,
  state_id   uuid        NOT NULL REFERENCES org.states(id) ON DELETE RESTRICT,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_schools_state_id_idx ON org.schools(state_id);
CREATE INDEX org_schools_pld_id_idx   ON org.schools(pld_id);

CREATE OR REPLACE TRIGGER org_schools_updated_at
  BEFORE UPDATE ON org.schools
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

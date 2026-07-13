-- ============================================================
-- Migration 003: Core Schema Tables
-- user_roles → permission_rules → role_permissions →
-- app_settings → profiles → school_assignments
-- ============================================================

-- core.user_roles ─────────────────────────────────────────────

CREATE TABLE core.user_roles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         user_role   NOT NULL,
  display_name text        NOT NULL,
  description  text,
  sort_order   int         NOT NULL DEFAULT 0,
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_user_roles_name_unique UNIQUE (name)
);

CREATE OR REPLACE TRIGGER core_user_roles_updated_at
  BEFORE UPDATE ON core.user_roles
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- core.permission_rules ───────────────────────────────────────
-- Source of truth for what each role is allowed to do.
-- updated_by FK added after core.profiles is created.

CREATE TABLE core.permission_rules (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role           user_role   NOT NULL,
  permission_key text        NOT NULL,
  allowed        boolean     NOT NULL DEFAULT true,
  description    text,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_permission_rules_role_key UNIQUE (role, permission_key)
);

CREATE INDEX core_permission_rules_role_idx ON core.permission_rules(role);

CREATE OR REPLACE TRIGGER core_permission_rules_updated_at
  BEFORE UPDATE ON core.permission_rules
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- core.role_permissions ───────────────────────────────────────
-- JSONB snapshot per role, rebuilt on permission_rules change.
-- Fast client-side permission lookup without 20 row queries.

CREATE TABLE core.role_permissions (
  role        user_role   PRIMARY KEY,
  permissions jsonb       NOT NULL DEFAULT '{}',
  version     int         NOT NULL DEFAULT 1,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- core.app_settings ───────────────────────────────────────────

CREATE TABLE core.app_settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- core.profiles ───────────────────────────────────────────────
-- id = auth.users(id) — same pattern as Supabase convention.
-- status uses CHECK so we can add values without enum migration.

CREATE TABLE core.profiles (
  id               uuid        PRIMARY KEY,  -- mirrors auth.users(id)
  email            text        NOT NULL,
  name             text        NOT NULL,
  age              int,
  role             user_role   NOT NULL DEFAULT 'archer',
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','approved','rejected','suspended','inactive')),
  rejection_reason text,
  approved_by      uuid,       -- self-ref FK added below
  approved_at      timestamptz,
  archer_id        text,       -- human-readable: KPM-YYYY-XXXXXX
  coach_id         uuid,       -- FK to core.profiles(id) for coach ref, added below
  school_id        uuid        REFERENCES org.schools(id) ON DELETE SET NULL,
  pld_id           uuid        REFERENCES org.plds(id)    ON DELETE SET NULL,
  state_id         uuid        REFERENCES org.states(id)  ON DELETE SET NULL,
  bow_category     bow_category,
  avatar_url       text,
  phone            text,
  date_of_birth    date,
  gender           text        CHECK (gender IN ('male','female','other','prefer_not_to_say')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT core_profiles_email_unique     UNIQUE (email),
  CONSTRAINT core_profiles_archer_id_unique UNIQUE (archer_id)
);

CREATE INDEX core_profiles_role_idx      ON core.profiles(role);
CREATE INDEX core_profiles_status_idx    ON core.profiles(status);
CREATE INDEX core_profiles_state_id_idx  ON core.profiles(state_id);
CREATE INDEX core_profiles_school_id_idx ON core.profiles(school_id);
CREATE INDEX core_profiles_coach_id_idx  ON core.profiles(coach_id);

CREATE OR REPLACE TRIGGER core_profiles_updated_at
  BEFORE UPDATE ON core.profiles
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- Self-referential FKs (added after table exists)
ALTER TABLE core.profiles
  ADD CONSTRAINT core_profiles_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES core.profiles(id)
  ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE core.profiles
  ADD CONSTRAINT core_profiles_coach_id_fkey
  FOREIGN KEY (coach_id) REFERENCES core.profiles(id)
  ON DELETE SET NULL;

-- Back-fill FKs on tables created before profiles
ALTER TABLE core.permission_rules
  ADD CONSTRAINT core_permission_rules_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE core.role_permissions
  ADD CONSTRAINT core_role_permissions_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

ALTER TABLE core.app_settings
  ADD CONSTRAINT core_app_settings_updated_by_fkey
  FOREIGN KEY (updated_by) REFERENCES core.profiles(id) ON DELETE SET NULL;

-- org.school_assignments ──────────────────────────────────────
-- Created here because it depends on core.profiles.

CREATE TABLE org.school_assignments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  school_id   uuid        NOT NULL REFERENCES org.schools(id)   ON DELETE CASCADE,
  assigned_by uuid        REFERENCES core.profiles(id)          ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  is_current  boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_school_assignments_profile_idx ON org.school_assignments(profile_id);
CREATE INDEX org_school_assignments_school_idx  ON org.school_assignments(school_id);

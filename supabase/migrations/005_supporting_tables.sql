-- ============================================================
-- Migration 005: Supporting Schema Tables
-- certification, achievement, notification, content, audit
-- ============================================================

-- ─── CERTIFICATION ───────────────────────────────────────────

CREATE TABLE certification.certifications (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id           uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  title              text        NOT NULL,
  issuer             text,
  certificate_level  text,
  certificate_number text,
  issued_date        date,
  expiry_date        date,
  cert_url           text,
  status             text        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending','approved','rejected','withdrawn','expired')),
  reviewed_by        uuid        REFERENCES core.profiles(id),
  reviewed_at        timestamptz,
  rejection_reason   text,
  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cert_coach_id_idx   ON certification.certifications(coach_id);
CREATE INDEX cert_status_idx     ON certification.certifications(status);
CREATE INDEX cert_expiry_idx     ON certification.certifications(expiry_date);

CREATE OR REPLACE TRIGGER certification_updated_at
  BEFORE UPDATE ON certification.certifications
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── ACHIEVEMENT ─────────────────────────────────────────────

CREATE TABLE achievement.achievement_definitions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  description text        NOT NULL,
  category    text        NOT NULL CHECK (category IN ('score','practice','tournament')),
  icon        text,
  threshold   int,
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE achievement.user_achievements (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  achievement_id uuid        NOT NULL REFERENCES achievement.achievement_definitions(id),
  earned_at      timestamptz NOT NULL DEFAULT now(),
  context        jsonb,
  CONSTRAINT user_achievements_unique UNIQUE (profile_id, achievement_id)
);

CREATE INDEX user_achievements_profile_idx ON achievement.user_achievements(profile_id);

-- ─── NOTIFICATION ────────────────────────────────────────────

CREATE TABLE notification.notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text        NOT NULL,
  body         text        NOT NULL,
  audience     text        NOT NULL DEFAULT 'all'
                           CHECK (audience IN ('all','archer','coach','admin1','admin2','state','pld','school')),
  audience_ref uuid,       -- state_id / pld_id / school_id depending on audience
  created_by   uuid        NOT NULL REFERENCES core.profiles(id),
  published_at timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_audience_idx    ON notification.notifications(audience);
CREATE INDEX notification_published_idx   ON notification.notifications(published_at);

CREATE TABLE notification.notification_reads (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid        NOT NULL REFERENCES notification.notifications(id) ON DELETE CASCADE,
  profile_id      uuid        NOT NULL REFERENCES core.profiles(id) ON DELETE CASCADE,
  read_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_reads_unique UNIQUE (notification_id, profile_id)
);

CREATE INDEX notification_reads_profile_idx ON notification.notification_reads(profile_id);

-- ─── CONTENT ─────────────────────────────────────────────────

CREATE TABLE content.articles (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text        NOT NULL,
  slug         text        NOT NULL UNIQUE,
  summary      text,
  cover_url    text,
  body_blocks  jsonb       NOT NULL DEFAULT '[]',
  audience     text        NOT NULL DEFAULT 'all',
  category     text,
  author_id    uuid        NOT NULL REFERENCES core.profiles(id),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX articles_published_idx ON content.articles(published_at);
CREATE INDEX articles_audience_idx  ON content.articles(audience);

CREATE OR REPLACE TRIGGER content_articles_updated_at
  BEFORE UPDATE ON content.articles
  FOR EACH ROW EXECUTE FUNCTION core.set_updated_at();

-- ─── AUDIT ───────────────────────────────────────────────────

CREATE TABLE audit.audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid        REFERENCES core.profiles(id) ON DELETE SET NULL,
  action      text        NOT NULL,
  target_type text,
  target_id   uuid,
  meta        jsonb,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_actor_idx   ON audit.audit_logs(actor_id);
CREATE INDEX audit_logs_action_idx  ON audit.audit_logs(action);
CREATE INDEX audit_logs_created_idx ON audit.audit_logs(created_at DESC);
CREATE INDEX audit_logs_target_idx  ON audit.audit_logs(target_type, target_id);

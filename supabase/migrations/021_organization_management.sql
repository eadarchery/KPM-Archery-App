-- ============================================================
-- Migration 021: Organization Management — extend PLD & School tables
-- Adds code/contact/address fields needed by the management pages.
-- public.states/plds/schools use SELECT * so they pick up new columns
-- automatically; no view recreation needed.
-- ============================================================

-- ── org.plds: add code column ─────────────────────────────────

ALTER TABLE org.plds
  ADD COLUMN IF NOT EXISTS code text;

-- PLD code must be unique within a state (NULLs are excluded — a PLD
-- without a code is not checked for uniqueness).
CREATE UNIQUE INDEX IF NOT EXISTS org_plds_state_code_unique
  ON org.plds (state_id, code)
  WHERE code IS NOT NULL;

-- ── org.schools: add contact / address columns ────────────────

ALTER TABLE org.schools
  ADD COLUMN IF NOT EXISTS code         text,
  ADD COLUMN IF NOT EXISTS address      text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS contact_email  text,
  ADD COLUMN IF NOT EXISTS contact_phone  text;

-- ── Refresh api.plds view to expose new code column ──────────
-- (public.plds uses SELECT * and auto-picks up the new column)

CREATE OR REPLACE VIEW api.plds
  WITH (security_invoker = true) AS
SELECT
  pl.id,
  pl.name,
  pl.code,
  pl.state_id,
  pl.active,
  pl.created_at,
  pl.updated_at,
  st.name  AS state_name,
  st.code  AS state_code
FROM org.plds pl
JOIN org.states st ON st.id = pl.state_id;

-- ── Refresh api.schools view to expose new columns ────────────

CREATE OR REPLACE VIEW api.schools
  WITH (security_invoker = true) AS
SELECT
  s.id,
  s.name,
  s.code,
  s.pld_id,
  s.state_id,
  s.address,
  s.contact_person,
  s.contact_email,
  s.contact_phone,
  s.active,
  s.created_at,
  s.updated_at,
  pl.name  AS pld_name,
  st.name  AS state_name,
  st.code  AS state_code
FROM org.schools s
LEFT JOIN org.plds   pl ON pl.id = s.pld_id
JOIN      org.states st ON st.id = s.state_id;

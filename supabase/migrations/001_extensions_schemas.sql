-- ============================================================
-- Migration 001: Extensions & Schemas
-- KPM Archery App
-- ============================================================

-- ─── EXTENSIONS ──────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- trigram index for text search

-- ─── DATABASE-LEVEL ENUMS ────────────────────────────────────
-- PostgreSQL enums are database-level (not schema-qualified).
-- Use CHECK constraints for flexible status fields instead.

CREATE TYPE user_role AS ENUM (
  'archer', 'coach', 'admin1', 'admin2', 'super_admin'
);

CREATE TYPE bow_category AS ENUM (
  'recurve', 'compound', 'barebow', 'longbow', 'traditional'
);

-- ─── SCHEMAS ─────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS core;          -- user identity, roles, permissions
CREATE SCHEMA IF NOT EXISTS org;           -- states, PLDs, schools
CREATE SCHEMA IF NOT EXISTS coaching;      -- coach/archer profiles, links
CREATE SCHEMA IF NOT EXISTS scoring;       -- rounds, submissions, training, equipment
CREATE SCHEMA IF NOT EXISTS certification; -- coach certifications
CREATE SCHEMA IF NOT EXISTS achievement;   -- definitions + user grants
CREATE SCHEMA IF NOT EXISTS notification;  -- notifications + reads
CREATE SCHEMA IF NOT EXISTS content;       -- articles, media
CREATE SCHEMA IF NOT EXISTS audit;         -- audit logs
CREATE SCHEMA IF NOT EXISTS analytics;     -- aggregated views (reserved)
CREATE SCHEMA IF NOT EXISTS api;           -- PostgREST-safe views (frontend layer)

-- ─── SHARED TRIGGER FUNCTION ─────────────────────────────────
-- Used by all schemas below. Defined once in core schema.

CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

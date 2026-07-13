---
name: migration
description: Create a Supabase migration for the KPM Archery App the right way — numbering, idempotency, the SELECT * view gotcha, RLS, grants, NOTIFY, and the manual-run hand-off. Use whenever a task needs a schema change (new table, new column, new RPC, RLS change, view change) or when the user reports "schema cache" / "column does not exist" errors after a migration.
---

# Supabase Migration Workflow (KPM Archery App)

This project NEVER auto-applies migrations. The user pastes each file into the
Supabase SQL Editor manually. Your job: write a bulletproof file, hand it over
with zero friction, and verify after they run it.

## Step 1 — Pick the number

`ls supabase/migrations` and take the highest prefix + 1. ⚠️ The folder has
historical duplicate numbers (055, 056, 057 each exist twice) — check the FULL
listing, not just the tail, and never reuse an existing number.

## Step 2 — Write the file

Name: `NNN_short_slug.sql`. Header format (copy the house style):

```sql
-- ============================================================
-- Migration NNN: <title>
-- ------------------------------------------------------------
--   ⚠️  RUN THIS MANUALLY IN THE SUPABASE SQL EDITOR.
--       Idempotent. <one line: additive only / recreates X / etc.>
--
-- WHY: <2-3 lines of context>
-- ============================================================
```

Hard rules, in order:

1. **Idempotent always**: `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS` before `CREATE POLICY`.
2. **THE VIEW GOTCHA (this project's #1 recurring bug)**: `public.*` views are
   `SELECT *` passthroughs over schema tables (core/org/scoring/coaching/content/…).
   A `SELECT *` view does **NOT** auto-gain columns added to the base table later —
   the column list froze at view creation. **Any migration that adds a column to a
   view-backed table MUST also `CREATE OR REPLACE VIEW public.<name> WITH
   (security_invoker = true) AS SELECT * FROM <schema>.<name>;`** and re-apply the
   view's GRANTs (they do not survive recreation).
3. **New tables**: `ENABLE ROW LEVEL SECURITY` immediately. Baseline policies:
   SELECT for `authenticated` gated on `core.is_approved()`; writes scoped to the
   owning role (`core.is_super_admin()` for config tables). Then create the
   `public.` view (security_invoker) + grants.
4. **`security_invoker` by default.** `SECURITY DEFINER` only with a documented
   SECURITY NOTE comment explaining why (precedent: `public.leaderboard`, migration 075).
5. **RPCs**: follow migration 061's `p_filters jsonb` contract — key names must match
   `toKpmFilterPayload` in `src/services/kpmMetrics.ts` (`state_id`, `start_date`, …).
   Never invent new filter key names.
6. **Last line of every migration**: `NOTIFY pgrst, 'reload schema';`
7. **Never**: seed fake data (except the tagged demo seeder, migration 070),
   reference the service-role key, or rewrite existing safe policies wholesale.

## Step 3 — Frontend changes that depend on the new column

Until the user has run the migration, the column does not exist for the app:

- Do NOT add the new column to an existing page's main `SELECT` — if it 404s, the
  whole query dies and the page breaks (this broke the Profile page once). Fetch it
  in a separate defensive query, or feature-detect and degrade.
- Saves touching the new column need the resilient pattern: on an error matching
  the column name, retry without it and show a bilingual "run migration NNN" notice.
- KPM report components: wrap RPC errors with `<KpmBackendNotice migrations="NNN" />`.
- PostgREST embedded joins (`select('*, author:author_id(name)')`) DO NOT work
  through views — use the de-embed + client-side stitch pattern (see
  `attachAuthors` in `src/services/articles.ts`).

## Step 4 — Hand-off message (always the same shape)

End your reply with:

1. A clickable markdown link: `[NNN_slug.sql](supabase/migrations/NNN_slug.sql)`
2. "Run it in the **Supabase SQL Editor**" + run order if more than one file is pending.
3. What it changes, in one sentence.
4. Expected result: usually **"Success. No rows returned"**.

Do not make the user ask "give me the link" or "which page do I run this on".

## Step 5 — After the user confirms ("Success. No rows returned" / "i ran NNN")

- If a view was recreated, remind them changes are live immediately — no rebuild.
- If they still see a **"Could not find the '<col>' column … in the schema cache"**
  error after running it: the cause is almost never the cache alone — check first
  that the migration actually recreated the `public.` view (Step 2 rule 2), then
  `NOTIFY pgrst, 'reload schema';`, then hard-refresh the app.
- Verify end-to-end from the app (save + reload the affected page), then run
  `node .\node_modules\typescript\bin\tsc --noEmit` and
  `node .\node_modules\vite\bin\vite.js build` if frontend files changed.

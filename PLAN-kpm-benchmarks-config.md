# PLAN 4 — KPM benchmark standards & participation targets (config tables)

**Rank: #4 of 5.** `docs/kpm-reporting-readiness.md` §6 lists the three official KPM metrics the
app still cannot produce — classification/benchmark attainment, participation targets vs actual,
and formal attendance — all blocked because *the numbers must come from KPM and must not be
hardcoded*. The unblocker is the same pattern already proven by the **Talent Rating config**
(migration `071_kpm_talent_config.sql` + `src/pages/superadmin/TalentConfig.tsx` +
`getKpmTalentConfig`/`updateKpmTalentConfig` in `src/services/kpmMetrics.ts`): a Super-Admin-editable
reference table that all reporting reads live. Ship the mechanism now; KPM's numbers get typed in
when they arrive. **Until rows exist, every dependent metric must display "Not configured" — never
a fake default (project no-fake-data rule).**

Scope note: this plan covers metrics 1 and 2 (score standards + participation targets). Formal
attendance needs a product decision (true register vs `arrows_shot > 0` proxy) — leave it out.

## The goal

1. Migration `078_kpm_benchmarks.sql`: two reference tables + views + RLS + two `security_invoker`
   RPCs (`kpm_benchmark_attainment`, `kpm_target_progress`).
2. Service functions + types in `src/services/kpmMetrics.ts`.
3. Super Admin page `/super-admin/kpm-benchmarks` to CRUD both tables (clone the TalentConfig page
   pattern: same guard, same resilient save, same bilingual layout).
4. Two new cards/sections in the Admin 2 KPM report area that render attainment and target progress,
   with an explicit "Not configured" empty state.

## Exact files to touch

1. `supabase/migrations/078_kpm_benchmarks.sql` (new — user runs it manually in the SQL Editor)
2. `src/services/kpmMetrics.ts` (add types + 6 functions)
3. `src/pages/superadmin/KpmBenchmarks.tsx` (new page — clone structure from
   `src/pages/superadmin/TalentConfig.tsx`)
4. `src/App.tsx` (lazy import + route `/super-admin/kpm-benchmarks`, `allowedRoles: ['super_admin']`
   — copy the exact pattern of the existing `talent-config` route)
5. `src/components/layout/Header.tsx` (menu entry next to the existing Talent Rating item, same
   role gating)
6. `src/components/reports/kpm/KpmBenchmarkSection.tsx` (new — attainment + target cards; follow the
   style of the existing `src/components/reports/kpm/*` sections and mount it where they are mounted
   — find the parent by grepping for `KpmDataQualitySection`)
7. `src/i18n/en.ts` + `src/i18n/ms.ts` (new `kpmBenchmarks` group)

## Step-by-step implementation order

### Step 1 — Migration `078_kpm_benchmarks.sql`

Follow the header/comment style of `071_kpm_talent_config.sql`. Contents, in order:

```sql
-- Table 1: score standards (classification thresholds)
CREATE TABLE IF NOT EXISTS scoring.kpm_score_standards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,                -- e.g. 'Bronze', 'Silver', 'SUKMA qualifying'
  age_group     text,                         -- 'U12'|'U15'|'U18'|'Open', NULL = any
  bow_category  text,                         -- matches scoring bow_category values, NULL = any
  distance_m    numeric,                      -- NULL = any
  min_score_pct numeric NOT NULL CHECK (min_score_pct >= 0 AND min_score_pct <= 100),
  sort_order    int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Table 2: participation targets
CREATE TABLE IF NOT EXISTS scoring.kpm_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_level    text NOT NULL CHECK (scope_level IN ('national','state','pld','school')),
  scope_ref      uuid,                        -- state/pld/school id; NULL for national
  target_year    int NOT NULL,
  target_archers int NOT NULL CHECK (target_archers >= 0),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope_level, scope_ref, target_year)
);
```

Then, mirroring 071 exactly:
- `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on both.
- Policies: SELECT for `authenticated` requiring `core.is_approved()`; ALL (insert/update/delete)
  for `core.is_super_admin()`.
- `CREATE OR REPLACE VIEW public.kpm_score_standards WITH (security_invoker = true) AS SELECT * FROM scoring.kpm_score_standards;`
  and the same for `public.kpm_targets`. Grant `SELECT, INSERT, UPDATE, DELETE … TO authenticated`.
- RPC 1 `public.kpm_benchmark_attainment(p_filters jsonb DEFAULT '{}')` — `security_invoker`,
  modelled on the RPCs in `061_kpm_development_metrics.sql` (reuse its `kpm_filtered_scores`
  helper): for each **active** standard, count distinct archers whose best admin-approved
  normalised score % in the filtered period ≥ `min_score_pct`, matching the standard's
  age_group/bow_category/distance where those are NOT NULL (NULL = wildcard). Returns
  `TABLE (standard_id uuid, label text, min_score_pct numeric, eligible_archers bigint, attained_archers bigint)`.
- RPC 2 `public.kpm_target_progress(p_filters jsonb DEFAULT '{}')` — for each target row whose
  scope intersects the filter scope and `target_year = COALESCE((p_filters->>'year')::int, extract(year from now()))`:
  returns `TABLE (target_id uuid, scope_level text, scope_ref uuid, scope_label text, target_year int, target_archers int, actual_archers bigint)`
  where `actual_archers` counts approved archers registered in that scope.
- `GRANT EXECUTE` to `authenticated`; end with `NOTIFY pgrst, 'reload schema';`
- **Seed nothing.** Empty tables are the correct initial state.

⚠️ Copy the exact filter-payload parsing (`p_filters` keys like `state_id`, `start_date`) from
migration 061 — read it first; do not invent new key names, the TS serialiser
`toKpmFilterPayload` already defines the contract.

### Step 2 — Service layer (`src/services/kpmMetrics.ts`)

Add, following the file's existing section style:
- `KpmScoreStandard`, `KpmTarget`, `KpmBenchmarkAttainmentRow`, `KpmTargetProgressRow` interfaces
  matching the SQL exactly.
- `getKpmScoreStandards()` / `saveKpmScoreStandard(row)` / `deleteKpmScoreStandard(id)` — plain
  view CRUD (`from('kpm_score_standards')`), ordered by `sort_order`.
- Same trio for `kpm_targets` (ordered by `target_year desc, scope_level`).
- `getKpmBenchmarkAttainment(f: ReportFilters)` / `getKpmTargetProgress(f: ReportFilters)` — RPC
  wrappers copying the `getKpmSummary` pattern (including the `Array.isArray(data)` handling only
  for single-row RPCs; these return arrays, so just `(data ?? []) as …`).

### Step 3 — Super Admin CRUD page

Clone `src/pages/superadmin/TalentConfig.tsx`'s skeleton (guard via the same super-admin check,
PageWrapper/PageHead, save feedback pattern). Two sections:
1. **Score standards** — table of rows with inline edit modal: label, age group (Select with the 4
   canonical values + "Any"), bow category (Select from the app's bow categories + "Any"), distance
   (number + "Any"), min score % (number 0–100), sort order, active toggle. Add / edit / delete.
2. **Participation targets** — table with modal: scope level Select, cascading scope ref Select
   (reuse the State→PLD→School cascading pattern from `src/components/reports/kpm/KpmArcherListModal.tsx`),
   year (number, default current year), target archers, notes.

Wire route in `App.tsx` + Header menu item exactly like `talent-config` / Talent Rating (grep for
`talent-config` in both files and mirror every occurrence).

### Step 4 — Report section `KpmBenchmarkSection.tsx`

- Two cards: "Benchmark attainment" (per-standard: label, threshold, attained/eligible + %) and
  "Participation vs target" (per-target: scope label, actual/target + progress bar).
- Empty state when the respective table has no rows: an info box —
  `t('kpmBenchmarks.notConfigured')` with a hint that Super Admin can configure it (and, for
  super_admin viewers only, a link to `/super-admin/kpm-benchmarks`).
- On RPC error matching `/function .*kpm_(benchmark|target)/i` render
  `<KpmBackendNotice migrations="078" />` (existing component in `src/components/reports/kpm/shared.tsx`).
- Mount it alongside the other KPM sections (find the parent page/component that renders
  `KpmDataQualitySection` and add this section in the same list, feeding it the same
  `ReportFilters` object the siblings receive).

### Step 5 — i18n

New `kpmBenchmarks` group in **both** `en.ts` and `ms.ts`: page title, section titles, every field
label, "Any" option, add/edit/delete/save strings, `notConfigured` copy, attainment/target card
labels. Write natural BM (e.g. "Sasaran Penyertaan" for participation targets, "Pencapaian Penanda
Aras" for benchmark attainment, "Belum dikonfigurasi" for not configured). Reuse `common.*` keys
where they exist (save/cancel/delete/edit) instead of duplicating.

### Step 6 — Verify

- `node .\node_modules\typescript\bin\tsc --noEmit` + `node .\node_modules\vite\bin\vite.js build`.
- Tell the user to run migration **078** manually in the Supabase SQL Editor (this project never
  auto-applies migrations).
- After they run it: create one standard + one national target in the new page, open the KPM report,
  see both cards populate; delete the rows, see "Not configured" return.

## Edge cases a weaker model would miss

1. **No seeded defaults, anywhere.** The talent config used COALESCE defaults because those were
   app-invented heuristics; benchmark/target numbers are *official KPM figures* — an invented
   default would be fake data. Empty table → "Not configured" UI, and the RPCs return zero rows.
2. **Age-group matching must use the canonical calendar-year function** `core.kpm_age_group(birth_year, year)`
   (migration 061) — NOT `archer_profiles.age_group` (a different, legacy taxonomy).
3. **NULL = wildcard columns**: matching predicate is
   `(s.age_group IS NULL OR s.age_group = <archer age group>) AND (s.bow_category IS NULL OR …) AND (s.distance_m IS NULL OR …)`.
   An archer can satisfy several standards at once — that's correct (tiers), do not dedupe across
   standards.
4. **A score's distance lives on the round** (`scoring.rounds.distance_m`), not the submission —
   join through `round_id` like migration 061 does.
5. **`security_invoker` means RLS scopes the counts** to what the caller can read; Admin 1 sees
   attainment inside their scope automatically. Do NOT mark the RPCs `SECURITY DEFINER`.
6. **`public` views vs schema tables**: the frontend must only ever touch `public.kpm_score_standards`
   / `public.kpm_targets`. And remember this project's recurring gotcha: if you later ADD a column
   to either table, you must `CREATE OR REPLACE` the view — a `SELECT *` view does not auto-gain
   columns.
7. **Target uniqueness**: the `UNIQUE (scope_level, scope_ref, target_year)` constraint makes a
   duplicate insert fail — surface a friendly bilingual error in the modal
   (`kpmBenchmarks.duplicateTarget`), don't show the raw Postgres message.
8. **`scope_ref` is NULL for national** — Postgres UNIQUE treats NULLs as distinct, so add a partial
   unique index for the national case:
   `CREATE UNIQUE INDEX IF NOT EXISTS kpm_targets_national_year ON scoring.kpm_targets (target_year) WHERE scope_level = 'national';`
9. **Route guard**: the page must be super_admin-only in BOTH `App.tsx` `allowedRoles` and the page's
   own guard, matching TalentConfig — admin2 must get AccessDenied, not a broken page.
10. **Do not put migration 078 logic in the frontend** — attainment math is SQL-only. The section
    component only renders RPC output.

## Acceptance criteria

- [ ] Migration `078_kpm_benchmarks.sql` exists, is idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`),
      creates 2 tables + 2 views + RLS + 2 `security_invoker` RPCs + grants + `NOTIFY`, and seeds nothing.
- [ ] `/super-admin/kpm-benchmarks` CRUDs both tables; admin2 gets AccessDenied; menu entry visible
      to super_admin only.
- [ ] KPM report shows the two new cards; with empty tables they show "Not configured" (EN + BM),
      never 0%-style fake numbers; with the migration missing they show `KpmBackendNotice`.
- [ ] Attainment respects NULL-wildcard matching and the canonical `U12/U15/U18/Open` age groups.
- [ ] All new UI strings exist in both `en.ts` and `ms.ts`.
- [ ] `tsc --noEmit` + `vite build` pass. Final message to the user says: **run migration 078
      manually in the Supabase SQL Editor.**

# KPM Reporting Readiness — Audit & Foundation

Status date: 2026-07-05.
**KPM** = Kementerian Pendidikan Malaysia. The app runs "in partnership with KPM,"
so *KPM reporting* = official Ministry program-monitoring metrics across the
**State → PLD → School** hierarchy.

**Golden rule:** official/trusted report numbers are never computed in frontend
pages. Every metric comes from a `security_invoker` view (migration 025), a
`security_invoker` RPC (migration 061), or the `reports.ts` / `kpmMetrics.ts`
service layer. All metrics slot into the shared `ReportFilters` structure.

---

## 1. Data already recorded → reusable for KPM metrics

| Domain | Table | KPM-relevant fields |
|---|---|---|
| Demographics | `core.profiles` | `role`, `status`, `state_id`, `pld_id`, `school_id`, `bow_category`, **`gender`**, `date_of_birth`, **`birth_year`** (059), `age`, `created_at` |
| Archer ext. | `coaching.archer_profiles` | `age_group`, `bow_category`, `dominant_hand`, `draw_length_in` |
| Coach ext. | `coaching.coach_profiles` | `is_certified`, `certification_level`, `experience_years` |
| Coach link | `coaching.coach_archer_links` | lifecycle `status` (active/…) → coach:archer ratio |
| Rounds | `scoring.rounds` | `distance_m`, `max_score`, `category` (training/practice/tournament/selection) |
| Performance | `scoring.score_submissions` | `total_score`, `max_score`, `status`, `date`, `coach_id`, `bow_category`, `age_group` snapshot |
| Activity | `scoring.training_logs` | `arrows_shot`, `session_type`, `date` |
| Coach quality | `certification.certifications` | `status`, `issued_date`, `expiry_date`, `certificate_level` |
| Recognition | `achievement.*` | badge defs + `user_achievements.earned_at` |
| Org tree | `org.states / plds / schools` | `active` flags |

Raw data for nearly every standard KPM KPI already exists. Gender and birth-year
are captured but were **not surfaced in any report** before this foundation.

## 2. Report views & services that already existed

- **Views (025, `security_invoker`, all-time):** `report_state_activity`,
  `report_pld_activity`, `report_school_activity`, `report_emerging_talents`.
- **Leaderboard (059):** best approved score per archer × bow × round-category ×
  distance, **live calendar-year age group** (U12/U15/U18/Open), state & national ranks.
- **Services:** `reports.ts` (summary, trend, breakdowns, talents, validation,
  coach report, archer progress), `leaderboard.ts`, `training.ts` (per-archer only).

Gap that motivated migration 061: the 025 views are **all-time snapshots** and
cannot be parameterised, so they can't answer period-based, multi-dimension KPM
questions.

## 3. Report filters — the shared `ReportFilters`

Now supports: `preset`, `startDate`, `endDate`, `stateId`, `pldId`, `schoolId`,
`ageGroup`, `bowCategory`, `roundType`, `coachId`, `archerId`, **`roundId`**,
**`roundCategory`**, **`distanceM`**, **`scoreStatus`**, **`verifiedOnly`**, **`gender`**.

- *Verification status* → `scoreStatus` (`admin_approved` = verified) + `verifiedOnly`.
- *Practice vs tournament / score type* → `roundCategory`.
- *Distance* → `distanceM`.

## 4. Age-group taxonomy — UNIFIED

The app had three schemes: `u14/u18/u21/open` (old report filters),
`u12/u15/u18/open/veteran` (archer_profiles), `U12/U15/U18/Open` (leaderboard 059).

**Canonical for all KPM reporting: `U12 / U15 / U18 / Open`, calendar-year based**
(`competition age = report year − birth year`; ≤12 U12, ≤15 U15, ≤18 U18, else Open):
- SQL: `core.kpm_age_group(birth_year, on_year)` (migration 061) — one source of truth.
- TS: `kpmAgeGroupForBirthYear` / `kpmAgeGroupForAge` / `normalizeKpmAgeGroup`
  (`src/services/kpmMetrics.ts`) — mirror the SQL; legacy/lowercase strings are
  **mapped for display, never rewritten**. The legacy `ageInGroup` in `reports.ts`
  is untouched so the existing emerging-talents filter keeps working.

## 5. Foundation implemented (this pass)

- **Migration `061_kpm_development_metrics.sql`** (`security_invoker` RPCs, run
  manually): `kpm_age_group`, `kpm_scoped_archers`, `kpm_filtered_scores`,
  `kpm_report_summary`, `kpm_report_breakdown`, `kpm_score_trend`. Period-based;
  every `ReportFilters` dimension supported; RLS auto-scopes (admin2 national /
  admin1 assigned scope) with no new policy.
- **`src/services/kpmMetrics.ts`** — typed `getKpmSummary` / `getKpmBreakdown` /
  `getKpmTrend`, the `toKpmFilterPayload` serialiser, and the canonical age helpers.
- **`ReportFilters`** extended (gender + score/round/distance/verified dimensions).
- **Date presets** now include 1m / 3m / 6m / 1y / **3y** / **5y** / custom / all
  (`DatePreset` + `PRESET_DAYS` + resolveRange; two dropdown options + EN/BM i18n).

## 6. Still missing (needs KPM inputs, not built)

| Metric | Blocker |
|---|---|
| Classification/benchmark attainment | needs KPM's official qualifying-score thresholds |
| Participation targets vs actual | needs KPM's enrolment quota per scope/period |
| Formal attendance % | needs a decision: true register vs `arrows_shot > 0` proxy |

These require a new reference table (`kpm_score_standards` / `kpm_targets`) and
**must not be hardcoded** until KPM provides the numbers.

## 7. Frontend files for the later (Fable) UI merge

`src/pages/admin2/Reports.tsx`, `src/pages/admin1/Reports.tsx`,
`src/pages/admin1/StateReport.tsx` (move its client-side training/retention math
onto the RPCs), `src/components/reports/ReportFilters.tsx` (gender Select),
`src/i18n/{en,ms}.ts`. Reuse `BreakdownTable`, `ValidationSummary`,
`EmergingTalentList`, `ReportPrintShell`.

---

### What's ready for the next prompt
The trusted, period-based, fully-filterable metric layer is live and typed.
Next prompts can (a) wire these RPCs into the report pages, and/or (b) add the
targets/classification reference tables **once KPM supplies thresholds & quotas**.

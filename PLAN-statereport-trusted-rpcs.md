# PLAN 3 — Move StateReport onto the trusted KPM RPC layer

**Rank: #3 of 5.** The Admin 1 **State Report** (`/admin1/state-report`) is a printable official
document, but today its numbers are computed in the browser from raw row fetches that are **wrong
at scale**:

- `sr-archers` fetches state profiles with `.limit(5000)` — PostgREST clamps every response to
  `max-rows` (default **1000**), so a large state silently loses archers.
- `sr-subs` fetches `score_submissions` for the **entire country** (no state filter!) with
  `.limit(10000)` — clamped to 1000 rows nationally, then intersected with state archers
  client-side. Once national volume passes 1000 submissions per period, a state's report shows a
  near-random subset.
- This violates the project golden rule (docs/kpm-reporting-readiness.md): *official numbers are
  never computed in frontend pages* — they come from `security_invoker` RPCs.

The trusted RPC layer (migrations 061–066, service `src/services/kpmMetrics.ts`) already provides
everything this page computes. **No new migration is needed.**

## The goal

Replace the two raw fetches and the client-side aggregation in
`src/pages/admin1/StateReport.tsx` with calls to the existing typed RPC wrappers, keeping the page's
layout, findings thresholds, print output, and bilingual copy unchanged.

## Exact files to touch

1. `src/pages/admin1/StateReport.tsx` — the only file that changes.
2. (Read-only reference, do not modify): `src/services/kpmMetrics.ts` — all wrappers exist:
   - `getKpmSummary(filters)` → `KpmSummary` (line ~96: `registered_archers`, `new_registrations`,
     `active_archers`, `scores_submitted`, `scores_admin_approved`, `avg_score_pct`,
     `best_score_pct`, `training_sessions`, `arrows_shot`, `coaches`, `schools_total`,
     `schools_reporting`, …)
   - `getKpmBreakdown('school' | 'pld' | 'coach', filters)` → `KpmBreakdownRow[]` (`group_key`,
     `group_label`, `archers`, `scores_submitted`, `scores_admin_approved`, `avg_score_pct`,
     `best_score_pct`)
   - `getKpmScoreImprovement(filters)` → per-archer improvement rows (first-half vs second-half
     delta — this IS the "emerging talents" computation, done in SQL; read
     `KpmScoreImprovementRow` in the file for exact fields before mapping)
   - `getKpmTrainingActivity(filters)` — already used by this page for arrows (keep as is).

## Current landmarks in `StateReport.tsx` (~830 lines; verify before editing)

- ~lines 37–47: local `ArcherRow` / `Sub` interfaces (will shrink/disappear)
- ~lines 108–132: the two offending queries (`sr-archers`, `sr-subs`)
- ~lines 148–174: `report_school_activity` / `report_pld_activity` view queries (keep — registered
  counts per entity; they're small, state-filtered, and view-backed)
- ~lines 180–265: `useMemo` computing cur/prev averages, active counts, per-school/PLD tables,
  talents, top performers
- ~lines 267–310+: rule-based findings (thresholds 5 / 3 / 10 etc.) — keep every threshold identical
- Period math at ~lines 66–68: `startCur = daysAgo(days)`, `startPrev = daysAgo(days * 2)`

## Step-by-step implementation order

### Step 1 — Add the RPC queries (replace `sr-archers` + `sr-subs`)

All filters go through `ReportFilters`: `{ stateId, startDate, endDate }`.
Current window = `{ stateId, startDate: startCur }`. Previous window =
`{ stateId, startDate: startPrev, endDate: daysAgo(days + 1) }` (same convention the page already
uses for `getKpmTrainingActivity` at ~line 145).

```ts
const { data: sumCur, error: sumErr } = useQuery({
  queryKey: ['sr-sum-cur', stateId, period], enabled,
  queryFn: () => getKpmSummary({ stateId, startDate: startCur }),
})
const { data: sumPrev } = useQuery({
  queryKey: ['sr-sum-prev', stateId, period], enabled,
  queryFn: () => getKpmSummary({ stateId, startDate: startPrev, endDate: daysAgo(days + 1) }),
})
const { data: schoolRowsCur = [] } = useQuery({
  queryKey: ['sr-bd-school-cur', stateId, period], enabled,
  queryFn: () => getKpmBreakdown('school', { stateId, startDate: startCur }),
})
// same pattern: sr-bd-school-prev, sr-bd-pld-cur, sr-bd-pld-prev, and
// sr-improve (getKpmScoreImprovement({ stateId, startDate: startCur }))
```
Delete the `sr-archers` and `sr-subs` queries, the `ArcherRow`/`Sub` interfaces, and the local
`pct()` helper once nothing references them.

### Step 2 — Rewire the `useMemo` report computation

Map old client-side values → RPC fields:

| Old client computation | New source |
|---|---|
| `cur.length` (sessions current) | `sumCur.scores_submitted` |
| `prev.length` | `sumPrev.scores_submitted` |
| `avgCur` / `avgPrev` (approved avg %) | `sumCur.avg_score_pct` / `sumPrev.avg_score_pct` |
| `activeCur` / `activePrev` (distinct scoring archers) | `sumCur.active_archers` / `sumPrev.active_archers` |
| `newRegs` | `sumCur.new_registrations` |
| per-school table (`sessions`, `avgPct`, `delta`) | join `schoolRowsCur`/`schoolRowsPrev` on `group_key`; `sessions = scores_submitted`, `avgPct = avg_score_pct`, `delta = round1(cur.avg - prev.avg)`; `registered` still comes from the existing `report_school_activity` rows joined on `school_id = group_key` |
| per-PLD table | same with the `pld` breakdowns |
| emerging talents (≥4 sessions, half-vs-half delta) | `getKpmScoreImprovement` rows — filter/sort per its fields (read the interface; it has session counts and improvement delta). Keep the page's ≥4-sessions threshold by filtering the rows |
| top performers (best %, top 10) | derive from `getKpmScoreImprovement` rows if they carry avg/best %, otherwise from `getKpmBreakdown('coach'…)` — **check the row interfaces first**; whichever carries per-archer best/avg %. If neither has per-archer best %, use `getKpmTalentCandidates({ stateId, startDate: startCur })` which carries per-archer metrics |
| coached vs uncoached avg | `getKpmBreakdown('coach', …)`: rows with `group_key === null` are the uncoached bucket; weighted-average the coached rows by `scores_admin_approved` for the coached side |

Keep every findings threshold and `t('stateReport.…')` key exactly as is — only the inputs change.

### Step 3 — Loading/error wiring

- `loading` (~line 176) becomes the OR of the new queries' `isLoading`.
- Migration-missing handling: this page already renders `KpmBackendNotice` for the training RPC
  (`trainErr`). Extend the same guard: if `sumErr` (or any breakdown error) has a message matching
  `/function .*kpm_/i`, render `<KpmBackendNotice migrations="061" />` (copy the exact usage pattern
  already in this file / in `src/components/reports/kpm/shared.tsx`).

### Step 4 — Clean up + verify

- Remove now-unused imports (`supabase` may become unused if no raw query remains except the two
  activity views — those still need it; check).
- `node .\node_modules\typescript\bin\tsc --noEmit` and `node .\node_modules\vite\bin\vite.js build`.
- In the app as Admin 1 (or super_admin): generate a state report for each period preset; numbers
  render; print preview (`PrintReportButton`/window.print) still shows the full document.

## Edge cases a weaker model would miss

1. **`avg_score_pct` semantics**: the RPC averages **admin-approved** normalised scores — identical
   to the old `curApp` filter (`status === 'admin_approved' && max_score`). Do not additionally
   filter; do not re-normalise.
2. **The previous-window end date must be `daysAgo(days + 1)`**, not `startCur` — otherwise the
   boundary day is counted in both windows. The page already uses this convention for training
   (line ~145); copy it.
3. **`group_key` can be `null`** in breakdown rows (archers with no school/PLD/coach). The school/
   PLD tables must skip null keys (old code did this implicitly via `if (!k) continue`); the coach
   breakdown must KEEP the null row — it's the uncoached bucket.
4. **Percent-delta findings divide by the previous value** (`pd()` helper) — previous can now be a
   `0` straight from the RPC; the existing `p ? … : null` guard already handles it. Keep it.
5. **`KpmSummary` numbers may arrive as strings** from PostgREST bigint columns in some setups —
   the existing KPM sections already consume these wrappers without issue, so trust the wrapper
   types; but wrap arithmetic in `Number(...)` if `tsc` complains.
6. **Trend/consistency of "sessions"**: old `sessions` counted ALL submissions (any status) in the
   period — `scores_submitted` is the matching RPC field (not `scores_admin_approved`). School
   table `sessions` likewise = `scores_submitted`.
7. **Don't touch `report_school_activity` / `report_pld_activity` queries** — registered-archer
   counts come from those views, are state-filtered, small, and RLS-safe. Only the raw
   profile/score fetches are being retired.
8. **RPC responses are also subject to the PostgREST row cap**, but every RPC used here returns
   aggregated rows (1 summary row; one row per school/PLD/archer-with-improvement) — far below 1000
   for a single state. Do NOT reintroduce per-score row fetches "just for one small thing".
9. **Talents sign convention**: verify whether the improvement RPC's delta is (second half − first
   half) like the old code before sorting descending — flip the sort if reversed, don't flip the data.
10. **The migrations must have been run** (061, 065, 066 for improvement/talents). Graceful path =
    `KpmBackendNotice`, never a blank page. Test by temporarily renaming the RPC name in a local
    call if you can't verify the DB.

## Acceptance criteria

- [ ] `StateReport.tsx` contains **no** `from('score_submissions')` and no `from('profiles')` fetch.
- [ ] `.limit(5000)` / `.limit(10000)` are gone from the file.
- [ ] All findings, tables, talents and top performers render with RPC-sourced numbers; thresholds
      and i18n keys unchanged (diff shows no `stateReport.*` key changes).
- [ ] Previous-window queries use `endDate = daysAgo(days + 1)`.
- [ ] Missing-migration state renders `KpmBackendNotice`, not a crash or empty report.
- [ ] Print output (print preview) unchanged in structure; EN and BM both render.
- [ ] `tsc --noEmit` + `vite build` pass. Only `StateReport.tsx` changed.

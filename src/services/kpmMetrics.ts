/**
 * KPM Development Metrics service — the trusted, period-based reporting layer.
 *
 * Every number here is computed by the SECURITY INVOKER RPCs in migration 061
 * (kpm_report_summary / kpm_report_breakdown / kpm_score_trend), NOT in the
 * browser — so RLS scoping (admin2 national, admin1 assigned-scope) is enforced
 * by the database exactly like the migration 025 views. This service only
 * serialises filters and types the results.
 *
 * It reuses the shared ReportFilters structure from ./reports so a single filter
 * bar drives both the legacy all-time reports and these KPM period reports.
 *
 * IMPORTANT (RPC serialisation): supabase-js already serialises RPC arguments,
 * and p_filters is jsonb — so we pass the plain object as `p_filters`. Do NOT
 * JSON.stringify it (that double-encodes into a jsonb string scalar).
 */
import { supabase } from './supabase'
import { resolveRange, type ReportFilters } from './reports'

// ─── FILTER PAYLOAD ──────────────────────────────────────────────────────────

/** Keys passed straight through to the RPC jsonb (string-valued filters). */
const PASSTHROUGH_KEYS = [
  'stateId', 'pldId', 'schoolId', 'coachId', 'archerId',
  'ageGroup', 'bowCategory', 'gender', 'roundId', 'roundCategory', 'scoreStatus',
  'sessionType', 'certificationStatus', 'certificationLevel',
] as const

/**
 * Turn a ReportFilters object into the jsonb payload the KPM RPCs expect:
 * resolves the date preset to concrete ISO dates and drops empty values. The
 * returned object is handed to supabase.rpc() as-is (see serialisation note).
 */
export function toKpmFilterPayload(f: ReportFilters = {}): Record<string, unknown> {
  const { startISO, endISO } = resolveRange(f)
  const payload: Record<string, unknown> = { endDate: endISO.slice(0, 10) }
  if (startISO) payload.startDate = startISO.slice(0, 10)

  for (const k of PASSTHROUGH_KEYS) {
    const v = f[k]
    if (v != null && v !== '') payload[k] = v
  }
  if (f.distanceM != null) payload.distanceM = f.distanceM
  if (f.verifiedOnly != null) payload.verifiedOnly = f.verifiedOnly
  return payload
}

// ─── CANONICAL AGE BANDS ─────────────────────────────────────────────────────
// The ONE age scheme for KPM reporting: U12/U15/U18/Open, calendar-year based.
// These mirror the SQL core.kpm_age_group() (migration 061) and the leaderboard
// (059) exactly, so the frontend and database can never disagree. The app's two
// legacy schemes (u14/u18/u21/open in old report filters; u12/u15/u18/open/
// veteran in archer_profiles) are mapped in via normalizeKpmAgeGroup — legacy
// stored values are never rewritten, only displayed under the canonical band.

export const KPM_AGE_GROUPS = ['U12', 'U15', 'U18', 'Open'] as const
export type KpmAgeGroup = (typeof KPM_AGE_GROUPS)[number]

/** Band from a competition age (report year − birth year). ≤12 U12, ≤15 U15, ≤18 U18, else Open. */
export function kpmAgeGroupForAge(competitionAge: number | null | undefined): KpmAgeGroup | null {
  if (competitionAge == null || !Number.isFinite(competitionAge)) return null
  if (competitionAge <= 12) return 'U12'
  if (competitionAge <= 15) return 'U15'
  if (competitionAge <= 18) return 'U18'
  return 'Open'
}

/** Live/period band from a birth year: competition age = reportYear − birthYear. */
export function kpmAgeGroupForBirthYear(
  birthYear: number | null | undefined,
  reportYear: number = new Date().getFullYear(),
): KpmAgeGroup | null {
  if (birthYear == null || !Number.isFinite(birthYear)) return null
  return kpmAgeGroupForAge(reportYear - birthYear)
}

/** Normalise any legacy/lowercase stored band string to a canonical KPM band.
 *  Prefer kpmAgeGroupForBirthYear when a birth year is available — this is only
 *  for the rare stored-string case. u14→U15 and u21→Open are best-fit mappings. */
export function normalizeKpmAgeGroup(value: string | null | undefined): KpmAgeGroup | null {
  if (!value) return null
  switch (value.trim().toLowerCase()) {
    case 'u12': return 'U12'
    case 'u15': return 'U15'
    case 'u18': return 'U18'
    case 'open':
    case 'veteran':
    case 'u21': return 'Open'   // legacy 19–21 sits in Open under the KPM scheme
    case 'u14': return 'U15'    // legacy ≤14 → nearest KPM band
    default: return null
  }
}

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface KpmSummary {
  registered_archers: number
  new_registrations: number
  active_archers: number
  male: number
  female: number
  gender_other: number
  gender_unspecified: number
  coaches: number
  schools_total: number
  schools_reporting: number
  scores_submitted: number
  scores_coach_approved: number
  scores_admin_approved: number
  scores_pending: number
  scores_rejected: number
  avg_score_pct: number | null
  best_score_pct: number | null
  training_sessions: number
  arrows_shot: number
  achievements_earned: number
}

/** Group dimension for a KPM breakdown — mirrors the RPC's p_group_by values. */
export type KpmGroupBy =
  | 'state' | 'pld' | 'school' | 'coach'
  | 'age_group' | 'bow_category' | 'gender'
  | 'round' | 'round_category' | 'distance'

export interface KpmBreakdownRow {
  group_key: string | null
  group_label: string | null
  archers: number
  scores_submitted: number
  scores_admin_approved: number
  scores_pending: number
  scores_rejected: number
  avg_score_pct: number | null
  best_score_pct: number | null
}

export type KpmTrendBucket = 'day' | 'week' | 'month'

export interface KpmTrendPoint {
  bucket: string
  submitted: number
  admin_approved: number
  pending: number
  rejected: number
  avg_approved_pct: number | null
}

const EMPTY_SUMMARY: KpmSummary = {
  registered_archers: 0, new_registrations: 0, active_archers: 0,
  male: 0, female: 0, gender_other: 0, gender_unspecified: 0,
  coaches: 0, schools_total: 0, schools_reporting: 0,
  scores_submitted: 0, scores_coach_approved: 0, scores_admin_approved: 0,
  scores_pending: 0, scores_rejected: 0,
  avg_score_pct: null, best_score_pct: null,
  training_sessions: 0, arrows_shot: 0, achievements_earned: 0,
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

/** Single-row period KPI summary for the filtered (RLS-scoped) cohort. */
export async function getKpmSummary(f: ReportFilters = {}): Promise<KpmSummary> {
  const { data, error } = await supabase.rpc('kpm_report_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  // RETURNS TABLE → an array with a single row.
  const row = (Array.isArray(data) ? data[0] : data) as KpmSummary | undefined
  return row ?? EMPTY_SUMMARY
}

/** Metrics grouped by any supported dimension, ordered by validated activity. */
export async function getKpmBreakdown(
  groupBy: KpmGroupBy,
  f: ReportFilters = {},
): Promise<KpmBreakdownRow[]> {
  const { data, error } = await supabase.rpc('kpm_report_breakdown', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmBreakdownRow[]
}

/** Time-bucketed submitted-vs-validated trend over the filter window. */
export async function getKpmTrend(
  f: ReportFilters = {},
  bucket: KpmTrendBucket = 'day',
): Promise<KpmTrendPoint[]> {
  const { data, error } = await supabase.rpc('kpm_score_trend', {
    p_filters: toKpmFilterPayload(f),
    p_bucket: bucket,
  })
  if (error) throw error
  return (data ?? []) as KpmTrendPoint[]
}

// ─── TRAINING ACTIVITY (migration 062) ───────────────────────────────────────
// Trusted training-volume aggregation — replaces the browser-side arrow
// summation in StateReport.tsx. Same ReportFilters payload, plus sessionType.

export interface KpmTrainingSummary {
  total_sessions: number
  total_arrows: number
  avg_arrows_per_session: number | null
  active_training_archers: number
  active_training_coaches: number
}

export interface KpmTrainingTrendPoint {
  bucket: string
  sessions: number
  arrows: number
  archers: number
}

/** Group dimension for a training breakdown — mirrors the RPC's p_group_by. */
export type KpmTrainingGroupBy =
  | 'state' | 'pld' | 'school' | 'coach'
  | 'age_group' | 'gender' | 'bow_category' | 'session_type'

export interface KpmTrainingBreakdownRow {
  group_key: string | null
  group_label: string | null
  sessions: number
  arrows: number
  avg_arrows: number | null
  archers: number
  coaches: number
}

const EMPTY_TRAINING_SUMMARY: KpmTrainingSummary = {
  total_sessions: 0, total_arrows: 0, avg_arrows_per_session: null,
  active_training_archers: 0, active_training_coaches: 0,
}

/** Single-row training KPIs (sessions, arrows, avg/session, active archers+coaches). */
export async function getKpmTrainingActivity(f: ReportFilters = {}): Promise<KpmTrainingSummary> {
  const { data, error } = await supabase.rpc('kpm_training_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as KpmTrainingSummary | undefined
  return row ?? EMPTY_TRAINING_SUMMARY
}

/** Sessions + arrows over the window, bucketed by day/week/month (default month). */
export async function getKpmTrainingTrend(
  f: ReportFilters = {},
  bucket: KpmTrendBucket = 'month',
): Promise<KpmTrainingTrendPoint[]> {
  const { data, error } = await supabase.rpc('kpm_training_trend', {
    p_filters: toKpmFilterPayload(f),
    p_bucket: bucket,
  })
  if (error) throw error
  return (data ?? []) as KpmTrainingTrendPoint[]
}

/** Training metrics grouped by any supported dimension, ordered by arrows shot. */
export async function getKpmTrainingBreakdown(
  groupBy: KpmTrainingGroupBy,
  f: ReportFilters = {},
): Promise<KpmTrainingBreakdownRow[]> {
  const { data, error } = await supabase.rpc('kpm_training_breakdown', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmTrainingBreakdownRow[]
}

// ─── COACH COVERAGE & CERTIFICATION (migration 063) ──────────────────────────
// Trusted coach availability / certification / workload aggregation. Cert status
// comes from certification.certifications (coach_profiles.is_certified is a
// fallback surfaced as certified_by_flag_only). Coach headcount is a current
// snapshot; date range affects activity metrics (ratio, stale, workload) only.

export interface KpmCoachCoverage {
  total_coaches: number
  active_coaches: number
  certified_coaches: number
  uncertified_coaches: number
  expired_cert_coaches: number
  /** Cumulative: coaches whose furthest valid cert lapses within N days (≤30 ⊂ ≤90 ⊂ ≤180). */
  expiring_30: number
  expiring_90: number
  expiring_180: number
  /** Flagged is_certified but with NO valid certification record — a data conflict to review. */
  certified_by_flag_only: number
  active_archers: number
  archers_per_active_coach: number | null
  schools_with_active_coach: number
  schools_without_active_coach: number
  plds_with_active_coach: number
  states_with_active_coach: number
  avg_linked_per_active_coach: number | null
  coaches_no_linked_archers: number
  coaches_stale: number
  pending_link_approvals: number
}

export type KpmCoachGroupBy =
  | 'state' | 'pld' | 'school'
  | 'certification_level' | 'certification_status'
  | 'specialization' | 'experience_band' | 'gender' | 'coach_status'

export interface KpmCoachBreakdownRow {
  group_key: string | null
  group_label: string | null
  coaches: number
  certified: number
  uncertified: number
  expired: number
  expiring_soon: number
  avg_experience: number | null
}

export interface KpmCoachWorkloadRow {
  coach_id: string
  coach_name: string | null
  state: string | null
  pld: string | null
  school: string | null
  cert_status: string
  linked_total: number
  linked_active: number
  linked_inactive: number
  pending_links: number
  active_students_with_activity: number
  has_recent_activity: boolean
}

export interface KpmCertificationExpiryRow {
  coach_id: string
  coach_name: string | null
  state: string | null
  pld: string | null
  school: string | null
  cert_status: string
  latest_cert_level: string | null
  max_cert_expiry: string | null
  days_to_expiry: number | null
}

const EMPTY_COACH_COVERAGE: KpmCoachCoverage = {
  total_coaches: 0, active_coaches: 0,
  certified_coaches: 0, uncertified_coaches: 0, expired_cert_coaches: 0,
  expiring_30: 0, expiring_90: 0, expiring_180: 0, certified_by_flag_only: 0,
  active_archers: 0, archers_per_active_coach: null,
  schools_with_active_coach: 0, schools_without_active_coach: 0,
  plds_with_active_coach: 0, states_with_active_coach: 0,
  avg_linked_per_active_coach: null,
  coaches_no_linked_archers: 0, coaches_stale: 0, pending_link_approvals: 0,
}

/** Single-row coach coverage + certification + workload KPIs. */
export async function getKpmCoachCoverage(f: ReportFilters = {}): Promise<KpmCoachCoverage> {
  const { data, error } = await supabase.rpc('kpm_coach_coverage_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as KpmCoachCoverage | undefined
  return row ?? EMPTY_COACH_COVERAGE
}

/** Coach coverage grouped by any supported dimension, ordered by coach count. */
export async function getKpmCoachCoverageBreakdown(
  groupBy: KpmCoachGroupBy,
  f: ReportFilters = {},
): Promise<KpmCoachBreakdownRow[]> {
  const { data, error } = await supabase.rpc('kpm_coach_coverage_breakdown', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmCoachBreakdownRow[]
}

/** Per-coach workload list (link counts + whether students are active in-window). */
export async function getKpmCoachWorkload(f: ReportFilters = {}): Promise<KpmCoachWorkloadRow[]> {
  const { data, error } = await supabase.rpc('kpm_coach_workload', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmCoachWorkloadRow[]
}

/** Per-coach certification expiry list, soonest-to-lapse / most-overdue first. */
export async function getKpmCertificationExpiry(f: ReportFilters = {}): Promise<KpmCertificationExpiryRow[]> {
  const { data, error } = await supabase.rpc('kpm_certification_expiry', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmCertificationExpiryRow[]
}

/** One certificate held by a coach (from the certifications table). */
export interface KpmCoachCert {
  title: string | null
  level: string | null
  issuer: string | null
  status: string | null
  expiry: string | null
  issued: string | null
}

export interface KpmCoachCertRow {
  coach_id: string
  coach_name: string | null
  state: string | null
  pld: string | null
  school: string | null
  coach_status: string | null
  cert_status: string
  eff_level: string | null
  experience_years: number | null
  has_valid_cert: boolean
  has_expired_cert: boolean
  max_cert_expiry: string | null
  days_to_expiry: number | null
  cert_count: number
  approved_cert_count: number
  certs: KpmCoachCert[]
}

/** Per-coach certificate list (count + each certificate's title/level/type). */
export async function getKpmCoachCertifications(f: ReportFilters = {}): Promise<KpmCoachCertRow[]> {
  const { data, error } = await supabase.rpc('kpm_coach_certifications', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmCoachCertRow[]
}

export interface KpmSchoolWithoutCoachRow {
  school_id: string
  school: string | null
  pld: string | null
  state: string | null
  registered_archers: number
}

/** Active schools in scope with no approved coach assigned (busiest first). */
export async function getKpmSchoolsWithoutCoach(f: ReportFilters = {}): Promise<KpmSchoolWithoutCoachRow[]> {
  const { data, error } = await supabase.rpc('kpm_schools_without_coach', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmSchoolWithoutCoachRow[]
}

// ─── RETENTION & DROPOUT (migration 064) ─────────────────────────────────────
// Activity = score submission OR training log (training never hidden by
// verifiedOnly). Current vs previous period, cohort-by-registration-month, and
// inactivity thresholds. Reuses kpm_scoped_archers + kpm_filtered_scores/training.

export interface KpmRetentionSummary {
  registered_archers: number
  active_current: number
  active_previous: number
  returning_active: number
  new_active: number
  retained: number
  dropout: number
  retention_rate: number | null
  dropout_rate: number | null
  inactive_30: number
  inactive_60: number
  inactive_90: number
  inactive_180: number
  inactive_365: number
}

export type KpmRetentionGroupBy =
  | 'state' | 'pld' | 'school' | 'coach' | 'age_group' | 'gender' | 'bow_category'

export interface KpmRetentionBreakdownRow {
  group_key: string | null
  group_label: string | null
  archers: number
  active_current: number
  active_previous: number
  retained: number
  dropout: number
  retention_rate: number | null
}

export interface KpmCohortRow {
  cohort_month: string
  cohort_size: number
  active_count: number
  retained_count: number
  dropout_count: number
  retention_rate: number | null
}

export interface KpmInactiveArcherRow {
  archer_id: string
  archer_name: string | null
  archer_code: string | null
  state: string | null
  pld: string | null
  school: string | null
  age_group: string | null
  gender: string | null
  registered_at: string | null
  last_activity: string | null
  days_inactive: number
}

const EMPTY_RETENTION_SUMMARY: KpmRetentionSummary = {
  registered_archers: 0, active_current: 0, active_previous: 0,
  returning_active: 0, new_active: 0, retained: 0, dropout: 0,
  retention_rate: null, dropout_rate: null,
  inactive_30: 0, inactive_60: 0, inactive_90: 0, inactive_180: 0, inactive_365: 0,
}

/** Period-over-period retention + inactivity buckets for the scoped cohort. */
export async function getKpmRetentionSummary(f: ReportFilters = {}): Promise<KpmRetentionSummary> {
  const { data, error } = await supabase.rpc('kpm_retention_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as KpmRetentionSummary | undefined
  return row ?? EMPTY_RETENTION_SUMMARY
}

export interface KpmRetentionArcher {
  archer_id: string
  archer_name: string | null
  archer_code: string | null
  state: string | null
  pld: string | null
  school: string | null
  age_group: string | null
  gender: string | null
  registered_at: string | null
  last_activity: string | null
  active_current: boolean
  active_previous: boolean
  days_inactive: number
}

/** Per-archer retention rows (active_current/previous flags) behind the cards. */
export async function getKpmRetentionArchers(f: ReportFilters = {}): Promise<KpmRetentionArcher[]> {
  const { data, error } = await supabase.rpc('kpm_retention_archers', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmRetentionArcher[]
}

/** Retention grouped by any supported dimension, ordered by cohort size. */
export async function getKpmRetentionBreakdown(
  groupBy: KpmRetentionGroupBy,
  f: ReportFilters = {},
): Promise<KpmRetentionBreakdownRow[]> {
  const { data, error } = await supabase.rpc('kpm_retention_breakdown', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmRetentionBreakdownRow[]
}

/** Retention by registration-month cohort. inactiveDays sets the dropout threshold (default 90). */
export async function getKpmCohortRetention(
  f: ReportFilters = {},
  inactiveDays = 90,
): Promise<KpmCohortRow[]> {
  const { data, error } = await supabase.rpc('kpm_cohort_retention', {
    p_filters: toKpmFilterPayload(f),
    p_inactive_days: inactiveDays,
  })
  if (error) throw error
  return (data ?? []) as KpmCohortRow[]
}

/** Per-archer list of archers inactive for >= inactiveDays (default 90), most-inactive first. */
export async function getKpmInactiveArchers(
  f: ReportFilters = {},
  inactiveDays = 90,
): Promise<KpmInactiveArcherRow[]> {
  const { data, error } = await supabase.rpc('kpm_inactive_archers', {
    p_filters: toKpmFilterPayload(f),
    p_inactive_days: inactiveDays,
  })
  if (error) throw error
  return (data ?? []) as KpmInactiveArcherRow[]
}

// ─── SCORE NORMALISATION & IMPROVEMENT (migration 065) ───────────────────────
// Fair performance reporting via score PERCENTAGE (total/max, with rounds.max_score
// fallback). verifiedOnly defaults true for performance; funnel counts stay visible.
// Raw score is context only — percentage is the official cross-round comparison.

export interface KpmScoreSummary {
  total_scores: number
  scores_verified: number
  scores_coach_approved: number
  scores_pending: number
  scores_rejected: number
  avg_raw_score: number | null
  median_raw_score: number | null
  avg_score_pct: number | null
  median_score_pct: number | null
  highest_score_pct: number | null
  lowest_score_pct: number | null
  personal_best_raw: number | null
  personal_best_pct: number | null
  avg_first_score_pct: number | null
  avg_latest_score_pct: number | null
  avg_improvement_pp: number | null
  archers_improving: number
  archers_declining: number
}

export interface KpmScoreImprovementRow {
  archer_id: string
  archer_name: string | null
  archer_code: string | null
  state_id: string | null
  pld_id: string | null
  school_id: string | null
  coach_id: string | null
  gender: string | null
  bow_category: string | null
  age_group: string | null
  n_scores: number
  first_date: string | null
  latest_date: string | null
  first_pct: number | null
  latest_pct: number | null
  best_pct: number | null
  avg_pct: number | null
  improvement_pp: number | null
}

export type KpmScoreGroupBy =
  | 'state' | 'pld' | 'school' | 'coach'
  | 'age_group' | 'gender' | 'bow_category' | 'round_category' | 'distance'

export interface KpmScoreImprovementBreakdownRow {
  group_key: string | null
  group_label: string | null
  archers: number
  avg_improvement_pp: number | null
  avg_first_pct: number | null
  avg_latest_pct: number | null
  improving: number
  declining: number
}

export interface KpmScoreTrendPoint {
  bucket: string
  scores: number
  avg_score_pct: number | null
  median_score_pct: number | null
  best_score_pct: number | null
}

export interface KpmPracticeTournamentRow {
  bucket: string
  scores: number
  archers: number
  avg_score_pct: number | null
  median_score_pct: number | null
  best_score_pct: number | null
  avg_raw_score: number | null
}

const EMPTY_SCORE_SUMMARY: KpmScoreSummary = {
  total_scores: 0, scores_verified: 0, scores_coach_approved: 0,
  scores_pending: 0, scores_rejected: 0,
  avg_raw_score: null, median_raw_score: null,
  avg_score_pct: null, median_score_pct: null,
  highest_score_pct: null, lowest_score_pct: null,
  personal_best_raw: null, personal_best_pct: null,
  avg_first_score_pct: null, avg_latest_score_pct: null, avg_improvement_pp: null,
  archers_improving: 0, archers_declining: 0,
}

/** Normalised score distribution + funnel counts + average archer improvement. */
export async function getKpmScoreSummary(f: ReportFilters = {}): Promise<KpmScoreSummary> {
  const { data, error } = await supabase.rpc('kpm_score_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as KpmScoreSummary | undefined
  return row ?? EMPTY_SCORE_SUMMARY
}

// ─── RAW NORMALISED SCORE LIST (for funnel drill-downs) ──────────────────────
// One row per score submission (RLS-scoped, all statuses), matching the same
// filters as the summary. Used to "pinpoint" the actual submissions behind a
// verification-funnel count (Submitted / Verified / Pending / Rejected).

export interface KpmNormalisedScore {
  score_id: string
  archer_id: string
  archer_name: string | null
  archer_code: string | null
  state: string | null
  pld: string | null
  school: string | null
  coach_name: string | null
  round_name: string | null
  round_category: string | null
  distance_m: number | null
  status: string
  total_score: number | null
  eff_max_score: number | null
  score_pct: number | null
  date: string | null
}

/** All matching score submissions (every status), newest first. */
export async function getKpmScoresList(f: ReportFilters = {}): Promise<KpmNormalisedScore[]> {
  const { data, error } = await supabase.rpc('kpm_score_normalised_scores', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  const rows = (data ?? []) as KpmNormalisedScore[]
  return rows.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

/** Per-archer improvement list (earliest vs latest score %). */
export async function getKpmScoreImprovement(f: ReportFilters = {}): Promise<KpmScoreImprovementRow[]> {
  const { data, error } = await supabase.rpc('kpm_score_improvement', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmScoreImprovementRow[]
}

/** Improvement grouped by any dimension (computed at archer × group grain). */
export async function getKpmScoreImprovementBreakdown(
  groupBy: KpmScoreGroupBy,
  f: ReportFilters = {},
): Promise<KpmScoreImprovementBreakdownRow[]> {
  const { data, error } = await supabase.rpc('kpm_score_improvement_breakdown', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmScoreImprovementBreakdownRow[]
}

/** Normalised average score-% trend by bucket (default month). Distinct from
 *  getKpmTrend, which is the submitted-vs-validated funnel trend. */
export async function getKpmScoreTrend(
  f: ReportFilters = {},
  bucket: KpmTrendBucket = 'month',
): Promise<KpmScoreTrendPoint[]> {
  const { data, error } = await supabase.rpc('kpm_score_trend_normalised', {
    p_filters: toKpmFilterPayload(f),
    p_bucket: bucket,
  })
  if (error) throw error
  return (data ?? []) as KpmScoreTrendPoint[]
}

/** Practice vs tournament vs selection performance comparison. */
export async function getKpmPracticeTournamentComparison(
  f: ReportFilters = {},
): Promise<KpmPracticeTournamentRow[]> {
  const { data, error } = await supabase.rpc('kpm_practice_tournament_comparison', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmPracticeTournamentRow[]
}

// ─── TALENT PIPELINE (migration 066) ─────────────────────────────────────────
// ⚠️ Development bands are INTERNAL (Beginner / Developing / Intermediate /
// Advanced / Talent Pool) — NOT official KPM classification. Always label them
// as "development bands" in the UI. Reuses kpm_score_normalised_scores.

export const KPM_DEV_BANDS = ['Beginner', 'Developing', 'Intermediate', 'Advanced', 'Talent Pool'] as const
export type KpmDevBand = (typeof KPM_DEV_BANDS)[number]

/** All possible talent reason labels (a candidate has >= 1). */
export const KPM_TALENT_REASONS = [
  'Top Performer', 'Fast Improver', 'Consistent Archer',
  'Tournament Ready', 'Hidden Talent', 'Band Promotion', 'Achievement Milestone',
] as const
export type KpmTalentReason = (typeof KPM_TALENT_REASONS)[number]

export interface KpmTalentCandidate {
  archer_id: string
  archer_name: string | null
  archer_code: string | null
  state_id: string | null
  state: string | null
  pld_id: string | null
  pld: string | null
  school_id: string | null
  school: string | null
  coach_id: string | null
  coach_name: string | null
  age_group: string | null
  gender: string | null
  bow_category: string | null
  best_pct: number | null
  latest_pct: number | null
  avg_pct: number | null
  median_pct: number | null
  improvement_pp: number | null
  consistency_score: number | null
  score_count: number
  tournament_count: number
  best_tournament_pct: number | null
  current_band: string | null
  previous_band: string | null
  band_movement: string | null
  last_activity: string | null
  talent_reasons: string[]
}

export interface KpmTalentSummary {
  total_candidates: number
  top_performers: number
  fast_improvers: number
  consistent_archers: number
  tournament_ready: number
  hidden_talent: number
  band_promotions: number
  achievement_milestones: number
  band_beginner: number
  band_developing: number
  band_intermediate: number
  band_advanced: number
  band_talent_pool: number
  avg_best_pct: number | null
  scored_archers: number
}

export interface KpmTalentPipelineRow {
  band: string
  band_order: number
  archers: number
  pct_of_total: number | null
  avg_best_pct: number | null
}

export type KpmTalentGroupBy =
  | 'state' | 'pld' | 'school' | 'coach' | 'age_group' | 'gender' | 'bow_category'

export interface KpmTalentBreakdownRow {
  group_key: string | null
  group_label: string | null
  scored_archers: number
  candidates: number
  top_performers: number
  tournament_ready: number
  talent_pool: number
  avg_best_pct: number | null
}

const EMPTY_TALENT_SUMMARY: KpmTalentSummary = {
  total_candidates: 0, top_performers: 0, fast_improvers: 0, consistent_archers: 0,
  tournament_ready: 0, hidden_talent: 0, band_promotions: 0, achievement_milestones: 0,
  band_beginner: 0, band_developing: 0, band_intermediate: 0, band_advanced: 0, band_talent_pool: 0,
  avg_best_pct: null, scored_archers: 0,
}

/** Talent counts by reason + development-band distribution. */
export async function getKpmTalentSummary(f: ReportFilters = {}): Promise<KpmTalentSummary> {
  const { data, error } = await supabase.rpc('kpm_talent_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as KpmTalentSummary | undefined
  return row ?? EMPTY_TALENT_SUMMARY
}

/** Full talent candidate list (archers with >= 1 talent reason). */
export async function getKpmTalentCandidates(f: ReportFilters = {}): Promise<KpmTalentCandidate[]> {
  const { data, error } = await supabase.rpc('kpm_talent_candidates', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmTalentCandidate[]
}

/** Development-band funnel (archers per band, based on best score %). */
export async function getKpmTalentPipeline(f: ReportFilters = {}): Promise<KpmTalentPipelineRow[]> {
  const { data, error } = await supabase.rpc('kpm_talent_pipeline', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmTalentPipelineRow[]
}

/** Talent counts grouped by any supported dimension. */
export async function getKpmTalentBreakdown(
  groupBy: KpmTalentGroupBy,
  f: ReportFilters = {},
): Promise<KpmTalentBreakdownRow[]> {
  const { data, error } = await supabase.rpc('kpm_talent_breakdown', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmTalentBreakdownRow[]
}

/** Tournament-ready candidate list, strongest tournament % first. */
export async function getKpmTournamentReadyCandidates(f: ReportFilters = {}): Promise<KpmTalentCandidate[]> {
  const { data, error } = await supabase.rpc('kpm_tournament_ready_candidates', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmTalentCandidate[]
}

// ─── TALENT RATING CONFIG (migration 071) ────────────────────────────────────
// Tunable thresholds behind the talent titles. Read by every talent report via
// kpm_talent_scored; edited only by super_admin (RLS-enforced). One row (id=1).

/** The tunable thresholds. Percentages are 0-100; counts are whole numbers. */
export interface KpmTalentConfig {
  top_performer_min_pct: number
  fast_improver_min_pp: number
  fast_improver_min_scores: number
  consistent_min_scores: number
  consistent_min_consistency: number
  consistent_min_avg_pct: number
  tournament_ready_min_count: number
  tournament_ready_min_pct: number
  hidden_talent_min_pct: number
  achievement_min_count: number
}

/** The default (migration 066) thresholds — used as a fallback and for "reset". */
export const KPM_TALENT_CONFIG_DEFAULTS: KpmTalentConfig = {
  top_performer_min_pct: 85,
  fast_improver_min_pp: 5,
  fast_improver_min_scores: 2,
  consistent_min_scores: 3,
  consistent_min_consistency: 90,
  consistent_min_avg_pct: 65,
  tournament_ready_min_count: 1,
  tournament_ready_min_pct: 75,
  hidden_talent_min_pct: 75,
  achievement_min_count: 1,
}

const TALENT_CONFIG_KEYS = Object.keys(KPM_TALENT_CONFIG_DEFAULTS) as (keyof KpmTalentConfig)[]

/** Reads the single talent-config row (any approved user may read). */
export async function getKpmTalentConfig(): Promise<KpmTalentConfig> {
  const { data, error } = await supabase
    .from('kpm_talent_config')
    .select(TALENT_CONFIG_KEYS.join(','))
    .eq('id', 1)
    .single()
  if (error) throw error
  // Coerce numeric strings (postgres numeric → string over the wire) to numbers.
  const row = (data ?? {}) as unknown as Record<string, unknown>
  const out = { ...KPM_TALENT_CONFIG_DEFAULTS }
  for (const k of TALENT_CONFIG_KEYS) {
    const v = Number(row[k])
    if (Number.isFinite(v)) out[k] = v
  }
  return out
}

/** Updates the talent-config row (super_admin only — enforced by RLS). */
export async function updateKpmTalentConfig(values: KpmTalentConfig): Promise<void> {
  const { error } = await supabase
    .from('kpm_talent_config')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', 1)
  if (error) throw error
}

// ─── SCOPE HEALTH (migration 067) ────────────────────────────────────────────
// Per school / PLD / state Green-Yellow-Red health rolled up from participation,
// training, scores, retention, coach coverage and talent. ⚠️ Health thresholds
// are INTERNAL conservative defaults (see migration header) — NOT KPM standards.

export type KpmHealthGroupBy = 'state' | 'pld' | 'school'
export type KpmHealthStatus = 'Green' | 'Yellow' | 'Red'

export interface KpmScopeHealth {
  scope_type: string
  unit_id: string
  unit_name: string | null
  parent_state: string | null
  parent_pld: string | null
  // participation
  registered_archers: number
  active_archers: number
  new_archers: number
  returning_archers: number
  inactive_archers: number
  active_ratio: number | null
  // training
  training_sessions: number
  total_arrows: number
  avg_arrows_per_session: number | null
  active_training_archers: number
  active_training_coaches: number
  last_training_date: string | null
  // score
  scores_submitted: number
  verified_scores: number
  pending_scores: number
  rejected_scores: number
  avg_score_pct: number | null
  median_score_pct: number | null
  avg_improvement_pp: number | null
  last_score_date: string | null
  // retention
  retention_rate: number | null
  dropout_rate: number | null
  inactive_30: number
  inactive_60: number
  inactive_90: number
  inactive_180: number
  inactive_365: number
  // coach
  total_coaches: number
  active_coaches: number
  certified_coaches: number
  uncertified_coaches: number
  coach_to_active_archer_ratio: number | null
  certs_expired: number
  certs_expiring_90: number
  schools_without_active_coach: number
  // talent
  talent_candidates: number
  tournament_ready: number
  fast_improvers: number
  talent_pool: number
  // health
  last_activity_date: string | null
  health_status: KpmHealthStatus
  health_score: number | null
  health_reasons: string[]
  needs_attention: boolean
}

export interface KpmNationalHealthRow {
  scope_type: string
  total_units: number
  green: number
  yellow: number
  red: number
  needs_attention: number
  avg_health_score: number | null
}

/** Per-unit health for a scope level (state | pld | school), worst-first. */
export async function getKpmScopeHealth(
  groupBy: KpmHealthGroupBy,
  f: ReportFilters = {},
): Promise<KpmScopeHealth[]> {
  const { data, error } = await supabase.rpc('kpm_scope_health', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmScopeHealth[]
}

/** School-level health (thin wrapper over getKpmScopeHealth). */
export function getKpmSchoolHealth(f: ReportFilters = {}): Promise<KpmScopeHealth[]> {
  return getKpmScopeHealth('school', f)
}

/** PLD-level health (thin wrapper over getKpmScopeHealth). */
export function getKpmPldHealth(f: ReportFilters = {}): Promise<KpmScopeHealth[]> {
  return getKpmScopeHealth('pld', f)
}

/** State-level health (thin wrapper over getKpmScopeHealth). */
export function getKpmStateHealth(f: ReportFilters = {}): Promise<KpmScopeHealth[]> {
  return getKpmScopeHealth('state', f)
}

/** Unit counts by Green/Yellow/Red per scope level. */
export async function getKpmNationalHealthSummary(f: ReportFilters = {}): Promise<KpmNationalHealthRow[]> {
  const { data, error } = await supabase.rpc('kpm_national_health_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmNationalHealthRow[]
}

// ─── DATA QUALITY (migration 068) ────────────────────────────────────────────
// Trustworthiness of the data behind the reports: missing fields, invalid
// scores, incomplete setups. Severity: critical / warning / info (INTERNAL).

export type KpmDqSeverity = 'critical' | 'warning' | 'info'
export type KpmDqCategory = 'profile' | 'score' | 'training' | 'coach' | 'organisation' | 'equipment'

export interface KpmDataQualityIssue {
  entity_type: string
  entity_id: string
  entity_label: string | null
  category: KpmDqCategory
  issue_type: string
  issue_message: string
  severity: KpmDqSeverity
  state_id: string | null
  pld_id: string | null
  school_id: string | null
  state: string | null
  pld: string | null
  school: string | null
}

export interface KpmDataQualitySummary {
  overall_completeness_pct: number | null
  profile_completeness_pct: number | null
  score_quality_pct: number | null
  training_quality_pct: number | null
  coach_quality_pct: number | null
  org_quality_pct: number | null
  /** Reliable for admin2/super_admin only (admin1 lacks equipment read access). */
  equipment_completeness_pct: number | null
  total_issues: number
  critical_issues: number
  warning_issues: number
  info_issues: number
}

export type KpmDqBreakdownBy = 'issue_type' | 'severity' | 'category'
export type KpmDqScopeBy = 'state' | 'pld' | 'school'

export interface KpmDataQualityBreakdownRow {
  group_key: string | null
  total: number
  critical: number
  warning: number
  info: number
}

export interface KpmDataQualityScopeRow {
  group_key: string | null
  group_label: string | null
  total: number
  critical: number
  warning: number
  info: number
}

const EMPTY_DQ_SUMMARY: KpmDataQualitySummary = {
  overall_completeness_pct: null, profile_completeness_pct: null,
  score_quality_pct: null, training_quality_pct: null,
  coach_quality_pct: null, org_quality_pct: null, equipment_completeness_pct: null,
  total_issues: 0, critical_issues: 0, warning_issues: 0, info_issues: 0,
}

/** Completeness percentages + issue counts by severity. */
export async function getKpmDataQualitySummary(f: ReportFilters = {}): Promise<KpmDataQualitySummary> {
  const { data, error } = await supabase.rpc('kpm_data_quality_summary', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as KpmDataQualitySummary | undefined
  return row ?? EMPTY_DQ_SUMMARY
}

/** Full detailed issue list for admins. */
export async function getKpmDataQualityIssues(f: ReportFilters = {}): Promise<KpmDataQualityIssue[]> {
  const { data, error } = await supabase.rpc('kpm_data_quality_issues', {
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmDataQualityIssue[]
}

/** Issue counts grouped by issue_type | severity | category. */
export async function getKpmDataQualityBreakdown(
  groupBy: KpmDqBreakdownBy,
  f: ReportFilters = {},
): Promise<KpmDataQualityBreakdownRow[]> {
  const { data, error } = await supabase.rpc('kpm_data_quality_breakdown', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmDataQualityBreakdownRow[]
}

/** Issue counts grouped by state | pld | school. */
export async function getKpmDataQualityByScope(
  groupBy: KpmDqScopeBy,
  f: ReportFilters = {},
): Promise<KpmDataQualityScopeRow[]> {
  const { data, error } = await supabase.rpc('kpm_data_quality_by_scope', {
    p_group_by: groupBy,
    p_filters: toKpmFilterPayload(f),
  })
  if (error) throw error
  return (data ?? []) as KpmDataQualityScopeRow[]
}

/**
 * Reports / Analytics service — read-only, role-scope-aware.
 *
 * Correctness rules (see prompt + migration 025):
 *   • Score-based metrics count ONLY validated scores (status = 'admin_approved')
 *     by default. Pending / coach_approved / rejected / withdrawn never inflate
 *     performance numbers.
 *   • Admin 2 / Super Admin → national. Admin 1 → assigned scope only (pass an
 *     AdminScope; we translate it into state/pld/school filters). Coach → linked
 *     archers only. Archer → own data only.
 *
 * Breakdowns + talents + summary aggregates come from the security_invoker
 * views in migration 025 (efficient, RLS-respecting). Date-ranged trends,
 * pending counts and this-month achievements are computed against the base
 * score table because the views are all-time snapshots.
 */
import { supabase } from './supabase'
import { subDays, startOfMonth } from 'date-fns'
import type { AdminScope } from '@/lib/scope'

// ─── FILTERS ───────────────────────────────────────────────────────────────

export type DatePreset = '1d' | '1w' | '1m' | '3m' | '6m' | '1y' | '3y' | '5y' | 'all'

export interface ReportFilters {
  preset?: DatePreset
  startDate?: string
  endDate?: string
  stateId?: string
  pldId?: string
  schoolId?: string
  ageGroup?: string         // legacy talents list: u14/u18/u21/open — KPM RPCs: U12/U15/U18/Open
  bowCategory?: string
  roundType?: string        // kept for back-compat; prefer roundCategory below
  coachId?: string
  archerId?: string
  // ── KPM Development Metrics dimensions (migration 061). All optional and
  //    consumed by src/services/kpmMetrics.ts; existing report calls ignore them. ──
  roundId?: string
  roundCategory?: 'training' | 'practice' | 'tournament' | 'selection'
  distanceM?: number
  scoreStatus?: 'pending' | 'coach_approved' | 'admin_approved' | 'rejected'
  /** Soft filter (default true in the RPCs): performance metrics count admin_approved only. */
  verifiedOnly?: boolean
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say'
  /** Training-activity dimension (migration 062): scoring.training_logs.session_type. */
  sessionType?: 'indoor' | 'outdoor' | 'field' | '3d' | 'virtual'
  // ── Coach coverage dimensions (migration 063) ──
  /** Derived per-coach coverage status (certifications table is source of truth). */
  certificationStatus?: 'certified' | 'expiring' | 'expired' | 'uncertified'
  /** Matches certification.certificate_level (else coach_profiles.certification_level). */
  certificationLevel?: string
}

const PRESET_DAYS: Record<Exclude<DatePreset, 'all'>, number> = {
  '1d': 1, '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365, '3y': 1095, '5y': 1825,
}

/** Resolve a filter window to ISO start/end (null start = all-time). */
export function resolveRange(f: ReportFilters): { startISO: string | null; endISO: string } {
  const endISO = f.endDate ?? new Date().toISOString()
  if (f.startDate) return { startISO: f.startDate, endISO }
  const preset = f.preset ?? '3m'
  if (preset === 'all') return { startISO: null, endISO }
  return { startISO: subDays(new Date(), PRESET_DAYS[preset]).toISOString(), endISO }
}

const AGGREGATE_FILTER_KEYS = [
  'stateId', 'pldId', 'schoolId', 'coachId', 'archerId',
  'ageGroup', 'bowCategory', 'gender', 'roundId', 'roundCategory', 'scoreStatus',
] as const

/** Serialize shared filters for the RLS-respecting report RPCs. */
function toAggregateFilterPayload(f: ReportFilters): Record<string, unknown> {
  const { startISO, endISO } = resolveRange(f)
  const payload: Record<string, unknown> = { endDate: endISO.slice(0, 10) }
  if (startISO) payload.startDate = startISO.slice(0, 10)

  for (const key of AGGREGATE_FILTER_KEYS) {
    const value = f[key]
    if (value != null && value !== '') payload[key] = value
  }
  if (f.distanceM != null) payload.distanceM = f.distanceM
  if (f.verifiedOnly != null) payload.verifiedOnly = f.verifiedOnly
  return payload
}

/** Merge an Admin 1 scope into report filters (scope wins; default-deny on none). */
export function scopeToFilters(scope: AdminScope, base: ReportFilters = {}): ReportFilters {
  switch (scope.type) {
    case 'national': return { ...base }
    case 'state':    return { ...base, stateId: scope.stateId }
    case 'pld':      return { ...base, pldId: scope.pldId }
    case 'school':   return { ...base, schoolId: scope.schoolId }
    case 'none':     return { ...base, schoolId: '__none__' } // matches nothing
  }
}

// ─── TYPES ─────────────────────────────────────────────────────────────────

export interface ReportSummary {
  registeredArchers: number
  activeArchers: number
  coaches: number
  schoolsTotal: number
  schoolsReporting: number
  scoresSubmitted: number
  approvedScores: number
  pendingValidation: number
  topScore: number
  achievementsThisMonth: number
}

export interface TrendPoint {
  date: string
  submitted: number
  approved: number
}

export interface StateBreakdownRow {
  state_id: string
  state: string
  state_code: string
  registered_archers: number
  active_archers: number
  coaches: number
  schools_total: number
  schools_reporting: number
  scores_submitted: number
  approved_scores: number
  avg_score: number
  top_score: number
}

export interface PLDBreakdownRow {
  pld_id: string
  pld: string
  state_id: string
  state: string
  registered_archers: number
  active_archers: number
  coaches: number
  schools_total: number
  schools_reporting: number
  scores_submitted: number
  approved_scores: number
  top_score: number
}

export interface SchoolBreakdownRow {
  school_id: string
  school: string
  pld: string | null
  state: string
  state_code: string
  active: boolean
  registered_archers: number
  active_archers: number
  coaches: number
  scores_submitted: number
  approved_scores: number
  last_activity: string | null
}

export interface TalentRow {
  archer_id: string
  name: string
  archer_code: string | null
  age: number | null
  bow_category: string | null
  state: string | null
  pld: string | null
  school: string | null
  approved_count: number
  best_score: number
  avg_score: number
  last_score_date: string | null
  improvement: number   // best − avg (lightweight proxy)
}

export interface ValidationSummary {
  pendingTraining: number
  pendingTournament: number
  approved: number
  rejected: number
}

// ─── INTERNAL ──────────────────────────────────────────────────────────────

/** Archer profile ids inside the filter scope, or null when unscoped (= all).
 *  Gender is an additive demographic narrow: passing it alone still scopes (the
 *  legacy org-only callers never set it, so their behaviour is unchanged). */
async function scopedArcherIds(f: ReportFilters): Promise<string[] | null> {
  if (!f.stateId && !f.pldId && !f.schoolId && !f.gender) return null
  let q = supabase.from('profiles').select('id').eq('role', 'archer')
  if (f.schoolId) q = q.eq('school_id', f.schoolId)
  else if (f.pldId) q = q.eq('pld_id', f.pldId)
  else if (f.stateId) q = q.eq('state_id', f.stateId)
  if (f.gender) q = q.eq('gender', f.gender)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map((r) => r.id as string)
}

function ageInGroup(age: number | null, group?: string): boolean {
  if (!group) return true
  if (age == null) return false
  switch (group) {
    case 'u14':  return age <= 14
    case 'u18':  return age >= 15 && age <= 18
    case 'u21':  return age >= 19 && age <= 21
    case 'open': return age >= 22
    default:     return true
  }
}

// ─── BREAKDOWNS (from views) ─────────────────────────────────────────────────

export async function getStateBreakdown(f: ReportFilters = {}): Promise<StateBreakdownRow[]> {
  let q = supabase.from('report_state_activity').select('*')
  if (f.stateId) q = q.eq('state_id', f.stateId)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as StateBreakdownRow[]).sort((a, b) => b.approved_scores - a.approved_scores)
}

export async function getPLDBreakdown(f: ReportFilters = {}): Promise<PLDBreakdownRow[]> {
  let q = supabase.from('report_pld_activity').select('*')
  if (f.pldId)        q = q.eq('pld_id', f.pldId)
  else if (f.stateId) q = q.eq('state_id', f.stateId)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as PLDBreakdownRow[]).sort((a, b) => b.approved_scores - a.approved_scores)
}

export async function getSchoolBreakdown(f: ReportFilters = {}): Promise<SchoolBreakdownRow[]> {
  let q = supabase.from('report_school_activity').select('*')
  if (f.schoolId)     q = q.eq('school_id', f.schoolId)
  else if (f.pldId)   q = q.eq('pld_id', f.pldId)
  else if (f.stateId) q = q.eq('state_id', f.stateId)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as SchoolBreakdownRow[]).sort(
    (a, b) => b.scores_submitted - a.scores_submitted,
  )
}

// ─── EMERGING TALENTS ─────────────────────────────────────────────────────────

export async function getEmergingTalents(f: ReportFilters = {}, limit = 12): Promise<TalentRow[]> {
  let q = supabase.from('report_emerging_talents').select('*')
  if (f.schoolId)     q = q.eq('school_id', f.schoolId)
  else if (f.pldId)   q = q.eq('pld_id', f.pldId)
  else if (f.stateId) q = q.eq('state_id', f.stateId)
  if (f.bowCategory)  q = q.eq('bow_category', f.bowCategory)
  const { data, error } = await q
  if (error) throw error

  return ((data ?? []) as Omit<TalentRow, 'improvement'>[])
    .filter((r) => ageInGroup(r.age, f.ageGroup))
    .map((r) => ({ ...r, improvement: Math.max(0, r.best_score - r.avg_score) }))
    .sort((a, b) => b.best_score - a.best_score)
    .slice(0, limit)
}

// ─── SUMMARY ──────────────────────────────────────────────────────────────────

/** Pull the all-time aggregate slice for the active scope from the views. */
async function summaryAggregate(f: ReportFilters) {
  if (f.schoolId) {
    const rows = await getSchoolBreakdown(f)
    const r = rows[0]
    return {
      registeredArchers: r?.registered_archers ?? 0,
      activeArchers:     r?.active_archers ?? 0,
      coaches:           r?.coaches ?? 0,
      schoolsTotal:      r ? 1 : 0,
      schoolsReporting:  (r?.approved_scores ?? 0) > 0 ? 1 : 0,
      scoresSubmitted:   r?.scores_submitted ?? 0,
      approvedScores:    r?.approved_scores ?? 0,
      topScore:          0,
    }
  }
  if (f.pldId) {
    const r = (await getPLDBreakdown(f))[0]
    return {
      registeredArchers: r?.registered_archers ?? 0,
      activeArchers:     r?.active_archers ?? 0,
      coaches:           r?.coaches ?? 0,
      schoolsTotal:      r?.schools_total ?? 0,
      schoolsReporting:  r?.schools_reporting ?? 0,
      scoresSubmitted:   r?.scores_submitted ?? 0,
      approvedScores:    r?.approved_scores ?? 0,
      topScore:          r?.top_score ?? 0,
    }
  }
  // state scope OR national (sum all states)
  const rows = await getStateBreakdown(f)
  return rows.reduce(
    (acc, r) => ({
      registeredArchers: acc.registeredArchers + r.registered_archers,
      activeArchers:     acc.activeArchers + r.active_archers,
      coaches:           acc.coaches + r.coaches,
      schoolsTotal:      acc.schoolsTotal + r.schools_total,
      schoolsReporting:  acc.schoolsReporting + r.schools_reporting,
      scoresSubmitted:   acc.scoresSubmitted + r.scores_submitted,
      approvedScores:    acc.approvedScores + r.approved_scores,
      topScore:          Math.max(acc.topScore, r.top_score),
    }),
    { registeredArchers: 0, activeArchers: 0, coaches: 0, schoolsTotal: 0, schoolsReporting: 0, scoresSubmitted: 0, approvedScores: 0, topScore: 0 },
  )
}

async function pendingValidationCount(f: ReportFilters): Promise<number> {
  const ids = await scopedArcherIds(f)
  let q = supabase
    .from('score_submissions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'coach_approved'])
  if (ids) {
    if (ids.length === 0) return 0
    q = q.in('archer_id', ids)
  }
  const { count, error } = await q
  if (error) throw error
  return count ?? 0
}

async function achievementsThisMonth(f: ReportFilters): Promise<number> {
  const monthStart = startOfMonth(new Date()).toISOString()
  const ids = await scopedArcherIds(f)
  let q = supabase
    .from('user_achievements')
    .select('id', { count: 'exact', head: true })
    .gte('earned_at', monthStart)
  if (ids) {
    if (ids.length === 0) return 0
    q = q.in('profile_id', ids)
  }
  const { count, error } = await q
  if (error) return 0   // achievements module optional — never break reports
  return count ?? 0
}

export async function getReportSummary(f: ReportFilters = {}): Promise<ReportSummary> {
  const [agg, pendingValidation, achievementsMonth] = await Promise.all([
    summaryAggregate(f),
    pendingValidationCount(f),
    achievementsThisMonth(f),
  ])
  return { ...agg, pendingValidation, achievementsThisMonth: achievementsMonth }
}

/** Admin 2 / Super Admin national summary. */
export function getAdmin2ReportSummary(f: ReportFilters = {}): Promise<ReportSummary> {
  return getReportSummary(f)
}

/** Admin 1 scoped summary — scope is enforced into the filters first. */
export function getAdmin1ReportSummary(scope: AdminScope, f: ReportFilters = {}): Promise<ReportSummary> {
  return getReportSummary(scopeToFilters(scope, f))
}

// ─── TRENDS ───────────────────────────────────────────────────────────────────

/** Daily submitted vs approved counts over the filter window. */
export async function getScoreTrend(f: ReportFilters = {}): Promise<TrendPoint[]> {
  const { data, error } = await supabase.rpc('kpm_score_trend', {
    p_filters: toAggregateFilterPayload(f),
    p_bucket: 'day',
  })
  if (error) throw error

  return ((data ?? []) as {
    bucket: string
    submitted: number
    admin_approved: number
  }[]).map((row) => ({
    date: row.bucket,
    submitted: Number(row.submitted),
    approved: Number(row.admin_approved),
  }))
}

/** Alias kept for the spec surface — activity trend is the score trend. */
export const getActivityTrend = getScoreTrend

// ─── VALIDATION SUMMARY ──────────────────────────────────────────────────────

export async function getValidationSummary(f: ReportFilters = {}): Promise<ValidationSummary> {
  const { data, error } = await supabase.rpc('report_validation_summary', {
    p_filters: toAggregateFilterPayload(f),
  })
  if (error) throw error

  const row = (Array.isArray(data) ? data[0] : data) as {
    pending_training?: number | string
    pending_tournament?: number | string
    approved?: number | string
    rejected?: number | string
  } | null

  return {
    pendingTraining: Number(row?.pending_training ?? 0),
    pendingTournament: Number(row?.pending_tournament ?? 0),
    approved: Number(row?.approved ?? 0),
    rejected: Number(row?.rejected ?? 0),
  }
}

// ─── COACH REPORT (linked archers only) ──────────────────────────────────────

export interface CoachReportArcher {
  archer_id: string
  name: string
  archer_code: string | null
  approved_count: number
  best_score: number
  last_score_date: string | null
}

export interface CoachReport {
  linkedTotal: number
  linkedActive: number
  pendingReview: number
  approvedScores: number
  archers: CoachReportArcher[]
}

export async function getCoachReportSummary(coachId: string): Promise<CoachReport> {
  const { data: links, error: lerr } = await supabase
    .from('coach_archer_links')
    .select('archer_id, status, archer:archer_id(name, archer_id)')
    .eq('coach_id', coachId)
  if (lerr) throw lerr

  const rows = (links ?? []) as unknown as {
    archer_id: string; status: string; archer: { name: string; archer_id: string | null } | null
  }[]
  const archerIds = rows.map((r) => r.archer_id)

  let scores: { archer_id: string; status: string; total_score: number; date: string }[] = []
  if (archerIds.length) {
    const { data, error } = await supabase
      .from('score_submissions')
      .select('archer_id, status, total_score, date')
      .in('archer_id', archerIds)
    if (error) throw error
    scores = (data ?? []) as typeof scores
  }

  const archers: CoachReportArcher[] = rows.map((r) => {
    const own = scores.filter((s) => s.archer_id === r.archer_id && s.status === 'admin_approved')
    const dates = own.map((s) => s.date).sort()
    return {
      archer_id: r.archer_id,
      name: r.archer?.name ?? 'Unknown',
      archer_code: r.archer?.archer_id ?? null,
      approved_count: own.length,
      best_score: own.reduce((m, s) => Math.max(m, s.total_score), 0),
      last_score_date: dates.length ? dates[dates.length - 1] : null,
    }
  }).sort((a, b) => b.best_score - a.best_score)

  return {
    linkedTotal:   rows.length,
    linkedActive:  rows.filter((r) => r.status === 'active').length,
    pendingReview: scores.filter((s) => s.status === 'pending' || s.status === 'coach_approved').length,
    approvedScores: scores.filter((s) => s.status === 'admin_approved').length,
    archers,
  }
}

// ─── ARCHER PROGRESS (own data only) ──────────────────────────────────────────

export interface ArcherProgress {
  totalScores: number
  approvedScores: number
  pendingScores: number
  bestScore: number
  bestMax: number
  latestApproved: { total_score: number; max_score: number; date: string } | null
  trend: { date: string; score: number; maxScore: number }[]
}

export async function getArcherProgressSummary(profileId: string, f: ReportFilters = {}): Promise<ArcherProgress> {
  const { startISO, endISO } = resolveRange(f)
  let q = supabase
    .from('score_submissions')
    .select('total_score, max_score, status, date')
    .eq('archer_id', profileId)
    .lte('date', endISO.slice(0, 10))
    .order('date', { ascending: true })
  if (startISO) q = q.gte('date', startISO.slice(0, 10))

  const { data, error } = await q
  if (error) throw error
  const rows = (data ?? []) as { total_score: number; max_score: number; status: string; date: string }[]
  const approved = rows.filter((r) => r.status === 'admin_approved')
  const best = approved.reduce<typeof approved[number] | null>(
    (b, r) => (!b || r.total_score / r.max_score > b.total_score / b.max_score ? r : b), null,
  )

  return {
    totalScores:    rows.length,
    approvedScores: approved.length,
    pendingScores:  rows.filter((r) => r.status === 'pending' || r.status === 'coach_approved').length,
    bestScore:      best?.total_score ?? 0,
    bestMax:        best?.max_score ?? 0,
    latestApproved: approved.length ? approved[approved.length - 1] : null,
    trend:          approved.slice(-20).map((r) => ({ date: r.date, score: r.total_score, maxScore: r.max_score })),
  }
}

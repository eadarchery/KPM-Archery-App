import { supabase } from './supabase'
import type { LeaderboardEntry } from '@/types'

/**
 * Leaderboard reads. Backed by the public.leaderboard view (migration 059),
 * which restricts to admin-approved scores of approved archers — so pending /
 * rejected / withdrawn / coach-only scores can never appear here.
 *
 * One row per archer per (bow category × round category × distance): the
 * archer's best approved score in that combination. Age group is computed LIVE
 * from birth_year against the current year (U12 / U15 / U18 / Open), so groups
 * roll over automatically on 1 January. Ranks come from the view's window
 * functions, always partitioned within an age group.
 */

/** Raw shape of a public.leaderboard row (migration 059). */
export interface LeaderboardViewRow {
  archer_id: string
  round_id: string | null
  name: string
  archer_code: string | null
  age: number | null
  state_id: string | null
  school_id: string | null
  pld_id: string | null
  state: string | null
  state_code: string | null
  school: string | null
  pld: string | null
  bow_category: string | null
  gender: string | null
  round_name: string | null
  round_category: string | null
  distance_m: number | null
  birth_year: number | null
  competition_year: number | null
  competition_age: number | null
  age_group: string | null
  best_score: number
  max_score: number
  date: string
  state_rank: number
  national_rank: number
}

export interface LeaderboardFilters {
  scope?: 'state' | 'national'
  stateId?: string
  schoolId?: string
  bowCategory?: string
  /** Archer gender division: male | female. */
  gender?: string
  /** Round type: training | practice | tournament | selection. */
  roundCategory?: string
  /** Distance in metres (exact match against the round). */
  distanceM?: number
  /** Calendar-year age group: U12 | U15 | U18 | Open. */
  ageGroup?: string
  limit?: number
}

export interface LeaderboardCursor {
  score: number
  date: string
  key: string
}

export interface LeaderboardPage {
  items: LeaderboardEntry[]
  nextCursor: LeaderboardCursor | null
  hasMore: boolean
}

interface LeaderboardPageRow extends LeaderboardViewRow {
  row_key: string
}

function mapEntry(r: LeaderboardViewRow, scope: 'state' | 'national'): LeaderboardEntry {
  return {
    rank:           scope === 'state' ? r.state_rank : r.national_rank,
    archer_id:      r.archer_id,
    name:           r.name,
    age:            r.age ?? undefined,
    school:         r.school ?? '—',
    state:          r.state ?? '—',
    pld:            r.pld ?? '—',
    bow_category:   r.bow_category ?? '—',
    round_name:     r.round_name ?? '—',
    round_category: r.round_category,
    distance_m:     r.distance_m,
    age_group:      r.age_group,
    competition_age: r.competition_age,
    best_score:     r.best_score,
    max_score:      r.max_score,
    date:           r.date,
  }
}

/**
 * Unified leaderboard query. All filters are applied SERVER-SIDE against the
 * view's columns; ranks come straight from its window functions. Rows are
 * ordered by score so the board always reads high→low; the rank column shows
 * the archer's standing within their (bow × category × distance × age group).
 */
export async function getLeaderboardScores(
  filters: LeaderboardFilters = {},
): Promise<LeaderboardEntry[]> {
  return (await getLeaderboardScoresPage(filters)).items
}

/** Cursor-paginated leaderboard backed by migration 084's read model. */
export async function getLeaderboardScoresPage(
  filters: LeaderboardFilters = {},
  cursor: LeaderboardCursor | null = null,
): Promise<LeaderboardPage> {
  const {
    scope = 'national', stateId, schoolId, bowCategory, gender,
    roundCategory, distanceM, ageGroup, limit = 50,
  } = filters
  const pageSize = Math.min(Math.max(limit, 1), 100)
  const { data, error } = await supabase.rpc('leaderboard_page', {
    p_scope: scope,
    p_state_id: stateId ?? null,
    p_school_id: schoolId ?? null,
    p_bow_category: bowCategory ?? null,
    p_gender: gender ?? null,
    p_round_category: roundCategory ?? null,
    p_distance_m: distanceM ?? null,
    p_age_group: ageGroup ?? null,
    p_after_score: cursor?.score ?? null,
    p_after_date: cursor?.date ?? null,
    p_after_key: cursor?.key ?? null,
    p_limit: pageSize,
  })
  if (error) throw error

  const fetched = (data ?? []) as unknown as LeaderboardPageRow[]
  const hasMore = fetched.length > pageSize
  const visible = hasMore ? fetched.slice(0, pageSize) : fetched
  const last = visible[visible.length - 1]

  return {
    items: visible.map((r) => mapEntry({
      ...r,
      state_rank: Number(r.state_rank),
      national_rank: Number(r.national_rank),
    }, scope)),
    hasMore,
    nextCursor: hasMore && last
      ? { score: Number(last.best_score), date: last.date, key: last.row_key }
      : null,
  }
}

/**
 * Distinct filter options (round categories + distances) available in a scope,
 * so the leaderboard page can offer only dropdown values that actually exist.
 */
export async function getLeaderboardFacets(
  scope: 'state' | 'national',
  stateId?: string,
): Promise<{ categories: string[]; distances: number[] }> {
  const { data, error } = await supabase.rpc('leaderboard_facets', {
    p_scope: scope,
    p_state_id: stateId ?? null,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as {
    round_categories?: string[]
    distances_m?: number[]
  } | null
  return {
    categories: row?.round_categories ?? [],
    distances: (row?.distances_m ?? []).map(Number),
  }
}

export interface CoachLeaderboardRow {
  coach_id: string
  coach_name: string
  school_name: string | null
  pld_name: string | null
  best_score: number
  best_max: number
  best_pct: number
  sessions: number
  last_date: string
  rank: number
}

export interface CoachLeaderboardCursor {
  percentage: number
  coachId: string
}

export async function getCoachLeaderboardPage(
  cursor: CoachLeaderboardCursor | null = null,
  limit = 50,
): Promise<{ items: CoachLeaderboardRow[]; nextCursor: CoachLeaderboardCursor | null; hasMore: boolean }> {
  const pageSize = Math.min(Math.max(limit, 1), 100)
  const { data, error } = await supabase.rpc('coach_leaderboard_page', {
    p_after_pct: cursor?.percentage ?? null,
    p_after_coach: cursor?.coachId ?? null,
    p_limit: pageSize,
  })
  if (error) throw error

  const fetched = (data ?? []) as unknown as CoachLeaderboardRow[]
  const hasMore = fetched.length > pageSize
  const visible = (hasMore ? fetched.slice(0, pageSize) : fetched).map((row) => ({
    ...row,
    best_score: Number(row.best_score),
    best_max: Number(row.best_max),
    best_pct: Number(row.best_pct),
    sessions: Number(row.sessions),
    rank: Number(row.rank),
  }))
  const last = visible[visible.length - 1]
  return {
    items: visible,
    hasMore,
    nextCursor: hasMore && last
      ? { percentage: last.best_pct, coachId: last.coach_id }
      : null,
  }
}

export async function getStateLeaderboard(
  stateId: string,
  bowCategory?: string,
  limit = 50,
): Promise<LeaderboardEntry[]> {
  return getLeaderboardScores({ scope: 'state', stateId, bowCategory, limit })
}

export async function getNationalLeaderboard(
  bowCategory?: string,
  limit = 100,
): Promise<LeaderboardEntry[]> {
  return getLeaderboardScores({ scope: 'national', bowCategory, limit })
}

/** The archer's own best-score row + rank in their state, if any. */
export async function getMyRank(
  archerId: string,
  stateId: string,
  bowCategory?: string,
): Promise<LeaderboardViewRow | null> {
  let q = supabase
    .from('leaderboard')
    .select('*')
    .eq('archer_id', archerId)
    .eq('state_id', stateId)
    .order('best_score', { ascending: false })
    .limit(1)

  if (bowCategory) q = q.eq('bow_category', bowCategory)

  const { data, error } = await q
  if (error) throw error
  return ((data ?? [])[0] as LeaderboardViewRow) ?? null
}

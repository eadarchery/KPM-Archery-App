import { supabase } from './supabase'
import { compressImage, compressPresets } from '@/lib/imageCompress'
import type { AchievementDef, UserAchievement } from '@/types'

/**
 * Sort client-side instead of ORDER BY display_order — that column only exists
 * after migration 012, and ordering by a missing column fails the whole query
 * (which showed as "N of 0 badges" for archers and an empty admin manager).
 */
function sortDefs(defs: AchievementDef[]): AchievementDef[] {
  return [...defs].sort((a, b) =>
    ((a as { display_order?: number }).display_order ?? 0) - ((b as { display_order?: number }).display_order ?? 0)
    || (a.category ?? '').localeCompare(b.category ?? '')
    || ((a.threshold ?? 0) - (b.threshold ?? 0)),
  )
}

export async function getAchievementDefs(): Promise<AchievementDef[]> {
  const { data, error } = await supabase
    .from('achievement_definitions')
    .select('*')
    .eq('active', true)
  if (error) throw error
  return sortDefs((data ?? []) as AchievementDef[])
}

export async function getAllAchievementDefs(): Promise<AchievementDef[]> {
  const { data, error } = await supabase
    .from('achievement_definitions')
    .select('*')
  if (error) throw error
  return sortDefs((data ?? []) as AchievementDef[])
}

export async function getUserAchievements(profileId: string): Promise<UserAchievement[]> {
  // No embedding — PostgREST embeds fail through the security_invoker views;
  // resolve the definitions separately and stitch client-side.
  const { data, error } = await supabase
    .from('user_achievements')
    .select('*')
    .eq('profile_id', profileId)
    .order('earned_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as UserAchievement[]
  if (!rows.length) return rows
  const ids = [...new Set(rows.map((r) => r.achievement_id))]
  const { data: defs } = await supabase.from('achievement_definitions').select('*').in('id', ids)
  const dmap = new Map(((defs ?? []) as AchievementDef[]).map((d) => [d.id, d]))
  return rows.map((r) => ({ ...r, achievement: dmap.get(r.achievement_id) }))
}

export async function triggerAchievementCheck(profileId: string) {
  const { error } = await supabase.rpc('check_and_grant_achievements', {
    p_profile_id: profileId,
  })
  if (error) console.warn('Achievement check failed:', error.message)
}

export async function createAchievementDef(payload: {
  slug: string
  name: string
  description: string
  category: string
  threshold?: number | null
  max_score?: number | null
  distance_m?: number | null
  round_category?: 'tournament' | 'practice' | null
  icon?: string
  display_order?: number
  active?: boolean
  badge_light_url?: string
  badge_dark_url?: string
}): Promise<AchievementDef> {
  const { data, error } = await supabase
    .from('achievement_definitions')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as AchievementDef
}

export async function updateAchievementDef(id: string, updates: Partial<AchievementDef>) {
  const { data, error } = await supabase
    .from('achievement_definitions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as AchievementDef
}

// ─── SCORE-BADGE QUALIFICATION (client-side mirror of migration 057) ─────────

/** An approved score enriched with its round's distance and category. */
export interface QualifyingScore {
  archer_id: string
  total_score: number
  max_score: number | null
  distance_m: number | null
  round_cat: string | null
}

/** Does this submission's round satisfy every condition the badge sets?
 *  Mirrors the SQL in check_and_grant_achievements (migration 057) exactly. */
export function scoreQualifies(def: AchievementDef, s: QualifyingScore): boolean {
  if (def.max_score != null && s.max_score !== def.max_score) return false
  if (def.distance_m != null && s.distance_m !== def.distance_m) return false
  if (def.round_category === 'tournament' && s.round_cat !== 'tournament') return false
  if (def.round_category === 'practice' && s.round_cat !== 'training' && s.round_cat !== 'practice') return false
  return true
}

/** Best total among a set of scores that qualify for the badge (0 if none). */
export function bestQualifying(def: AchievementDef, scores: QualifyingScore[]): number {
  return scores.reduce((best, s) => (scoreQualifies(def, s) ? Math.max(best, s.total_score) : best), 0)
}

/** Approved scores for the given archers with round distance/category attached
 *  (client-side stitch — embeds fail through the security_invoker views). */
export async function getApprovedScoresWithRounds(archerIds: string[]): Promise<QualifyingScore[]> {
  if (!archerIds.length) return []
  const [subRes, roundRes] = await Promise.all([
    supabase.from('score_submissions')
      .select('archer_id, total_score, max_score, round_id')
      .in('archer_id', archerIds)
      .eq('status', 'admin_approved'),
    supabase.from('rounds').select('id, distance_m, category'),
  ])
  if (subRes.error) throw subRes.error
  const rounds = new Map(
    ((roundRes.data ?? []) as { id: string; distance_m: number | null; category: string | null }[])
      .map(r => [r.id, r]),
  )
  return ((subRes.data ?? []) as { archer_id: string; total_score: number; max_score: number | null; round_id: string | null }[])
    .map(s => {
      const r = s.round_id ? rounds.get(s.round_id) : undefined
      return {
        archer_id: s.archer_id,
        total_score: s.total_score,
        max_score: s.max_score,
        distance_m: r?.distance_m ?? null,
        round_cat: r?.category ?? null,
      }
    })
}

/**
 * Re-evaluate ALL score badges against current definitions: revokes grants no
 * longer backed by a qualifying submission (e.g. earned before max_score was
 * set/corrected) and grants any that now qualify. Admin-only (checked in SQL).
 * Returns the number of revoked badges. Must be called from the app as a
 * logged-in admin — the bare SQL Editor has no auth.uid() and gets rejected.
 */
export async function recheckScoreAchievements(): Promise<number> {
  const { data, error } = await supabase.rpc('recheck_score_achievements')
  if (error) {
    // Wrap in a real Error so callers' `instanceof Error` checks surface the
    // actual database message instead of a generic fallback.
    if (error.code === '42883' || /does not exist/i.test(error.message ?? '')) {
      throw new Error('recheck_score_achievements() not found — run migration 057 (or 046) in the Supabase SQL Editor first.')
    }
    throw new Error(error.message || 'Recheck failed.')
  }
  return (data as number) ?? 0
}

export async function grantAchievementManually(profileId: string, achievementId: string, context?: object) {
  const { data, error } = await supabase
    .from('user_achievements')
    .upsert({ profile_id: profileId, achievement_id: achievementId, context })
    .select()
    .single()
  if (error) throw error
  return data as UserAchievement
}

export async function uploadBadgeImage(
  file: File,
  slug: string,
  kind: 'light' | 'dark',
): Promise<string> {
  // Badge art stays PNG (transparency required); oversized art is capped at
  // 512px. If re-encoding wouldn't save bytes the original is kept.
  const upload = await compressImage(file, compressPresets.badge)
  const ts = Date.now()
  const path = `achievements/${slug}/${kind}-${ts}.png`
  const { error } = await supabase.storage
    .from('achievement-badges')
    .upload(path, upload, { contentType: 'image/png', upsert: true })
  if (error) throw error
  const { data } = supabase.storage.from('achievement-badges').getPublicUrl(path)
  return data.publicUrl
}

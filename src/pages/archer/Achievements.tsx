import { useQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { useRuleValue } from '@/hooks/useSystemRules'
import { isOperationalAdmin } from '@/lib/permissions'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { supabase } from '@/services/supabase'
import { useLanguage } from '@/contexts/LanguageContext'
import { getAchievementDefs, getApprovedScoresWithRounds, bestQualifying } from '@/services/achievements'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { AchievementDef, UserAchievement, Theme } from '@/types'

type SelectedDef = AchievementDef & { earned?: UserAchievement }

function pickBadgeUrl(def: AchievementDef, theme: Theme): string | undefined {
  if (theme === 'dark') return def.badge_dark_url ?? def.badge_light_url
  return def.badge_light_url ?? def.badge_dark_url
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** "70m · max 360 · Tournament" — the round conditions a score badge carries. */
function roundConditionLabel(def: AchievementDef, t: Translate): string {
  const parts: string[] = []
  if (def.distance_m != null) parts.push(`${def.distance_m}m`)
  if (def.max_score != null) parts.push(`${t('achievementsPage.max')} ${def.max_score}`)
  if (def.round_category) parts.push(def.round_category === 'tournament' ? t('notifCategory.tournament') : t('achievementsPage.practice'))
  return parts.length ? parts.join(' · ') : t('achievementsPage.anyRound')
}

function getRequirementText(def: AchievementDef, t: Translate): string {
  if (def.category === 'score' && def.threshold) {
    const conds: string[] = []
    if (def.max_score != null) conds.push(`${t('achievementsPage.max')} ${def.max_score}`)
    if (def.distance_m != null) conds.push(`${def.distance_m}m`)
    if (def.round_category) conds.push(def.round_category === 'tournament' ? t('notifCategory.tournament').toLowerCase() : t('achievementsPage.practice').toLowerCase())
    return conds.length
      ? t('achievementsPage.reqScoreIn', { threshold: def.threshold, conds: conds.join(' · ') })
      : t('achievementsPage.reqScore', { threshold: def.threshold })
  }
  if (def.category === 'practice' && def.threshold)
    return t('achievementsPage.reqArrows', { count: def.threshold.toLocaleString() })
  return t('achievementsPage.reqGeneric')
}

function fmtProgress(value: number, category: AchievementDef['category']): string {
  return category === 'practice' ? value.toLocaleString() : String(value)
}

export default function ArcherAchievements() {
  const { profile } = useAuth()
  const { theme } = useTheme()
  const { t } = useLanguage()
  const [selected, setSelected] = useState<SelectedDef | null>(null)
  const moduleEnabled = useRuleValue<boolean>('module_achievements_enabled', true)

  const { data: defs = [] } = useQuery<AchievementDef[]>({
    queryKey: ['achievement-defs'],
    queryFn: getAchievementDefs,
  })

  const { data: earned = [] } = useQuery<UserAchievement[]>({
    queryKey: ['user-achievements', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      // No embedding — resolve definitions separately (embeds fail through views).
      const { data, error } = await supabase
        .from('user_achievements')
        .select('*')
        .eq('profile_id', profile!.id)
      if (error) throw error
      const rows = (data ?? []) as UserAchievement[]
      if (!rows.length) return rows
      const ids = [...new Set(rows.map((r) => r.achievement_id))]
      const { data: defRows } = await supabase.from('achievement_definitions').select('*').in('id', ids)
      const dmap = new Map(((defRows ?? []) as AchievementDef[]).map((d) => [d.id, d]))
      return rows.map((r) => ({ ...r, achievement: dmap.get(r.achievement_id) }))
    },
  })

  // Approved scores enriched with round distance/category — a score badge only
  // counts submissions whose round matches ALL of the badge's set conditions
  // (max score, distance, round type — migrations 046/057), so the progress
  // bar must filter the same way or it shows 100% on locked badges.
  const { data: scores = [] } = useQuery({
    queryKey: ['archer-approved-scores', profile?.id],
    enabled: !!profile?.id,
    queryFn: () => getApprovedScoresWithRounds([profile!.id]),
  })

  /** Best approved total among rounds fully matching the badge's conditions. */
  const bestMatching = (def: AchievementDef) => bestQualifying(def, scores)

  const { data: totalArrows = 0 } = useQuery<number>({
    queryKey: ['archer-total-arrows', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_logs')
        .select('arrows_shot')
        .eq('archer_id', profile!.id)
      if (error) throw error
      return (data as { arrows_shot: number }[]).reduce((sum, r) => sum + r.arrows_shot, 0)
    },
  })

  const earnedMap = useMemo(
    () => new Map(earned.map((e) => [e.achievement_id, e])),
    [earned],
  )

  // All / Earned / Locked filter over every section.
  const [show, setShow] = useState<'all' | 'earned' | 'locked'>('all')
  const passesShow = useMemo(
    () => (d: AchievementDef) =>
      show === 'all' ? true : show === 'earned' ? earnedMap.has(d.id) : !earnedMap.has(d.id),
    [show, earnedMap],
  )

  const byCategory = useMemo(
    () => ({
      score:      defs.filter((d) => d.category === 'score' && passesShow(d)),
      practice:   defs.filter((d) => d.category === 'practice' && passesShow(d)),
      tournament: defs.filter((d) => d.category === 'tournament' && passesShow(d)),
    }),
    [defs, passesShow],
  )

  // Score badges on their own line per round type ("70m · max 720 · Tournament"),
  // ordered by distance → max → threshold so related badges sit together.
  const scoreGroups = useMemo(() => {
    const groups = new Map<string, AchievementDef[]>()
    for (const d of byCategory.score) {
      const key = roundConditionLabel(d, t)
      groups.set(key, [...(groups.get(key) ?? []), d])
    }
    return [...groups.entries()]
      .map(([label, list]) => ({
        label,
        defs: [...list].sort((a, b) => (a.threshold ?? 0) - (b.threshold ?? 0)),
      }))
      .sort((a, b) =>
        ((a.defs[0].distance_m ?? Infinity) - (b.defs[0].distance_m ?? Infinity))
        || ((a.defs[0].max_score ?? Infinity) - (b.defs[0].max_score ?? Infinity)),
      )
  }, [byCategory.score, t])

  // Most recently earned badges, shown as a strip up top.
  const recentlyEarned = useMemo(
    () =>
      [...earned]
        .filter((e) => defs.some((d) => d.id === e.achievement_id))
        .sort((a, b) => new Date(b.earned_at).getTime() - new Date(a.earned_at).getTime())
        .slice(0, 5),
    [earned, defs],
  )

  if (!moduleEnabled && !isOperationalAdmin(profile?.role)) {
    return (
      <FeatureUnavailable
        title={t('achievementsPage.unavailable')}
        message={t('achievementsPage.unavailableHint')}
      />
    )
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('achievements.title')}
        description={t('achievementsPage.badgesEarnedOf', { earned: earned.length, total: defs.length })}
      />

      {defs.length === 0 ? (
        <EmptyState
          icon={<ShieldIcon />}
          title={t('achievementsPage.noneConfigured')}
          description={t('achievementsPage.noneConfiguredHint')}
        />
      ) : (
        <>
          {/* All / Earned / Locked filter */}
          <div className="flex items-center gap-1.5 mb-4">
            {([['all', 'common.all'], ['earned', 'achievements.earned'], ['locked', 'achievements.locked']] as const).map(([key, labelKey]) => (
              <button
                key={key}
                onClick={() => setShow(key)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                  show === key
                    ? 'bg-primary text-primary-on border-primary'
                    : 'bg-surface border-line text-text-dim hover:border-line-strong',
                )}
              >
                {t(labelKey)}{key === 'earned' && earned.length > 0 ? ` (${earned.length})` : ''}
              </button>
            ))}
          </div>

          {/* Latest earned strip */}
          {show !== 'locked' && recentlyEarned.length > 0 && (
            <SectionCard title={t('achievementsPage.recentlyEarned')} className="mb-4">
              <div className="flex flex-wrap gap-2">
                {recentlyEarned.map((e) => {
                  const def = defs.find((d) => d.id === e.achievement_id)!
                  return (
                    <button
                      key={e.id}
                      onClick={() => setSelected({ ...def, earned: e })}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-line bg-surface hover:border-line-strong transition-colors"
                    >
                      <span className="text-base leading-none">{def.icon ?? '🏅'}</span>
                      <span className="text-xs font-semibold text-text">{def.name}</span>
                      <span className="text-[10px] text-text-faint">{formatDate(e.earned_at)}</span>
                    </button>
                  )
                })}
              </div>
            </SectionCard>
          )}

          {byCategory.score.length > 0 && (
            <SectionCard title={t('achievements.scoreBadges')} className="mb-4">
              {scoreGroups.map((group) => (
                <div key={group.label} className="mb-4 last:mb-0">
                  <p className="text-[11px] font-semibold text-text-dim uppercase tracking-wide border-b border-line pb-1.5 mb-1">
                    {group.label}
                  </p>
                  <BadgeGrid
                    defs={group.defs}
                    earnedMap={earnedMap}
                    theme={theme}
                    progressFor={bestMatching}
                    onSelect={setSelected}
                  />
                </div>
              ))}
            </SectionCard>
          )}

          {byCategory.practice.length > 0 && (
            <SectionCard title={t('achievements.practiceBadges')} className="mb-4">
              <BadgeGrid
                defs={byCategory.practice}
                earnedMap={earnedMap}
                theme={theme}
                progressFor={() => totalArrows}
                onSelect={setSelected}
              />
            </SectionCard>
          )}

          {byCategory.tournament.length > 0 && (
            <SectionCard title={t('achievements.tournamentBadges')} className="mb-4">
              <BadgeGrid
                defs={byCategory.tournament}
                earnedMap={earnedMap}
                theme={theme}
                progressFor={() => 0}
                onSelect={setSelected}
              />
            </SectionCard>
          )}
        </>
      )}

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name}
        width="min(480px,100%)"
      >
        {selected && (
          <AchievementDetail
            def={selected}
            earned={selected.earned}
            theme={theme}
            progress={
              selected.category === 'score' ? bestMatching(selected)
                : selected.category === 'practice' ? totalArrows
                : 0
            }
          />
        )}
      </Modal>
    </PageWrapper>
  )
}

// ─── Badge Grid ───────────────────────────────────────────────────────────────

function BadgeGrid({
  defs, earnedMap, theme, progressFor, onSelect,
}: {
  defs: AchievementDef[]
  earnedMap: Map<string, UserAchievement>
  theme: Theme
  /** Per-badge progress — score badges only count rounds matching their max_score. */
  progressFor: (def: AchievementDef) => number
  onSelect: (d: SelectedDef) => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 mt-1">
      {defs.map((def) => {
        const ea = earnedMap.get(def.id)
        return (
          <BadgeCard
            key={def.id}
            def={def}
            earned={ea}
            theme={theme}
            progress={progressFor(def)}
            onSelect={onSelect}
          />
        )
      })}
    </div>
  )
}

// ─── Badge Card ───────────────────────────────────────────────────────────────

function BadgeCard({
  def, earned, theme, progress, onSelect,
}: {
  def: AchievementDef
  earned?: UserAchievement
  theme: Theme
  progress: number
  onSelect: (d: SelectedDef) => void
}) {
  const { t } = useLanguage()
  const isEarned = !!earned
  const badgeUrl = pickBadgeUrl(def, theme)
  const showProgress = (def.category === 'score' || def.category === 'practice') && def.threshold !== undefined
  const pct = showProgress && def.threshold ? Math.min(100, Math.round((progress / def.threshold) * 100)) : 0

  return (
    <button
      onClick={() => onSelect({ ...def, earned })}
      className={cn(
        'relative w-full rounded-[var(--r-lg)] border p-3 text-center',
        'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        isEarned
          ? 'bg-surface border-line-strong cursor-pointer'
          : 'bg-surface-soft border-line opacity-60 cursor-pointer',
      )}
    >
      {!isEarned && (
        <span className="absolute top-2 right-2 text-text-faint opacity-70">
          <LockIcon />
        </span>
      )}

      {/* Badge image or icon */}
      <div className={cn(
        'w-14 h-14 mx-auto mb-2.5 flex items-center justify-center',
        !isEarned && 'grayscale opacity-50',
      )}>
        {badgeUrl ? (
          <img
            src={badgeUrl}
            alt={def.name}
            className="w-full h-full object-contain rounded-lg"
          />
        ) : def.icon ? (
          <span className="text-4xl leading-none">{def.icon}</span>
        ) : (
          <BadgeDefaultIcon size={42} />
        )}
      </div>

      <div className="font-display font-semibold text-[13px] leading-tight text-text">
        {def.name}
      </div>

      {/* Progress bar */}
      {showProgress && def.threshold !== undefined && (
        <div className="mt-2 w-full">
          <div className="flex justify-between text-[10px] text-text-dim mb-1">
            <span>{fmtProgress(progress, def.category)}</span>
            <span>{fmtProgress(def.threshold, def.category)}</span>
          </div>
          <div className="w-full bg-section rounded-full h-1.5 overflow-hidden">
            <div
              className={cn(
                'h-1.5 rounded-full transition-all duration-500',
                isEarned ? 'bg-success' : 'bg-primary',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {isEarned && (
        <div className="mt-2">
          <Badge variant="success" className="text-[9px]">{t('achievements.earned')}</Badge>
        </div>
      )}
    </button>
  )
}

// ─── Achievement Detail (modal body) ─────────────────────────────────────────

function AchievementDetail({
  def, earned, theme, progress,
}: {
  def: AchievementDef
  earned?: UserAchievement
  theme: Theme
  /** Already resolved for this badge (matching-round best / total arrows). */
  progress: number
}) {
  const { t } = useLanguage()
  const isEarned = !!earned
  const badgeUrl = pickBadgeUrl(def, theme)
  const showProgress = (def.category === 'score' || def.category === 'practice') && def.threshold !== undefined
  const pct = showProgress && def.threshold ? Math.min(100, Math.round((progress / def.threshold) * 100)) : 0

  return (
    <div className="space-y-4">
      {/* Badge image */}
      <div className="flex justify-center pt-1">
        <div className={cn(
          'w-24 h-24 rounded-2xl bg-surface-soft flex items-center justify-center border border-line overflow-hidden',
          !isEarned && 'grayscale opacity-50',
        )}>
          {badgeUrl ? (
            <img src={badgeUrl} alt={def.name} className="w-full h-full object-contain" />
          ) : def.icon ? (
            <span className="text-5xl leading-none">{def.icon}</span>
          ) : (
            <BadgeDefaultIcon size={52} />
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-text-dim leading-relaxed">{def.description}</p>

      {/* Requirement */}
      <div className="bg-section rounded-[var(--r)] p-3">
        <p className="text-[11px] font-semibold text-text-dim uppercase tracking-wide mb-1">{t('achievementsPage.requirement')}</p>
        <p className="text-sm text-text">{getRequirementText(def, t)}</p>
      </div>

      {/* Progress */}
      {showProgress && def.threshold !== undefined && (
        <div>
          <div className="flex justify-between text-xs text-text-dim mb-1.5">
            <span className="font-medium">Progress</span>
            <span>
              {def.category === 'practice'
                ? `${progress.toLocaleString()} / ${def.threshold.toLocaleString()}`
                : `${progress} / ${def.threshold}`}{' '}
              <span className="text-text-faint">({pct}%)</span>
            </span>
          </div>
          <div className="w-full bg-section rounded-full h-2 overflow-hidden">
            <div
              className={cn(
                'h-2 rounded-full transition-all duration-500',
                isEarned ? 'bg-success' : 'bg-primary',
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Earned status */}
      {isEarned ? (
        <div className="bg-success-soft rounded-[var(--r)] p-3 text-sm space-y-1.5">
          <div>
            <span className="text-success font-semibold">✓ {t('achievements.earned')}</span>
            <span className="text-text-dim"> on {formatDate(earned!.earned_at)}</span>
          </div>
          <EarnedWith context={earned!.context} />
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-text-dim py-1">
          <LockIcon />
          <span>{t('achievementsPage.notYetEarned')}</span>
        </div>
      )}
    </div>
  )
}

/** The score that earned the badge (stored in user_achievements.context by
 *  migration 057's grant function; older grants get it backfilled on recheck). */
function EarnedWith({ context }: { context?: Record<string, unknown> }) {
  const { t } = useLanguage()
  const score = context?.total_score
  if (score == null) return null
  const round = typeof context?.round_name === 'string' ? context.round_name : null
  const venue = typeof context?.venue === 'string' && context.venue ? context.venue : null
  const date  = typeof context?.date === 'string' && context.date ? formatDate(context.date) : null
  return (
    <div className="text-xs text-text-dim border-t border-success/20 pt-1.5">
      {t('achievementsPage.earnedWith')} <strong className="text-text">{String(score)}</strong>
      {round && <> {t('achievementsPage.in')} <strong className="text-text">{round}</strong></>}
      {venue && <> {t('achievementsPage.at')} {venue}</>}
      {date && <> · {date}</>}
    </div>
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function BadgeDefaultIcon({ size = 42 }: { size?: number }) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      className="text-text-faint"
    >
      <path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z" />
    </svg>
  )
}

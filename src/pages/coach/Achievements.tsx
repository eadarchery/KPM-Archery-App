import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Button } from '@/components/ui'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useTheme } from '@/hooks/useTheme'
import { useRuleValue } from '@/hooks/useSystemRules'
import { isOperationalAdmin } from '@/lib/permissions'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { supabase } from '@/services/supabase'
import { fetchOrgMaps } from '@/services/orgLookup'
import { getAchievementDefs, getUserAchievements, getApprovedScoresWithRounds, bestQualifying, type QualifyingScore } from '@/services/achievements'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { AchievementDef, UserAchievement, Theme } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ArcherRow {
  id: string
  name: string
  archer_id?: string
  age?: number
  bow_category?: string
  school?: { id: string; name: string }
  pld?:   { id: string; name: string }
  state?: { id: string; name: string; code: string }
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const AGE_GROUPS = [
  { value: '',     labelKey: 'common.allAges' },
  { value: 'u14',  labelKey: 'coachArchers.u14' },
  { value: 'u18',  labelKey: 'coachArchers.u18' },
  { value: 'u21',  labelKey: 'coachArchers.u21' },
  { value: 'open', labelKey: 'leaderboardPage.open22' },
]

const CATEGORY_OPTS = [
  { value: '',           labelKey: 'common.allCategories' },
  { value: 'score',      labelKey: 'notifCategory.score' },
  { value: 'practice',   labelKey: 'achievementsPage.practice' },
  { value: 'tournament', labelKey: 'notifCategory.tournament' },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function ageGroupKey(age?: number): string {
  if (!age) return ''
  if (age <= 14) return 'u14'
  if (age <= 18) return 'u18'
  if (age <= 21) return 'u21'
  return 'open'
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

function ageGroupLabel(age: number | undefined, t: Translate): string {
  const key = ageGroupKey(age)
  const opt = AGE_GROUPS.find(g => g.value === key)
  return opt ? t(opt.labelKey) : '—'
}

function pickBadgeUrl(def: AchievementDef, theme: Theme): string | undefined {
  if (theme === 'dark') return def.badge_dark_url ?? def.badge_light_url
  return def.badge_light_url ?? def.badge_dark_url
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

// ─── MAIN PAGE ───────────────────────────────────────────────────────────────

export default function CoachAchievements() {
  const { profile } = useAuth()
  const { theme }   = useTheme()
  const { t }       = useLanguage()

  const [search,         setSearch]         = useState('')
  const [filterState,    setFilterState]    = useState('')
  const [filterPld,      setFilterPld]      = useState('')
  const [filterSchool,   setFilterSchool]   = useState('')
  const [filterAgeGroup, setFilterAgeGroup] = useState('')
  const [filterBow,      setFilterBow]      = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filtersOpen,    setFiltersOpen]    = useState(false)
  const [selectedId,     setSelectedId]     = useState<string | null>(null)
  const moduleEnabled = useRuleValue<boolean>('module_achievements_enabled', true)

  // ── Fetch active linked archers ──────────────────────────────────────────
  const { data: archers = [], isLoading } = useQuery<ArcherRow[]>({
    queryKey: ['coach-achievement-archers', profile?.id],
    enabled: !!profile?.id,
    staleTime: 60_000,
    queryFn: async () => {
      // No embedding — resolve archers + org names separately (embeds fail
      // through the security_invoker views).
      const { data: links, error } = await supabase
        .from('coach_archer_links')
        .select('archer_id')
        .eq('coach_id', profile!.id)
        .eq('status', 'active')
      if (error) throw error
      const ids = [...new Set((links ?? []).map((l: { archer_id: string }) => l.archer_id))]
      if (!ids.length) return []
      const [pRes, maps] = await Promise.all([
        supabase.from('profiles').select('id, name, archer_id, age, bow_category, school_id, pld_id, state_id').in('id', ids),
        fetchOrgMaps(),
      ])
      return ((pRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        archer_id: (p.archer_id as string) ?? undefined,
        age: (p.age as number) ?? undefined,
        bow_category: (p.bow_category as string) ?? undefined,
        school: p.school_id ? maps.schools.get(p.school_id as string) : undefined,
        pld:    p.pld_id    ? maps.plds.get(p.pld_id as string)       : undefined,
        state:  p.state_id  ? maps.states.get(p.state_id as string)   : undefined,
      })) as ArcherRow[]
    },
  })

  const archerIds = useMemo(() => archers.map(a => a.id), [archers])

  // ── Achievement definitions ──────────────────────────────────────────────
  const { data: defs = [] } = useQuery<AchievementDef[]>({
    queryKey: ['achievement-defs'],
    queryFn: getAchievementDefs,
  })

  // ── All earned achievements for all linked archers ───────────────────────
  const { data: allEarned = [] } = useQuery<UserAchievement[]>({
    queryKey: ['coach-all-earned', archerIds],
    enabled: archerIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      // No embedding — stitch definitions client-side (embeds fail via views).
      const { data, error } = await supabase
        .from('user_achievements')
        .select('*')
        .in('profile_id', archerIds)
        .order('earned_at', { ascending: false })
      if (error) throw error
      const rows = (data ?? []) as UserAchievement[]
      if (!rows.length) return rows
      const ids = [...new Set(rows.map((r) => r.achievement_id))]
      const { data: defRows } = await supabase.from('achievement_definitions').select('*').in('id', ids)
      const dmap = new Map(((defRows ?? []) as AchievementDef[]).map((d) => [d.id, d]))
      return rows.map((r) => ({ ...r, achievement: dmap.get(r.achievement_id) }))
    },
  })

  // ── The coach's OWN badges (coaching category) ────────────────────────────
  const { data: myEarned = [] } = useQuery<UserAchievement[]>({
    queryKey: ['user-achievements', profile?.id],
    enabled: !!profile?.id,
    queryFn: () => getUserAchievements(profile!.id),
  })
  const myEarnedMap = useMemo(
    () => new Map(myEarned.map(e => [e.achievement_id, e])),
    [myEarned],
  )
  // The coach's own badge wall: every coaching badge (earned or not) plus any
  // score/practice badges they earned from their OWN scoring (My Performance).
  const coachingDefs = useMemo(
    () => [
      ...defs.filter(d => d.category === 'coaching'),
      ...defs.filter(d => d.category !== 'coaching' && myEarnedMap.has(d.id)),
    ],
    [defs, myEarnedMap],
  )

  // ── Approved scores (with round distance/type) for all linked archers ────
  // A score badge only counts submissions whose round matches ALL the badge's
  // conditions — max score, distance, round type (migrations 046/057) — so
  // badge progress must filter the same way.
  const { data: scoreRows = [] } = useQuery<QualifyingScore[]>({
    queryKey: ['coach-all-best-scores', archerIds],
    enabled: archerIds.length > 0,
    staleTime: 60_000,
    queryFn: () => getApprovedScoresWithRounds(archerIds),
  })

  // ── Training arrows for the modal's selected archer ─────────────────────
  const { data: modalArrows = 0 } = useQuery<number>({
    queryKey: ['coach-archer-arrows', selectedId],
    enabled: !!selectedId,
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_logs')
        .select('arrows_shot')
        .eq('archer_id', selectedId!)
      if (error) return 0
      return (data as { arrows_shot: number }[]).reduce((sum, r) => sum + r.arrows_shot, 0)
    },
  })

  // ── Derived: group data by archer ────────────────────────────────────────
  const earnedByArcher = useMemo(() => {
    const map = new Map<string, UserAchievement[]>()
    for (const e of allEarned) {
      const arr = map.get(e.profile_id) ?? []
      arr.push(e)
      map.set(e.profile_id, arr)
    }
    return map
  }, [allEarned])

  const bestScoreByArcher = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of scoreRows) {
      const current = map.get(s.archer_id) ?? 0
      if (s.total_score > current) map.set(s.archer_id, s.total_score)
    }
    return map
  }, [scoreRows])

  // ── Stat cards ───────────────────────────────────────────────────────────
  const thisMonthCount = useMemo(() => {
    const start = new Date()
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
    return allEarned.filter(e => new Date(e.earned_at) >= start).length
  }, [allEarned])

  const highestScoreBadge = useMemo(() => {
    let best: AchievementDef | null = null
    let bestThreshold = -1
    for (const e of allEarned) {
      const def = e.achievement
      if (def?.category === 'score' && (def.threshold ?? 0) > bestThreshold) {
        bestThreshold = def.threshold ?? 0
        best = def
      }
    }
    return best
  }, [allEarned])

  const noBadgeCount = useMemo(
    () => archers.filter(a => !earnedByArcher.get(a.id)?.length).length,
    [archers, earnedByArcher],
  )

  // ── Filter options from actual archer data ───────────────────────────────
  const { stateOpts, pldOpts, schoolOpts, bowOpts } = useMemo(() => {
    const stateMap  = new Map<string, string>()
    const pldMap    = new Map<string, string>()
    const schoolMap = new Map<string, string>()
    const bowSet    = new Set<string>()
    for (const a of archers) {
      if (a.state)        stateMap.set(a.state.code, a.state.name)
      if (a.pld)          pldMap.set(a.pld.id, a.pld.name)
      if (a.school)       schoolMap.set(a.school.id, a.school.name)
      if (a.bow_category) bowSet.add(a.bow_category)
    }
    return {
      stateOpts:  [{ value: '', label: 'All states'    }, ...[...stateMap.entries()].map(([v,l]) => ({ value: v, label: l }))],
      pldOpts:    [{ value: '', label: 'All PLDs'      }, ...[...pldMap.entries()].map(([v,l])   => ({ value: v, label: l }))],
      schoolOpts: [{ value: '', label: 'All schools'   }, ...[...schoolMap.entries()].map(([v,l]) => ({ value: v, label: l }))],
      bowOpts:    [{ value: '', label: 'All bow types' }, ...[...bowSet].map(b => ({ value: b, label: b }))],
    }
  }, [archers])

  const activeFilterCount = [filterState, filterPld, filterSchool, filterAgeGroup, filterBow, filterCategory].filter(v => v).length

  function clearFilters() {
    setFilterState(''); setFilterPld(''); setFilterSchool('')
    setFilterAgeGroup(''); setFilterBow(''); setFilterCategory('')
  }

  // ── Client-side filtered list ────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = archers
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(a =>
        a.name.toLowerCase().includes(q) ||
        (a.archer_id ?? '').toLowerCase().includes(q) ||
        (a.school?.name ?? '').toLowerCase().includes(q),
      )
    }
    if (filterState)     list = list.filter(a => a.state?.code   === filterState)
    if (filterPld)       list = list.filter(a => a.pld?.id       === filterPld)
    if (filterSchool)    list = list.filter(a => a.school?.id    === filterSchool)
    if (filterAgeGroup)  list = list.filter(a => ageGroupKey(a.age) === filterAgeGroup)
    if (filterBow)       list = list.filter(a => a.bow_category  === filterBow)
    if (filterCategory) {
      list = list.filter(a =>
        (earnedByArcher.get(a.id) ?? []).some(e => e.achievement?.category === filterCategory),
      )
    }
    return list
  }, [archers, search, filterState, filterPld, filterSchool, filterAgeGroup, filterBow, filterCategory, earnedByArcher])

  // ── Selected archer data for modal ───────────────────────────────────────
  const selectedArcher    = archers.find(a => a.id === selectedId) ?? null
  const selectedEarned    = selectedId ? earnedByArcher.get(selectedId) ?? [] : []
  const selectedScores    = useMemo(
    () => (selectedId ? scoreRows.filter(s => s.archer_id === selectedId) : []),
    [selectedId, scoreRows],
  )

  // ─── RENDER ───────────────────────────────────────────────────────────────

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
        title={t('coachAch.title')}
        description={t('coachAch.description')}
      />

      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label={t('coachDash.linkedArchers')}
          value={archers.length}
          sub={t('coachAch.activeLinks')}
          icon={<PeopleIcon />}
        />
        <StatCard
          label={t('coachAch.newThisMonth')}
          value={thisMonthCount}
          sub={t('coachAch.badgesEarned')}
          icon={<TrophyIcon />}
        />
        <StatCard
          label={t('coachAch.topScoreBadge')}
          value={highestScoreBadge?.threshold ?? '—'}
          sub={highestScoreBadge?.name ?? t('coachAch.noneEarnedYet')}
          icon={<StarIcon />}
        />
        <StatCard
          label={t('coachAch.noBadgesYet')}
          value={noBadgeCount}
          sub={t('coachAch.archersWord')}
          icon={<ShieldIcon />}
        />
      </div>

      {/* ── The coach's own badges (earned from student progress) ────────── */}
      {coachingDefs.length > 0 && (
        <SectionCard
          title={t('coachAch.myCoachingBadges', { earned: coachingDefs.filter(d => myEarnedMap.has(d.id)).length, total: coachingDefs.length })}
          className="mb-6"
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {coachingDefs.map((def) => {
              const isEarned = myEarnedMap.has(def.id)
              const badgeUrl = pickBadgeUrl(def, theme)
              return (
                <div
                  key={def.id}
                  className={cn(
                    'border border-line rounded-[var(--r-md)] p-3 text-center transition-opacity',
                    !isEarned && 'opacity-45 grayscale',
                  )}
                  title={def.description}
                >
                  {badgeUrl
                    ? <img src={badgeUrl} alt={def.name} className="w-12 h-12 mx-auto object-contain" />
                    : <div className="text-3xl">{def.icon ?? '🏅'}</div>}
                  <p className="text-xs font-semibold text-text mt-1.5">{def.name}</p>
                  <p className="text-[10px] text-text-dim mt-0.5 leading-snug">{def.description}</p>
                  {isEarned && (
                    <p className="text-[10px] text-success font-semibold mt-1">
                      {t('achievements.earned')} {formatDate(myEarnedMap.get(def.id)!.earned_at)}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* ── Search + filter bar ─────────────────────────────────────────── */}
      <SectionCard className="mb-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('coachAch.searchPlaceholder')}
              className="field pr-9 w-full"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-faint pointer-events-none">
              <SearchIcon />
            </span>
          </div>
          <Button
            variant={filtersOpen ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setFiltersOpen(o => !o)}
          >
            <FilterIcon />
            {t('common.filters')}
            {activeFilterCount > 0 && (
              <span className="ml-1 bg-danger text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>

        {filtersOpen && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-line">
            <Select
              options={stateOpts}
              value={filterState}
              onChange={e => setFilterState(e.target.value)}
            />
            <Select
              options={pldOpts}
              value={filterPld}
              onChange={e => setFilterPld(e.target.value)}
            />
            <Select
              options={schoolOpts}
              value={filterSchool}
              onChange={e => setFilterSchool(e.target.value)}
            />
            <Select
              options={AGE_GROUPS.map(g => ({ value: g.value, label: t(g.labelKey) }))}
              value={filterAgeGroup}
              onChange={e => setFilterAgeGroup(e.target.value)}
            />
            <Select
              options={bowOpts}
              value={filterBow}
              onChange={e => setFilterBow(e.target.value)}
            />
            <Select
              options={CATEGORY_OPTS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
            />
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="col-span-full text-xs text-text-dim hover:text-text underline text-left"
              >
                {t('coachAch.clearFilters')}
              </button>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Archer list ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-center py-12 text-text-dim text-sm">{t('common.loading')}</div>
      ) : archers.length === 0 ? (
        <EmptyState
          icon={<PeopleIcon />}
          title={t('coachEquip.noLinked')}
          description={t('coachAch.noLinkedHint')}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<SearchIcon />}
          title={t('coachArchers.noArchersFound')}
          description={t('common.noResultsFilters')}
          action={
            <Button variant="ghost" size="sm" onClick={() => { setSearch(''); clearFilters() }}>
              {t('common.clear')}
            </Button>
          }
        />
      ) : (
        <SectionCard
          title={`${t('nav.archers')} (${filtered.length}${filtered.length !== archers.length ? ` / ${archers.length}` : ''})`}
        >
          <div className="divide-y divide-line -mx-4 sm:-mx-6">
            {filtered.map(archer => {
              const earned     = earnedByArcher.get(archer.id) ?? []
              const latest     = earned[0] ?? null
              const bestScore  = bestScoreByArcher.get(archer.id) ?? 0
              return (
                <ArcherListItem
                  key={archer.id}
                  archer={archer}
                  earned={earned}
                  latestEarned={latest}
                  bestScore={bestScore}
                  onView={() => setSelectedId(archer.id)}
                />
              )
            })}
          </div>
        </SectionCard>
      )}

      {/* ── Detail modal ─────────────────────────────────────────────────── */}
      <Modal
        open={!!selectedId && !!selectedArcher}
        onClose={() => setSelectedId(null)}
        title={selectedArcher ? `${selectedArcher.name} — ${t('achievements.title')}` : ''}
        width="min(640px,100%)"
      >
        {selectedArcher && (
          <ArcherAchievementModal
            archer={selectedArcher}
            defs={defs}
            earned={selectedEarned}
            theme={theme}
            scores={selectedScores}
            totalArrows={modalArrows}
          />
        )}
      </Modal>
    </PageWrapper>
  )
}

// ─── ARCHER LIST ITEM ────────────────────────────────────────────────────────

function ArcherListItem({
  archer, earned, latestEarned, bestScore, onView,
}: {
  archer: ArcherRow
  earned: UserAchievement[]
  latestEarned: UserAchievement | null
  bestScore: number
  onView: () => void
}) {
  const { t } = useLanguage()
  return (
    <div className="px-4 sm:px-6 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-surface-soft transition-colors">
      {/* Name + ID */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 sm:block">
          <div>
            <p className="font-semibold text-sm text-text leading-tight">{archer.name}</p>
            <p className="text-[11px] text-text-dim mt-0.5">{archer.archer_id ?? '—'}</p>
          </div>
          {/* Badge count chip (visible on mobile only) */}
          <span className="sm:hidden shrink-0">
            <BadgeCountChip count={earned.length} />
          </span>
        </div>

        {/* Details row */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-text-dim">
          {archer.school && <span>{archer.school.name}</span>}
          <span>{ageGroupLabel(archer.age, t)}</span>
          {archer.bow_category && <span>{archer.bow_category}</span>}
          {bestScore > 0 && (
            <span className="text-text font-medium">{t('common.best')}: {bestScore}</span>
          )}
        </div>

        {/* Latest earned */}
        {latestEarned?.achievement && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[10px] text-text-faint">{t('talents.last')}:</span>
            <span className="text-xs text-text font-medium">
              {latestEarned.achievement.icon ? `${latestEarned.achievement.icon} ` : ''}
              {latestEarned.achievement.name}
            </span>
            <span className="text-[10px] text-text-faint">{formatDate(latestEarned.earned_at)}</span>
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
        {/* Badge count (desktop) */}
        <span className="hidden sm:block">
          <BadgeCountChip count={earned.length} />
        </span>
        <Button variant="ghost" size="sm" onClick={onView}>
          {t('coachAch.viewBadges')}
        </Button>
      </div>
    </div>
  )
}

function BadgeCountChip({ count }: { count: number }) {
  const { t } = useLanguage()
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full',
      count > 0
        ? 'bg-success-soft text-success'
        : 'bg-section text-text-faint',
    )}>
      <ShieldIcon size={10} />
      {count} {t('coachAch.badgesWord')}
    </span>
  )
}

// ─── ACHIEVEMENT MODAL ───────────────────────────────────────────────────────

function ArcherAchievementModal({
  archer, defs, earned, theme, scores, totalArrows,
}: {
  archer: ArcherRow
  defs: AchievementDef[]
  earned: UserAchievement[]
  theme: Theme
  scores: QualifyingScore[]
  totalArrows: number
}) {
  const { t } = useLanguage()
  const earnedMap = useMemo(
    () => new Map(earned.map(e => [e.achievement_id, e])),
    [earned],
  )

  const byCategory = useMemo(() => ({
    score:      defs.filter(d => d.category === 'score'),
    practice:   defs.filter(d => d.category === 'practice'),
    tournament: defs.filter(d => d.category === 'tournament'),
  }), [defs])

  return (
    <div className="space-y-5">
      {/* Archer summary */}
      <div className="flex items-center gap-3 pb-4 border-b border-line">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-text-dim">{archer.archer_id ?? '—'} · {archer.school?.name ?? '—'}</p>
          <p className="text-xs text-text-dim mt-0.5">{ageGroupLabel(archer.age, t)} · {archer.bow_category ?? '—'}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-display font-bold text-2xl text-text">{earned.length}</p>
          <p className="text-[11px] text-text-dim">{t('coachAch.badgesEarned')}</p>
        </div>
      </div>

      {defs.length === 0 ? (
        <EmptyState icon={<ShieldIcon />} title={t('achievementsPage.noneConfigured')} />
      ) : (
        <>
          {byCategory.score.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wide mb-2">{t('achievements.scoreBadges')}</h3>
              <ModalBadgeGrid
                defs={byCategory.score}
                earnedMap={earnedMap}
                theme={theme}
                scores={scores}
                totalArrows={totalArrows}
              />
            </div>
          )}
          {byCategory.practice.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wide mb-2">{t('achievements.practiceBadges')}</h3>
              <ModalBadgeGrid
                defs={byCategory.practice}
                earnedMap={earnedMap}
                theme={theme}
                scores={scores}
                totalArrows={totalArrows}
              />
            </div>
          )}
          {byCategory.tournament.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-text-dim uppercase tracking-wide mb-2">{t('achievements.tournamentBadges')}</h3>
              <ModalBadgeGrid
                defs={byCategory.tournament}
                earnedMap={earnedMap}
                theme={theme}
                scores={scores}
                totalArrows={totalArrows}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── MODAL BADGE GRID ─────────────────────────────────────────────────────────

function ModalBadgeGrid({
  defs, earnedMap, theme, scores, totalArrows,
}: {
  defs: AchievementDef[]
  earnedMap: Map<string, UserAchievement>
  theme: Theme
  scores: QualifyingScore[]
  totalArrows: number
}) {
  const { t } = useLanguage()
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
      {defs.map(def => {
        const ea       = earnedMap.get(def.id)
        const isEarned = !!ea
        const badgeUrl = pickBadgeUrl(def, theme)
        // Score progress counts only submissions whose round matches ALL of the
        // badge's conditions — max, distance, type (migrations 046/057).
        const rawProg  = def.category === 'practice' ? totalArrows : bestQualifying(def, scores)
        const showProg = (def.category === 'score' || def.category === 'practice') && def.threshold !== undefined
        const pct      = showProg && def.threshold ? Math.min(100, Math.round((rawProg / def.threshold) * 100)) : 0

        return (
          <div
            key={def.id}
            className={cn(
              'relative rounded-[var(--r-lg)] border p-2.5 text-center',
              isEarned
                ? 'bg-surface border-line-strong'
                : 'bg-surface-soft border-line opacity-60',
            )}
          >
            {!isEarned && (
              <span className="absolute top-1.5 right-1.5 text-text-faint opacity-60">
                <LockIcon size={11} />
              </span>
            )}

            {/* Badge image / icon */}
            <div className={cn(
              'w-10 h-10 mx-auto mb-1.5 flex items-center justify-center',
              !isEarned && 'grayscale opacity-50',
            )}>
              {badgeUrl ? (
                <img src={badgeUrl} alt={def.name} className="w-full h-full object-contain rounded-md" />
              ) : def.icon ? (
                <span className="text-2xl leading-none">{def.icon}</span>
              ) : (
                <BadgeDefaultIcon size={28} />
              )}
            </div>

            <p className="font-semibold text-[11px] leading-tight text-text">{def.name}</p>

            {/* Progress */}
            {showProg && def.threshold !== undefined && (
              <div className="mt-1.5 w-full">
                <div className="flex justify-between text-[9px] text-text-faint mb-0.5">
                  <span>{def.category === 'practice' ? rawProg.toLocaleString() : rawProg}</span>
                  <span>{def.category === 'practice' ? def.threshold.toLocaleString() : def.threshold}</span>
                </div>
                <div className="w-full bg-section rounded-full h-1 overflow-hidden">
                  <div
                    className={cn('h-1 rounded-full', isEarned ? 'bg-success' : 'bg-primary')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {isEarned && (
              <div className="mt-1.5">
                <Badge variant="success" className="text-[8px]">{t('achievements.earned')}</Badge>
              </div>
            )}

            {isEarned && ea.earned_at && (
              <p className="text-[9px] text-text-faint mt-0.5">{formatDate(ea.earned_at)}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

function PeopleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function TrophyIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="8 21 12 17 16 21" />
      <line x1="12" y1="17" x2="12" y2="11" />
      <path d="M5 6H3a1 1 0 0 0-1 1v3a4 4 0 0 0 4 4h.5" />
      <path d="M19 6h2a1 1 0 0 1 1 1v3a4 4 0 0 1-4 4h-.5" />
      <path d="M6 6V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a6 6 0 0 1-12 0V6z" />
    </svg>
  )
}

function StarIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function ShieldIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z" />
    </svg>
  )
}

function BadgeDefaultIcon({ size = 42 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-faint">
      <path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z" />
    </svg>
  )
}

function LockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  )
}

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui'
import { Select } from '@/components/ui/Input'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import {
  getLeaderboardScoresPage,
  getLeaderboardFacets,
  type LeaderboardCursor,
} from '@/services/leaderboard'
import type { LeaderboardEntry } from '@/types'
import { scoreDisplay } from '@/utils/format'
import { formatDate } from '@/utils/dates'
import { BOW_CATEGORIES } from '@/utils/format'
import { cn } from '@/utils/cn'

// Calendar-year (competition) age groups — the value is stored/queried, the
// label is translated. Matches the public.leaderboard view (migration 059).
const AGE_GROUPS = [
  { value: '',     labelKey: 'common.allAges' },
  { value: 'U12',  labelKey: 'ageGroups.u12' },
  { value: 'U15',  labelKey: 'ageGroups.u15' },
  { value: 'U18',  labelKey: 'ageGroups.u18' },
  { value: 'Open', labelKey: 'ageGroups.open' },
]

export default function ArcherLeaderboard() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [bowFilter, setBowFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')      // round category (or 'tournament')
  const [ageFilter, setAgeFilter] = useState('')      // U12 | U15 | U18 | Open
  const [distFilter, setDistFilter] = useState('')    // metres, as string
  const [genderFilter, setGenderFilter] = useState('') // male | female
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCursors, setPageCursors] = useState<(LeaderboardCursor | null)[]>([null])

  // Leaderboard module gate (master switch + module flag).
  const moduleOn = useRuleValue<boolean>('module_leaderboard_enabled', true)
  const boardOn  = useRuleValue<boolean>('leaderboard_enabled', true)

  // Archers see their own state's board. public.leaderboard already restricts
  // to admin-approved scores of approved archers (migration 059).
  const stateId = profile?.state_id ?? ''

  useEffect(() => {
    setPageIndex(0)
    setPageCursors([null])
  }, [stateId, bowFilter, catFilter, ageFilter, distFilter, genderFilter])

  // Available category + distance options for THIS state (only offer values
  // that actually exist in the data).
  const { data: facets } = useQuery({
    queryKey: ['leaderboard-facets', stateId],
    enabled: !!stateId && moduleOn && boardOn,
    queryFn: () => getLeaderboardFacets('state', stateId),
    staleTime: 300_000,
  })

  const pageCursor = pageCursors[pageIndex] ?? null
  const { data: page, isLoading, isFetching } = useQuery({
    queryKey: ['leaderboard', 'state', stateId, bowFilter, catFilter, ageFilter, distFilter, genderFilter, pageCursor],
    enabled: !!stateId && moduleOn && boardOn,
    queryFn: () =>
      getLeaderboardScoresPage(
        {
          scope: 'state',
          stateId,
          bowCategory:   bowFilter ? bowFilter.toLowerCase() : undefined,
          gender:        genderFilter || undefined,
          roundCategory: catFilter || undefined,
          ageGroup:      ageFilter || undefined,
          distanceM:     distFilter ? Number(distFilter) : undefined,
          limit: 50,
        },
        pageCursor,
      ),
    staleTime: 60_000,
  })
  const rows: LeaderboardEntry[] = page?.items ?? []

  const nextPage = () => {
    if (!page?.nextCursor) return
    setPageCursors((current) => [
      ...current.slice(0, pageIndex + 1),
      page.nextCursor,
    ])
    setPageIndex((current) => current + 1)
  }

  if (!moduleOn || !boardOn) {
    return (
      <FeatureUnavailable
        title={t('leaderboardPage.unavailable')}
        message={t('leaderboardPage.unavailableHint')}
      />
    )
  }

  const myRank = rows.find((r) => r.archer_id === profile?.id)?.rank ?? null

  // Round-category filter pills: a Tournament shortcut plus any categories present.
  const catOptions = ['tournament', ...(facets?.categories.filter((c) => c !== 'tournament') ?? [])]

  return (
    <PageWrapper>
      <PageHead
        title={t('nav.leaderboard')}
        description={t('leaderboardPage.description')}
      />

      {/* Filters */}
      <div className="space-y-3 mb-4">
        {/* Bow category */}
        <div className="flex gap-2 flex-wrap">
          <FilterPill active={!bowFilter} onClick={() => setBowFilter('')}>{t('reportFilters.allBows')}</FilterPill>
          {BOW_CATEGORIES.map((cat) => (
            <FilterPill key={cat} active={bowFilter === cat} onClick={() => setBowFilter(cat)}>{cat}</FilterPill>
          ))}
        </div>

        {/* Round category / tournament */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] uppercase tracking-wide text-text-faint font-semibold w-16">{t('leaderboardPage.category')}</span>
          <FilterPill active={!catFilter} onClick={() => setCatFilter('')}>{t('common.all')}</FilterPill>
          {catOptions.map((c) => (
            <FilterPill key={c} active={catFilter === c} onClick={() => setCatFilter(c)}>
              {c === 'tournament' ? `🏆 ${t('roundCategories.tournament')}` : t(`roundCategories.${c}`)}
            </FilterPill>
          ))}
        </div>

        {/* Age group */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] uppercase tracking-wide text-text-faint font-semibold w-16">{t('leaderboardPage.ageGroup')}</span>
          {AGE_GROUPS.map((g) => (
            <FilterPill key={g.value || 'all'} active={ageFilter === g.value} onClick={() => setAgeFilter(g.value)}>
              {t(g.labelKey)}
            </FilterPill>
          ))}
        </div>

        {/* Gender */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-[11px] uppercase tracking-wide text-text-faint font-semibold w-16">{t('archerProfile.gender')}</span>
          <FilterPill active={!genderFilter} onClick={() => setGenderFilter('')}>{t('common.all')}</FilterPill>
          <FilterPill active={genderFilter === 'male'} onClick={() => setGenderFilter('male')}>{t('kpm.gender.male')}</FilterPill>
          <FilterPill active={genderFilter === 'female'} onClick={() => setGenderFilter('female')}>{t('kpm.gender.female')}</FilterPill>
        </div>

        {/* Distance */}
        {(facets?.distances.length ?? 0) > 0 && (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[11px] uppercase tracking-wide text-text-faint font-semibold w-16">{t('leaderboardPage.distance')}</span>
            <Select value={distFilter} onChange={(e) => setDistFilter(e.target.value)} wrapperClassName="w-[160px]">
              <option value="">{t('leaderboardPage.allDistances')}</option>
              {facets!.distances.map((d) => (
                <option key={d} value={d}>{d}m</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <SectionCard>
        {!stateId ? (
          <EmptyState
            title={t('leaderboardPage.noState')}
            description={t('leaderboardPage.noStateHint')}
          />
        ) : isLoading ? (
          <div className="py-10 text-center text-text-faint text-sm">{t('common.loading')}</div>
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-surface-soft">
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong w-10">#</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('roles.archer')}</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong hidden sm:table-cell">{t('common.school')}</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong hidden md:table-cell">{t('leaderboardPage.bow')}</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong hidden lg:table-cell">{t('leaderboardPage.category')}</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong hidden lg:table-cell">{t('leaderboardPage.distance')}</th>
                  <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong hidden md:table-cell">{t('leaderboardPage.ageGroup')}</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.score')}</th>
                  <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong hidden sm:table-cell">{t('common.date')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const isMe = row.archer_id === profile?.id
                  return (
                    <tr
                      key={`${row.archer_id}-${row.bow_category}-${row.round_category}-${row.distance_m}-${i}`}
                      className={cn(
                        'border-b border-line last:border-0',
                        isMe ? 'bg-primary-soft' : 'hover:bg-surface-soft',
                      )}
                    >
                      <td className="px-3 py-2.5 text-right">
                        {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : (
                          <span className="text-text-faint font-display font-semibold">{row.rank}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-text">{row.name}</div>
                        {row.age != null && (
                          <div className="text-[11px] text-text-faint uppercase">{t('common.age')} {row.age}</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-text-dim hidden sm:table-cell">{row.school}</td>
                      <td className="px-3 py-2.5 text-text-dim hidden md:table-cell capitalize">{row.bow_category}</td>
                      <td className="px-3 py-2.5 text-text-dim hidden lg:table-cell">
                        {row.round_category ? t(`roundCategories.${row.round_category}`) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-text-dim hidden lg:table-cell">{row.distance_m != null ? `${row.distance_m}m` : '—'}</td>
                      <td className="px-3 py-2.5 text-text-dim hidden md:table-cell">{row.age_group ? t(`ageGroups.${row.age_group.toLowerCase()}`) : '—'}</td>
                      <td className="px-3 py-2.5 text-right font-display font-semibold text-base">
                        {scoreDisplay(row.best_score, row.max_score)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-text-dim text-xs hidden sm:table-cell">{formatDate(row.date)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={t('leaderboardPage.empty')}
            description={t('leaderboardPage.emptyHint')}
          />
        )}

        {rows.length > 0 && (
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={pageIndex === 0 || isFetching}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            >
              {t('common.previous')}
            </Button>
            <span className="text-xs text-text-faint">
              {t('leaderboardPage.page', { page: pageIndex + 1 })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!page?.hasMore || isFetching}
              onClick={nextPage}
            >
              {t('common.next')}
            </Button>
          </div>
        )}

        {myRank != null && (
          <p className="text-xs text-text-faint mt-3 text-center">
            {t('leaderboardPage.yourRank')}: <span className="font-semibold text-primary">#{myRank}</span>
          </p>
        )}
      </SectionCard>
    </PageWrapper>
  )
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
        active ? 'bg-primary text-primary-on' : 'bg-section text-text-dim hover:bg-surface-soft',
      )}
    >
      {children}
    </button>
  )
}

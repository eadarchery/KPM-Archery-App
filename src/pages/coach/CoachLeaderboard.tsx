import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, EmptyState } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  getCoachLeaderboardPage,
  type CoachLeaderboardCursor,
} from '@/services/leaderboard'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'

/** Coaches-only leaderboard — every coach's own validated scores. */
export default function CoachLeaderboardPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCursors, setPageCursors] = useState<(CoachLeaderboardCursor | null)[]>([null])
  const pageCursor = pageCursors[pageIndex] ?? null

  const { data: page, isLoading, isFetching } = useQuery({
    queryKey: ['coach-leaderboard', pageCursor],
    staleTime: 60_000,
    queryFn: () => getCoachLeaderboardPage(pageCursor, 50),
  })
  const rows = page?.items ?? []

  const nextPage = () => {
    if (!page?.nextCursor) return
    setPageCursors((current) => [
      ...current.slice(0, pageIndex + 1),
      page.nextCursor,
    ])
    setPageIndex((current) => current + 1)
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('coachBoard.title')}
        description={t('coachBoard.description')}
      />

      <SectionCard>
        {isLoading ? (
          <p className="py-8 text-center text-text-faint text-sm">{t('common.loading')}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('coachBoard.empty')}
            description={t('coachBoard.emptyHint')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {['#', t('roles.coach'), t('common.school'), t('common.pld'), t('common.best'), '%', t('common.sessions'), t('coachBoard.lastShot')].map((h) => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint pb-2 pr-3 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const isMe = r.coach_id === profile?.id
                  return (
                    <tr key={r.coach_id} className={cn('transition-colors', isMe ? 'bg-primary-soft' : 'hover:bg-surface-soft')}>
                      <td className="py-2.5 pr-3 font-display font-bold text-text-dim">
                        {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold text-text whitespace-nowrap">
                        {r.coach_name}{isMe && <span className="text-primary text-xs font-normal"> · {t('coachBoard.you')}</span>}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-text-dim">{r.school_name ?? '—'}</td>
                      <td className="py-2.5 pr-3 text-xs text-text-dim">{r.pld_name ?? '—'}</td>
                      <td className="py-2.5 pr-3 font-mono font-semibold">{r.best_score}/{r.best_max}</td>
                      <td className="py-2.5 pr-3 font-semibold text-primary">{r.best_pct}%</td>
                      <td className="py-2.5 pr-3 text-text-dim">{r.sessions}</td>
                      <td className="py-2.5 text-xs text-text-dim whitespace-nowrap">{formatDate(r.last_date)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
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
              {t('coachBoard.page', { page: pageIndex + 1 })}
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
      </SectionCard>
    </PageWrapper>
  )
}

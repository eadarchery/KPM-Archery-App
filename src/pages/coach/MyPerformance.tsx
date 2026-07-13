import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, StatCard, EmptyState, SubmissionStatusBadge, Modal } from '@/components/ui'
import { ScoreTrendChart, DistanceSeriesChart, type DistancePoint } from '@/components/charts/TrendChart'
import { SessionDetailContent, type SessionDetailData } from '@/components/charts/SessionDetail'
import { ScoreEntryForm } from '@/components/forms/ScoreEntryForm'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { formatDate } from '@/utils/dates'
import { scoreDisplay, scorePct } from '@/utils/format'
import { computeGroupSpreadCm, type PlotData } from '@/utils/archery'
import type { ScoreSubmission } from '@/types'

/**
 * The coach's OWN scoring — separate from anything archer-related.
 * Coaches submit their own scores (validated by their PLD coach), and track
 * their personal trend exactly like archers do.
 */
export default function CoachMyPerformance() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const [submitOpen, setSubmitOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data: submissions = [], isLoading } = useQuery<ScoreSubmission[]>({
    queryKey: ['archer-submissions', profile?.id], // same key ScoreEntryForm invalidates
    enabled: !!profile?.id,
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_submissions')
        .select('*')
        .eq('archer_id', profile!.id)
        .order('date', { ascending: false })
      if (error) throw error
      const subs = (data ?? []) as Record<string, unknown>[]
      const roundIds = [...new Set(subs.map((s) => s.round_id as string).filter(Boolean))]
      if (!roundIds.length) return subs as unknown as ScoreSubmission[]
      const { data: rounds } = await supabase.from('rounds').select('*').in('id', roundIds)
      const rmap = new Map(((rounds ?? []) as { id: string }[]).map((r) => [r.id, r]))
      return subs.map((s) => ({
        ...s,
        round: s.round_id ? rmap.get(s.round_id as string) ?? null : null,
      })) as unknown as ScoreSubmission[]
    },
  })

  const approved = submissions.filter((s) => s.status === 'admin_approved')
  const pending  = submissions.filter((s) => s.status === 'pending')
  const best = approved.length
    ? approved.reduce((b, s) => (scorePct(s.total_score, s.max_score) > scorePct(b.total_score, b.max_score) ? s : b))
    : null

  const sorted = [...submissions].sort((a, b) =>
    (a.date + ((a as { session_time?: string }).session_time ?? ''))
      .localeCompare(b.date + ((b as { session_time?: string }).session_time ?? '')))
  const chartData = sorted.slice(-30).map((s) => ({
    date: s.date,
    time: (s as { session_time?: string }).session_time ?? null,
    score: s.total_score,
    maxScore: s.max_score,
    status: s.status,
    label: (s.round as { name?: string } | null)?.name,
  }))

  const distancePoints: DistancePoint[] = submissions.map((s) => ({
    id: s.id,
    date: s.date,
    time: (s as { session_time?: string }).session_time ?? null,
    value: scorePct(s.total_score, s.max_score),
    distance: (s.round as { distance_m?: number | null } | null)?.distance_m ?? null,
  }))

  const spreadPoints: DistancePoint[] = submissions.flatMap((s) => {
    const spread = computeGroupSpreadCm((s as { plot_data?: PlotData }).plot_data)
    if (spread == null) return []
    return [{
      id: s.id, date: s.date,
      time: (s as { session_time?: string }).session_time ?? null,
      value: spread,
      distance: (s.round as { distance_m?: number | null } | null)?.distance_m ?? null,
    }]
  })

  const detailSub = detailId ? submissions.find((s) => s.id === detailId) : null
  const detail: SessionDetailData | null = detailSub
    ? {
        date: detailSub.date,
        time: (detailSub as { session_time?: string }).session_time ?? null,
        roundName: (detailSub.round as { name?: string } | null)?.name ?? null,
        distanceM: (detailSub.round as { distance_m?: number | null } | null)?.distance_m ?? null,
        totalScore: detailSub.total_score,
        maxScore: detailSub.max_score,
        status: detailSub.status,
        notes: (detailSub as { notes?: string | null }).notes ?? null,
        arrowsData: (detailSub as { arrows_data?: (string | number)[] | null }).arrows_data ?? null,
        arrowsPerEnd: (detailSub.round as { arrows_per_end?: number | null } | null)?.arrows_per_end ?? null,
        plot: (detailSub as { plot_data?: PlotData }).plot_data ?? null,
      }
    : null

  if (!profile) return null

  return (
    <PageWrapper>
      <PageHead
        title={t('myPerf.title')}
        description={t('myPerf.description')}
        action={<Button variant="primary" onClick={() => setSubmitOpen(true)}>+ {t('myPerf.submitMyScore')}</Button>}
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('archerDash.bestScore')} value={best ? scoreDisplay(best.total_score, best.max_score) : '—'}
          sub={best ? formatDate(best.date) : t('archerDash.noValidatedYet')} />
        <StatCard label={t('common.sessions')} value={submissions.length} sub={`${approved.length} ${t('archerDash.validated')}`} />
        <StatCard label={t('myPerf.awaitingValidation')} value={pending.length}
          badge={pending.length} sub={t('myPerf.pldReviews')} />
        <StatCard label={t('myPerf.bestPct')} value={best ? `${scorePct(best.total_score, best.max_score)}%` : '—'} />
      </div>

      {/* Trend */}
      <SectionCard title={t('myPerf.myScoreTrend')} className="mb-6">
        {chartData.length ? (
          <ScoreTrendChart data={chartData} onPointClick={(i) => setDetailId(sorted.slice(-30)[i]?.id ?? null)} />
        ) : (
          <EmptyState title={t('charts.noSessions')} description={t('myPerf.startTrend')} />
        )}
      </SectionCard>

      {distancePoints.length > 1 && (
        <SectionCard title={t('archerDash.scoreByDistance')} className="mb-6">
          <DistanceSeriesChart points={distancePoints} onPointClick={setDetailId} />
        </SectionCard>
      )}

      {spreadPoints.length > 1 && (
        <SectionCard title={t('archerDash.spreadTrend')} className="mb-6">
          <DistanceSeriesChart
            points={spreadPoints} yUnit="cm" yDomain={['auto', 'auto']}
            betterNote={t('archerDash.spreadBetterNote')}
            onPointClick={setDetailId}
          />
        </SectionCard>
      )}

      {/* Recent submissions */}
      <SectionCard title={t('myPerf.mySubmissions')}>
        {isLoading ? (
          <p className="py-8 text-center text-text-faint text-sm">{t('common.loading')}</p>
        ) : submissions.length ? (
          <div className="space-y-2">
            {submissions.slice(0, 10).map((s) => (
              <div key={s.id}
                className="flex items-center justify-between p-3 rounded-[var(--r)] bg-surface-soft cursor-pointer hover:bg-surface-raised transition-colors"
                onClick={() => setDetailId(s.id)}
              >
                <div>
                  <div className="font-semibold text-sm">{(s.round as { name?: string } | null)?.name ?? t('common.score')}</div>
                  <div className="text-xs text-text-dim mt-0.5">{formatDate(s.date)}</div>
                </div>
                <div className="text-right">
                  <div className="font-display font-semibold text-lg">{scoreDisplay(s.total_score, s.max_score)}</div>
                  <SubmissionStatusBadge status={s.status} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t('archerDash.noSubmissionsYet')}
            description={t('myPerf.awaitAfterSubmit')}
            action={<Button variant="primary" size="sm" onClick={() => setSubmitOpen(true)}>{t('myPerf.submitMyScore')}</Button>} />
        )}
      </SectionCard>

      {/* Session detail */}
      <Modal
        open={!!detail}
        onClose={() => setDetailId(null)}
        title={detailSub ? `${t('sessionDetail.session')} · ${formatDate(detailSub.date)}` : t('sessionDetail.session')}
        width="min(480px,100%)"
      >
        {detail && <SessionDetailContent s={detail} />}
      </Modal>

      <ScoreEntryForm open={submitOpen} onClose={() => setSubmitOpen(false)} />
    </PageWrapper>
  )
}

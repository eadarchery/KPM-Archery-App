import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Button } from '@/components/ui'
import { PlusIcon, ClipboardIcon, ArrowIcon } from '@/components/ui/icons'
import { SubmissionStatusBadge } from '@/components/ui/Badge'
import { ScoreTrendChart, ArrowsBarChart, DistanceSeriesChart, type DistancePoint } from '@/components/charts/TrendChart'
import { SessionDetailContent, type SessionDetailData } from '@/components/charts/SessionDetail'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { ScoreEntryForm } from '@/components/forms/ScoreEntryForm'
import { TrainingLogForm } from '@/components/forms/TrainingLogForm'
import { listDrafts, deleteDraft } from '@/offline/drafts'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { scoreDisplay, scorePct } from '@/utils/format'
import { calcImprovementTrend, computeGroupSpreadCm, type PlotData } from '@/utils/archery'
import { formatDate, daysAgo } from '@/utils/dates'
import type { ScoreSubmission, TrainingLog } from '@/types'

type TrendWindow = '7d' | '30d' | '90d' | '6m' | '1y'
type ActiveCard = 'best' | 'sessions' | 'arrows' | null

const TREND_WINDOWS: { key: TrendWindow; label: string; days: number }[] = [
  { key: '7d',  label: '7d',  days: 7 },
  { key: '30d', label: '30d', days: 30 },
  { key: '90d', label: '90d', days: 90 },
  { key: '6m',  label: '6m',  days: 182 },
  { key: '1y',  label: '1y',  days: 365 },
]

export default function ArcherDashboard() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const queryClient = useQueryClient()
  const [trendWindow, setTrendWindow] = useState<TrendWindow>('30d')
  const [activeCard, setActiveCard] = useState<ActiveCard>(null)
  const [submitOpen, setSubmitOpen]   = useState(false)
  const [trainingOpen, setTrainingOpen] = useState(false)
  const [plotSessionId, setPlotSessionId] = useState<string | null>(null)
  const [resumeDraftId, setResumeDraftId] = useState<string | undefined>(undefined)

  // Local score drafts (saved on this device from the submit form).
  const { data: drafts = [] } = useQuery({
    queryKey: ['score-drafts'],
    queryFn: () => listDrafts('score_submission'),
    staleTime: 0,
  })
  const removeDraft = async (id: string) => {
    await deleteDraft(id)
    queryClient.invalidateQueries({ queryKey: ['score-drafts'] })
  }

  // Fetch submissions
  const { data: submissions = [], isLoading: loadingSessions } = useQuery<ScoreSubmission[]>({
    queryKey: ['archer-submissions', profile?.id],
    enabled: !!profile?.id,
    // Always refetch when the dashboard opens so a coach's approval shows up
    // (there is no cross-user realtime invalidation).
    staleTime: 0,
    refetchOnMount: 'always',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_submissions')
        .select('*')
        .eq('archer_id', profile!.id)
        .order('date', { ascending: false })
      if (error) throw error
      // Resolve rounds separately (PostgREST embedding fails through the views).
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

  // Fetch training logs
  const { data: trainingLogs = [] } = useQuery<TrainingLog[]>({
    queryKey: ['archer-training', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_logs')
        .select('*')
        .eq('archer_id', profile!.id)
        .order('date', { ascending: false })
      if (error) throw error
      return data as TrainingLog[]
    },
  })

  // Derived stats
  const validatedSubmissions = submissions.filter((s) => s.status === 'admin_approved')
  const bestScore = validatedSubmissions.length
    ? validatedSubmissions.reduce((best, s) =>
        scorePct(s.total_score, s.max_score) > scorePct(best.total_score, best.max_score) ? s : best,
      )
    : null

  const totalArrows = trainingLogs.reduce((sum, t) => sum + t.arrows_shot, 0)
    + submissions.reduce((sum, s) => sum + ((s.round as any)?.total_arrows ?? 0), 0)

  const lastTrainingDate = trainingLogs[0]?.date ?? submissions[0]?.date

  const trendDays = TREND_WINDOWS.find((w) => w.key === trendWindow)?.days ?? 30
  const trendPct = calcImprovementTrend(validatedSubmissions, trendDays)

  // Plot every submitted session (pending + approved) inside the selected
  // window, each dot coloured by status; multiple sessions a day stay distinct
  // via session_time. Capped at the most recent 60 points for readability.
  const windowCutoff = daysAgo(trendDays)
  const trendSessions = [...submissions]
    .filter((s) => s.date >= windowCutoff)
    .sort((a, b) =>
      (a.date + ((a as { session_time?: string }).session_time ?? ''))
        .localeCompare(b.date + ((b as { session_time?: string }).session_time ?? '')),
    )
    .slice(-60)
  const chartData = trendSessions.map((s) => ({
    date: s.date,
    time: (s as { session_time?: string }).session_time ?? null,
    score: s.total_score,
    maxScore: s.max_score,
    status: s.status,
    label: (s.round as { name?: string } | null)?.name,
  }))

  const trainingChartData = [...trainingLogs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-20)
    .map((t) => ({ date: t.date, arrows: t.arrows_shot, note: t.notes }))

  // Score by distance — every session as % of the round's max (normalises
  // 300 vs 360-point formats), split by shooting distance.
  const distancePoints: DistancePoint[] = submissions.map((s) => ({
    id: s.id,
    date: s.date,
    time: (s as { session_time?: string }).session_time ?? null,
    value: scorePct(s.total_score, s.max_score),
    distance: (s.round as { distance_m?: number | null } | null)?.distance_m ?? null,
  }))

  // Group spread (cm) per plotted session — only sessions with plot data.
  const spreadPoints: DistancePoint[] = submissions.flatMap((s) => {
    const spread = computeGroupSpreadCm((s as { plot_data?: PlotData }).plot_data)
    if (spread == null) return []
    return [{
      id: s.id,
      date: s.date,
      time: (s as { session_time?: string }).session_time ?? null,
      value: spread,
      distance: (s.round as { distance_m?: number | null } | null)?.distance_m ?? null,
    }]
  })

  const plotSession = plotSessionId ? submissions.find((s) => s.id === plotSessionId) : null
  const sessionDetail: SessionDetailData | null = plotSession
    ? {
        date: plotSession.date,
        time: (plotSession as { session_time?: string }).session_time ?? null,
        roundName: (plotSession.round as { name?: string } | null)?.name ?? null,
        distanceM: (plotSession.round as { distance_m?: number | null } | null)?.distance_m ?? null,
        totalScore: plotSession.total_score,
        maxScore: plotSession.max_score,
        status: plotSession.status,
        notes: (plotSession as { notes?: string | null }).notes ?? null,
        arrowsData: (plotSession as { arrows_data?: (string | number)[] | null }).arrows_data ?? null,
        arrowsPerEnd: (plotSession.round as { arrows_per_end?: number | null } | null)?.arrows_per_end ?? null,
        plot: (plotSession as { plot_data?: PlotData }).plot_data ?? null,
      }
    : null

  // Visual-only data for the enhanced stat cards (reuses computed values above).
  const scoreMiniData = chartData
    .map((d) => (d.maxScore ? Math.round((d.score / d.maxScore) * 100) : 0))
    .slice(-12)
  const arrowsMiniData = trainingChartData.map((d) => d.arrows).slice(-12)
  const sessionsProgressPct = submissions.length
    ? Math.round((validatedSubmissions.length / submissions.length) * 100)
    : 0
  const bestScorePct = bestScore ? scorePct(bestScore.total_score, bestScore.max_score) : null

  if (!profile) return null

  return (
    <PageWrapper>
      <PageHead
        title={t('archerDash.welcome', { name: profile.name?.split(' ')[0] ?? t('roles.archer') })}
        description={t('archerDash.description')}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setTrainingOpen(true)}>
              <ArrowIcon /> {t('archerDash.logTraining')}
            </Button>
            <Button variant="primary" onClick={() => setSubmitOpen(true)}>
              <PlusIcon /> {t('scoreEntry.submitScore')}
            </Button>
          </div>
        }
      />

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label={t('archerDash.improvementTrend')}
          value={
            <span className={trendPct > 0 ? 'text-success' : trendPct < 0 ? 'text-danger' : 'text-text-faint'}>
              {trendPct > 0 ? '+' : ''}{trendPct}%
            </span>
          }
          sub={`${t('archerDash.lastWindow')} ${trendWindow}`}
          tone={trendPct > 0 ? 'success' : trendPct < 0 ? 'danger' : 'neutral'}
          trend={trendPct > 0 ? 'up' : trendPct < 0 ? 'down' : 'flat'}
          trendLabel={trendWindow}
          miniChartData={scoreMiniData}
          icon={<TrendIcon />}
        />
        <StatCard
          label={t('archerDash.bestScore')}
          value={bestScore ? scoreDisplay(bestScore.total_score, bestScore.max_score) : '—'}
          sub={bestScore ? formatDate(bestScore.date) : t('archerDash.noValidatedYet')}
          clickable
          active={activeCard === 'best'}
          onClick={() => setActiveCard(activeCard === 'best' ? null : 'best')}
          tone="success"
          progressPct={bestScorePct}
          icon={<TrophyIcon />}
        />
        <StatCard
          label={t('archerDash.totalSessions')}
          value={submissions.length}
          sub={`${validatedSubmissions.length} ${t('archerDash.validated')}`}
          clickable
          active={activeCard === 'sessions'}
          onClick={() => setActiveCard(activeCard === 'sessions' ? null : 'sessions')}
          tone="primary"
          progressPct={sessionsProgressPct}
          icon={<ClipboardIcon />}
        />
        <StatCard
          label={t('archerDash.totalArrows')}
          value={totalArrows.toLocaleString()}
          sub={lastTrainingDate ? `${t('talents.last')}: ${formatDate(lastTrainingDate)}` : t('archerDash.logToTrack')}
          clickable
          active={activeCard === 'arrows'}
          onClick={() => setActiveCard(activeCard === 'arrows' ? null : 'arrows')}
          tone="warning"
          miniChartData={arrowsMiniData}
          icon={<ArrowIcon />}
        />
      </div>

      {/* ── SAVED DRAFTS (device-local) ── */}
      {drafts.length > 0 && (
        <SectionCard title={t('archerDash.scoreDrafts')} className="mb-6">
          <div className="space-y-2">
            {[...drafts]
              .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
              .map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between gap-2 p-3 rounded-[var(--r)] bg-surface-soft"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{d.label}</div>
                    <div className="text-xs text-text-dim mt-0.5">
                      {t('archerDash.savedOn')} {formatDate(d.updated_at.slice(0, 10))}
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setResumeDraftId(d.id)
                        setSubmitOpen(true)
                      }}
                    >
                      {t('archerDash.resume')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeDraft(d.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              ))}
          </div>
          <p className="text-xs text-text-faint mt-3">
            {t('archerDash.draftsHint')}
          </p>
        </SectionCard>
      )}

      {/* ── SCORE TREND (always visible) ── */}
      <SectionCard
        title={t('archerDash.scoreTrend')}
        action={
          <div className="flex gap-1 flex-wrap">
            {TREND_WINDOWS.map((w) => (
              <button
                key={w.key}
                onClick={() => setTrendWindow(w.key)}
                className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${trendWindow === w.key ? 'bg-primary text-primary-on' : 'bg-section text-text-dim hover:bg-surface-soft'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
        className="mb-6"
      >
        {chartData.length ? (
          <ScoreTrendChart
            data={chartData}
            dimUnvalidated
            onPointClick={(i) => setPlotSessionId(trendSessions[i]?.id ?? null)}
          />
        ) : (
          <EmptyState
            title={t('archerDash.noSessionsWindow')}
            description={t('archerDash.noSessionsWindowHint')}
          />
        )}
        <p className="text-xs text-text-faint mt-3">
          {t('archerDash.trendHint')}
        </p>
      </SectionCard>

      {/* ── SCORE BY DISTANCE ── */}
      {distancePoints.length > 1 && (
        <SectionCard title={t('archerDash.scoreByDistance')} className="mb-6">
          <DistanceSeriesChart points={distancePoints} onPointClick={setPlotSessionId} />
          <p className="text-xs text-text-faint mt-2">
            {t('archerDash.distanceHint')}
          </p>
        </SectionCard>
      )}

      {/* ── GROUP SPREAD (plotted sessions only) ── */}
      {spreadPoints.length > 1 && (
        <SectionCard title={t('archerDash.spreadTrend')} className="mb-6">
          <DistanceSeriesChart
            points={spreadPoints}
            yUnit="cm"
            yDomain={['auto', 'auto']}
            betterNote={t('archerDash.spreadBetterNote')}
            onPointClick={setPlotSessionId}
          />
          <p className="text-xs text-text-dim mt-2">
            <strong className="text-warning">{t('archerDash.spreadWorse')}</strong>{' '}
            {t('archerDash.spreadHint')}
          </p>
        </SectionCard>
      )}

      {/* Session detail viewer — shared by all three charts */}
      <Modal
        open={!!sessionDetail}
        onClose={() => setPlotSessionId(null)}
        title={plotSession ? `${t('sessionDetail.session')} · ${formatDate(plotSession.date)}` : t('sessionDetail.session')}
        width="min(480px,100%)"
      >
        {sessionDetail && <SessionDetailContent s={sessionDetail} />}
      </Modal>

      {/* ── DETAIL PANEL ── */}
      {activeCard === 'best' && (
        <SectionCard title={t('archerDash.bestScores')} className="mb-6 animate-fade-up">
          {validatedSubmissions.length ? (
            <div className="table-wrap">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.date')}</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.round')}</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.score')}</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">%</th>
                  </tr>
                </thead>
                <tbody>
                  {[...validatedSubmissions]
                    .sort((a, b) => scorePct(b.total_score, b.max_score) - scorePct(a.total_score, a.max_score))
                    .slice(0, 10)
                    .map((s) => (
                      <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface-soft">
                        <td className="px-3 py-2.5 text-text-dim">{formatDate(s.date)}</td>
                        <td className="px-3 py-2.5 text-text-dim">{(s.round as any)?.name ?? s.round_id}</td>
                        <td className="px-3 py-2.5 text-right font-display font-semibold">{scoreDisplay(s.total_score, s.max_score)}</td>
                        <td className="px-3 py-2.5 text-right text-text-dim">{scorePct(s.total_score, s.max_score)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('archerDash.noValidatedYet')} />
          )}
        </SectionCard>
      )}

      {activeCard === 'sessions' && (
        <SectionCard title={t('archerDash.scoreHistory')} className="mb-6 animate-fade-up">
          {submissions.length ? (
            <div className="table-wrap">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-surface-soft">
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.date')}</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.round')}</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.score')}</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.slice(0, 20).map((s) => (
                    <tr key={s.id} className="border-b border-line last:border-0 hover:bg-surface-soft">
                      <td className="px-3 py-2.5 text-text-dim">{formatDate(s.date)}</td>
                      <td className="px-3 py-2.5 text-text-dim">{(s.round as any)?.name ?? s.round_id}</td>
                      <td className="px-3 py-2.5 text-right font-display font-semibold">{scoreDisplay(s.total_score, s.max_score)}</td>
                      <td className="px-3 py-2.5">
                        <SubmissionStatusBadge status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('archerDash.noScoresYet')} description={t('archerDash.noScoresYetHint')} />
          )}
        </SectionCard>
      )}

      {activeCard === 'arrows' && (
        <SectionCard title={t('archerDash.trainingArrowLog')} className="mb-6 animate-fade-up">
          {trainingChartData.length ? (
            <ArrowsBarChart data={trainingChartData} />
          ) : (
            <EmptyState title={t('archerDash.noTrainingYet')} description={t('archerDash.noTrainingYetHint')} />
          )}
        </SectionCard>
      )}

      {/* ── RECENT ACTIVITY ── */}
      <SectionCard title={t('archerDash.recentSubmissions')}>
        {loadingSessions ? (
          <div className="py-8 text-center text-text-faint text-sm">{t('common.loading')}</div>
        ) : submissions.length ? (
          <div className="space-y-2">
            {submissions.slice(0, 5).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-3 rounded-[var(--r)] bg-surface-soft"
              >
                <div>
                  <div className="font-semibold text-sm">{(s.round as any)?.name ?? t('common.score')}</div>
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
          <EmptyState
            title={t('archerDash.noSubmissionsYet')}
            description={t('archerDash.noScoresYetHint')}
            action={<Button variant="primary" size="sm" onClick={() => setSubmitOpen(true)}>{t('scoreEntry.submitScore')}</Button>}
          />
        )}
      </SectionCard>

      <ScoreEntryForm
        open={submitOpen}
        draftId={resumeDraftId}
        onClose={() => {
          setSubmitOpen(false)
          setResumeDraftId(undefined)
          queryClient.invalidateQueries({ queryKey: ['score-drafts'] })
        }}
      />
      <TrainingLogForm open={trainingOpen} onClose={() => setTrainingOpen(false)} />
    </PageWrapper>
  )
}

// ── Icons (page-specific — shared ones come from @/components/ui/icons) ───────
function TrendIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 17 9 11 13 15 21 7"/><polyline points="15 7 21 7 21 13"/></svg> }
function TrophyIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 0 0 5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 1 0 5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg> }

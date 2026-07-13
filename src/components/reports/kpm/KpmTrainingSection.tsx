import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui'
import { MultiSeriesChart, ArrowsBarChart } from '@/components/charts/TrendChart'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmTrainingActivity, getKpmTrainingTrend, getKpmTrainingBreakdown,
  type KpmTrainingGroupBy, type KpmTrainingBreakdownRow, type KpmTrainingTrendPoint,
} from '@/services/kpmMetrics'
import {
  fmtNum, GroupBySelect, KpmBackendNotice, groupRowLabel, ExplainBox, ORG_DIMS, DEMO_DIMS,
} from './shared'
import { TrainingCardModal, ArrowsMonthModal, type TrainingSeriesPoint } from './KpmTrainingModals'

/**
 * Section 2 — Training Activity (KPM Q6: are training programs active?).
 * All aggregation happens in kpm_training_summary / _trend / _breakdown
 * (migration 062) — this component only renders the returned rows.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const GROUP_OPTS: { value: KpmTrainingGroupBy; labelKey: string }[] = [
  { value: 'session_type', labelKey: 'kpm.training.sessionType' },
  ...ORG_DIMS,
  { value: 'coach', labelKey: 'roles.coach' },
  ...DEMO_DIMS,
]

const columns = (t: Translate, groupBy: KpmTrainingGroupBy): Column<KpmTrainingBreakdownRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => <span className="font-medium text-text">{groupRowLabel(t, groupBy, r.group_label ?? r.group_key)}</span>,
  },
  { key: 'sessions', header: t('common.sessions'),            render: (r) => r.sessions, align: 'right' },
  { key: 'arrows',   header: t('stateReport.trainingArrows'), render: (r) => r.arrows, align: 'right' },
  { key: 'avg',      header: t('kpm.training.avgArrows'),     render: (r) => fmtNum(r.avg_arrows), align: 'right', hide: 'sm' },
  { key: 'archers',  header: t('nav.archers'),                render: (r) => r.archers, align: 'right' },
  { key: 'coaches',  header: t('nav.coaches'),                render: (r) => r.coaches, align: 'right', hide: 'md' },
]

export function KpmTrainingSection({
  filters, defaultGroupBy = 'session_type',
}: {
  filters: ReportFilters
  defaultGroupBy?: KpmTrainingGroupBy
}) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const [groupBy, setGroupBy] = useState<KpmTrainingGroupBy>(defaultGroupBy)
  const [cardPick, setCardPick] = useState<Parameters<typeof TrainingCardModal>[0]['pick']>(null)
  const [arrowsMonth, setArrowsMonth] = useState<string | null>(null)

  const { data: summary, error: e1 } = useQuery({
    queryKey: ['kpm-train-sum', fkey],
    queryFn: () => getKpmTrainingActivity(filters),
    staleTime: 120_000,
  })
  const { data: trend = [], error: e2 } = useQuery({
    queryKey: ['kpm-train-trend', fkey],
    queryFn: () => getKpmTrainingTrend(filters, 'month'),
    staleTime: 120_000,
  })
  const { data: rows = [], error: e3 } = useQuery({
    queryKey: ['kpm-train-bd', groupBy, fkey],
    queryFn: () => getKpmTrainingBreakdown(groupBy, filters),
    staleTime: 120_000,
  })

  const backendError = e1 ?? e2 ?? e3

  // Each card's own relative data: the metric broken down by month (from trend).
  const s = (fn: (p: KpmTrainingTrendPoint) => number): TrainingSeriesPoint[] =>
    trend.map((p) => ({ bucket: p.bucket, value: fn(p) }))

  return (
    <>
      {backendError != null && <KpmBackendNotice migrations="062" error={backendError} />}

      <ExplainBox>{t('kpm.explain.training')}</ExplainBox>

      {/* Summary cards — click any for how it's built + its own monthly data */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 mb-1">
        <StatCard label={t('kpm.training.totalSessions')}  value={fmtNum(summary?.total_sessions)}
          tone="primary"
          miniChartData={trend.map((p) => p.sessions)}
          onClick={() => setCardPick({ title: t('kpm.training.totalSessions'), value: fmtNum(summary?.total_sessions), howKey: 'kpm.training.how.sessions', seriesLabel: t('kpm.training.sessionsByMonth'), series: s((p) => p.sessions) })} />
        <StatCard label={t('kpm.training.totalArrows')}    value={fmtNum(summary?.total_arrows)} accent
          miniChartData={trend.map((p) => p.arrows)}
          onClick={() => setCardPick({ title: t('kpm.training.totalArrows'), value: fmtNum(summary?.total_arrows), howKey: 'kpm.training.how.arrows', seriesLabel: t('kpm.training.arrowsByMonth'), series: s((p) => p.arrows) })} />
        <StatCard label={t('kpm.training.avgArrows')}      value={fmtNum(summary?.avg_arrows_per_session)} sub={t('kpm.training.perSession')}
          tone="neutral"
          onClick={() => setCardPick({ title: t('kpm.training.avgArrows'), value: fmtNum(summary?.avg_arrows_per_session), howKey: 'kpm.training.how.avg', seriesLabel: t('kpm.training.avgByMonth'), series: s((p) => (p.sessions ? Math.round(p.arrows / p.sessions) : 0)) })} />
        <StatCard label={t('kpm.training.activeArchers')}  value={fmtNum(summary?.active_training_archers)}
          tone="success"
          miniChartData={trend.map((p) => p.archers)}
          onClick={() => setCardPick({ title: t('kpm.training.activeArchers'), value: fmtNum(summary?.active_training_archers), howKey: 'kpm.training.how.archers', seriesLabel: t('kpm.training.archersByMonth'), series: s((p) => p.archers) })} />
        <StatCard label={t('kpm.training.activeCoaches')}  value={fmtNum(summary?.active_training_coaches)}
          tone="success"
          onClick={() => setCardPick({ title: t('kpm.training.activeCoaches'), value: fmtNum(summary?.active_training_coaches), howKey: 'kpm.training.how.coaches', noteKey: 'kpm.training.coachesNote' })} />
      </div>
      <p className="text-[11px] text-text-faint mb-6">{t('kpm.training.clickCardHint')}</p>

      {/* Trend charts (monthly buckets from the DB) */}
      <SectionCard title={t('kpm.training.arrowsTrend')} className="mb-6">
        {trend.length ? (
          <ArrowsBarChart data={trend.map((p) => ({ date: p.bucket, arrows: p.arrows }))} onBarClick={setArrowsMonth} />
        ) : (
          <EmptyState title={t('kpm.training.noData')} />
        )}
        <p className="text-[11px] text-text-faint mt-2">{t('kpm.training.clickBarHint')}</p>
      </SectionCard>

      <SectionCard title={t('kpm.training.sessionsTrend')} className="mb-6">
        {trend.length ? (
          <MultiSeriesChart
            data={trend.map((p) => ({ date: p.bucket, sessions: p.sessions, archers: p.archers }))}
            series={[
              { key: 'sessions', label: t('common.sessions'), color: '#ff6a18' },
              { key: 'archers',  label: t('nav.archers'),  color: '#3d8bff' },
            ]}
          />
        ) : (
          <EmptyState title={t('kpm.training.noData')} />
        )}
      </SectionCard>

      {/* Breakdown */}
      <SectionCard title={t('kpm.training.breakdown')} className="mb-6">
        <GroupBySelect value={groupBy} onChange={setGroupBy} options={GROUP_OPTS} />
        <BreakdownTable<KpmTrainingBreakdownRow>
          rows={rows}
          getKey={(r) => `${r.group_key ?? r.group_label ?? 'null'}`}
          emptyTitle={t('kpm.training.noData')}
          columns={columns(t, groupBy)}
        />
      </SectionCard>

      {/* Card drill-down: how it's built + the metric month-by-month */}
      <TrainingCardModal pick={cardPick} onClose={() => setCardPick(null)} />

      {/* Bar click: that month's arrows broken down by state / PLD / school */}
      <ArrowsMonthModal bucket={arrowsMonth} filters={filters} onClose={() => setArrowsMonth(null)} />
    </>
  )
}

export default KpmTrainingSection

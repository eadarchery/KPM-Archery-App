import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui'
import { MultiSeriesChart } from '@/components/charts/TrendChart'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmScoreSummary, getKpmScoreTrend, getKpmScoreImprovement,
  getKpmScoreImprovementBreakdown, getKpmPracticeTournamentComparison, getKpmScoresList,
  type KpmScoreGroupBy, type KpmScoreImprovementBreakdownRow,
  type KpmScoreImprovementRow, type KpmPracticeTournamentRow,
} from '@/services/kpmMetrics'
import {
  fmtNum, fmtPct, fmtPp, GroupBySelect, KpmBackendNotice, ShowingNote,
  groupRowLabel, roundCatLabel, ORG_DIMS, DEMO_DIMS,
} from './shared'
import { PerfMetricModal, ScoresListModal, TrendMonthModal } from './KpmPerformanceModals'

/**
 * Section 5 — Performance & Improvement (KPM Q3: are archers improving?).
 * OFFICIAL comparison is score PERCENTAGE (total / max), normalised by the
 * migration 065 RPCs; raw scores are context only and never compared across
 * rounds here. Improvement (latest − first, in percentage points) is computed
 * per archer in the database.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const GROUP_OPTS: { value: KpmScoreGroupBy; labelKey: string }[] = [
  ...ORG_DIMS,
  { value: 'coach', labelKey: 'roles.coach' },
  ...DEMO_DIMS,
  { value: 'round_category', labelKey: 'kpm.common.roundCategory' },
  { value: 'distance',       labelKey: 'kpm.common.distance' },
]

const LIST_LIMIT = 15

const improvementBdColumns = (t: Translate, groupBy: KpmScoreGroupBy): Column<KpmScoreImprovementBreakdownRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => <span className="font-medium text-text">{groupRowLabel(t, groupBy, r.group_label ?? r.group_key)}</span>,
  },
  { key: 'archers',   header: t('nav.archers'),             render: (r) => r.archers, align: 'right' },
  { key: 'first',     header: t('kpm.performance.firstPct'),  render: (r) => fmtPct(r.avg_first_pct), align: 'right', hide: 'sm' },
  { key: 'latest',    header: t('kpm.performance.latestPct'), render: (r) => fmtPct(r.avg_latest_pct), align: 'right', hide: 'sm' },
  { key: 'impr',      header: t('kpm.performance.avgImprovement'), render: (r) => fmtPp(r.avg_improvement_pp), align: 'right' },
  { key: 'improving', header: t('kpm.performance.improving'), render: (r) => <span className="text-success">{r.improving}</span>, align: 'right' },
  { key: 'declining', header: t('kpm.performance.declining'), render: (r) => <span className="text-danger">{r.declining}</span>, align: 'right' },
]

const compareColumns = (t: Translate): Column<KpmPracticeTournamentRow>[] => [
  { key: 'bucket',  header: t('kpm.common.roundCategory'), render: (r) => <span className="font-medium text-text">{roundCatLabel(t, r.bucket)}</span> },
  { key: 'scores',  header: t('common.scores'),  render: (r) => r.scores, align: 'right' },
  { key: 'archers', header: t('nav.archers'),    render: (r) => r.archers, align: 'right', hide: 'sm' },
  { key: 'avg',     header: t('kpm.common.avgPct'),    render: (r) => fmtPct(r.avg_score_pct), align: 'right' },
  { key: 'median',  header: t('kpm.performance.medianPct'), render: (r) => fmtPct(r.median_score_pct), align: 'right', hide: 'sm' },
  { key: 'best',    header: t('kpm.common.bestPct'),   render: (r) => fmtPct(r.best_score_pct), align: 'right' },
]

const improversColumns = (t: Translate): Column<KpmScoreImprovementRow>[] => [
  {
    key: 'archer', header: t('roles.archer'),
    render: (r) => (
      <span>
        <span className="font-medium text-text">{r.archer_name ?? '—'}</span>
        {r.archer_code && <span className="text-text-faint text-xs ml-1.5">{r.archer_code}</span>}
      </span>
    ),
  },
  { key: 'n',      header: t('common.scores'), render: (r) => r.n_scores, align: 'right', hide: 'sm' },
  { key: 'first',  header: t('kpm.performance.firstPct'),  render: (r) => fmtPct(r.first_pct), align: 'right' },
  { key: 'latest', header: t('kpm.performance.latestPct'), render: (r) => fmtPct(r.latest_pct), align: 'right' },
  { key: 'best',   header: t('kpm.common.bestPct'), render: (r) => fmtPct(r.best_pct), align: 'right', hide: 'sm' },
  {
    key: 'impr', header: t('overview.improvement'), align: 'right',
    render: (r) => (
      <span className={r.improvement_pp != null && r.improvement_pp > 0 ? 'text-success font-semibold' : r.improvement_pp != null && r.improvement_pp < 0 ? 'text-danger' : ''}>
        {fmtPp(r.improvement_pp)}
      </span>
    ),
  },
]

export function KpmPerformanceSection({
  filters, defaultGroupBy = 'state',
}: {
  filters: ReportFilters
  defaultGroupBy?: KpmScoreGroupBy
}) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const [groupBy, setGroupBy] = useState<KpmScoreGroupBy>(defaultGroupBy)
  const [metric, setMetric] = useState<{ title: string; value: React.ReactNode; howKey: string } | null>(null)
  const [funnelPick, setFunnelPick] = useState<{ status: string | null; title: string; explainKey: string } | null>(null)
  const [monthPick, setMonthPick] = useState<{ bucket: string; avg: number | null; median: number | null; best: number | null } | null>(null)

  const { data: s, error: e1 } = useQuery({
    queryKey: ['kpm-perf-sum', fkey],
    queryFn: () => getKpmScoreSummary(filters),
    staleTime: 120_000,
  })
  const { data: trend = [], error: e2 } = useQuery({
    queryKey: ['kpm-perf-trend', fkey],
    queryFn: () => getKpmScoreTrend(filters, 'month'),
    staleTime: 120_000,
  })
  const { data: comparison = [], error: e3 } = useQuery({
    queryKey: ['kpm-perf-compare', fkey],
    queryFn: () => getKpmPracticeTournamentComparison(filters),
    staleTime: 120_000,
  })
  const { data: bdRows = [], error: e4 } = useQuery({
    queryKey: ['kpm-perf-bd', groupBy, fkey],
    queryFn: () => getKpmScoreImprovementBreakdown(groupBy, filters),
    staleTime: 120_000,
  })
  const { data: improvement = [], error: e5 } = useQuery({
    queryKey: ['kpm-perf-impr', fkey],
    queryFn: () => getKpmScoreImprovement(filters),
    staleTime: 120_000,
  })
  // Actual submission list — only fetched once a funnel card is opened.
  const { data: scoresList = [], isFetching: scoresLoading } = useQuery({
    queryKey: ['kpm-perf-scores', fkey],
    queryFn: () => getKpmScoresList(filters),
    staleTime: 120_000,
    enabled: funnelPick != null || monthPick != null,
  })

  const backendError = e1 ?? e2 ?? e3 ?? e4 ?? e5

  // Display selection only: DB-computed improvement, sorted for the shortlist.
  const topImprovers = useMemo(
    () => improvement
      .filter((r) => r.improvement_pp != null)
      .sort((a, b) => (b.improvement_pp ?? 0) - (a.improvement_pp ?? 0))
      .slice(0, LIST_LIMIT),
    [improvement],
  )

  return (
    <>
      {backendError != null && <KpmBackendNotice migrations="065" error={backendError} />}

      <p className="text-xs text-text-dim bg-surface-soft border border-line rounded-[var(--r-sm)] px-3 py-2 mb-4">
        {t('kpm.performance.pctNote')}
      </p>

      {/* Normalised performance cards — click any to see how it's calculated */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-1">
        <StatCard label={t('kpm.common.avgPct')}              value={fmtPct(s?.avg_score_pct)} accent
          progressPct={s?.avg_score_pct ?? null}
          onClick={() => setMetric({ title: t('kpm.common.avgPct'), value: fmtPct(s?.avg_score_pct), howKey: 'kpm.performance.how.avgPct' })} />
        <StatCard label={t('kpm.performance.medianPct')}      value={fmtPct(s?.median_score_pct)}
          tone="primary"
          progressPct={s?.median_score_pct ?? null}
          onClick={() => setMetric({ title: t('kpm.performance.medianPct'), value: fmtPct(s?.median_score_pct), howKey: 'kpm.performance.how.medianPct' })} />
        <StatCard label={t('kpm.performance.highestPct')}     value={fmtPct(s?.highest_score_pct)}
          tone="success"
          progressPct={s?.highest_score_pct ?? null}
          onClick={() => setMetric({ title: t('kpm.performance.highestPct'), value: fmtPct(s?.highest_score_pct), howKey: 'kpm.performance.how.highestPct' })} />
        <StatCard label={t('kpm.performance.avgImprovement')} value={fmtPp(s?.avg_improvement_pp)} sub={t('kpm.performance.firstToLatest')}
          tone={(s?.avg_improvement_pp ?? 0) > 0 ? 'success' : (s?.avg_improvement_pp ?? 0) < 0 ? 'danger' : 'neutral'}
          trend={(s?.avg_improvement_pp ?? 0) > 0 ? 'up' : (s?.avg_improvement_pp ?? 0) < 0 ? 'down' : 'flat'}
          onClick={() => setMetric({ title: t('kpm.performance.avgImprovement'), value: fmtPp(s?.avg_improvement_pp), howKey: 'kpm.performance.how.avgImprovement' })} />
        <StatCard label={t('kpm.performance.improving')}      value={<span className="text-success">{fmtNum(s?.archers_improving)}</span>}
          tone="success"
          trend="up"
          onClick={() => setMetric({ title: t('kpm.performance.improving'), value: fmtNum(s?.archers_improving), howKey: 'kpm.performance.how.improving' })} />
        <StatCard label={t('kpm.performance.declining')}      value={<span className="text-danger">{fmtNum(s?.archers_declining)}</span>}
          tone="danger"
          trend="down"
          onClick={() => setMetric({ title: t('kpm.performance.declining'), value: fmtNum(s?.archers_declining), howKey: 'kpm.performance.how.declining' })} />
      </div>
      <p className="text-[11px] text-text-faint mb-4">{t('kpm.performance.clickCardHint')}</p>

      {/* Verification funnel — click a card to pinpoint the actual submissions */}
      <SectionCard title={t('kpm.performance.funnelTitle')} className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            [t('kpm.performance.totalScores'), s?.total_scores, 'text-text',    null,             'kpm.performance.funnelExplain.submitted'],
            [t('kpm.performance.verified'),    s?.scores_verified, 'text-success', 'admin_approved', 'kpm.performance.funnelExplain.verified'],
            [t('status.coachApproved'),        s?.scores_coach_approved, 'text-primary', 'coach_approved', 'kpm.performance.funnelExplain.coachApproved'],
            [t('status.pending'),              s?.scores_pending, 'text-warning',  'pending',        'kpm.performance.funnelExplain.pending'],
            [t('status.rejected'),             s?.scores_rejected, 'text-danger',   'rejected',       'kpm.performance.funnelExplain.rejected'],
          ] as const).map(([label, value, cls, status, explainKey]) => (
            <button
              key={label}
              type="button"
              onClick={() => setFunnelPick({ status, title: t('kpm.performance.scoresListTitle', { label }), explainKey })}
              className="rounded-[var(--r)] border border-line bg-surface p-4 text-center transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className={`font-display font-semibold text-[26px] leading-none ${cls}`}>{fmtNum(value)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-text-faint mt-2">{label}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-faint mt-3">{t('kpm.performance.clickFunnelHint')}</p>
      </SectionCard>

      {/* Normalised score % trend */}
      <SectionCard title={t('kpm.performance.trendTitle')} className="mb-6">
        {trend.length ? (
          <MultiSeriesChart
            data={trend.map((p) => ({
              date: p.bucket,
              avg: p.avg_score_pct ?? 0,
              median: p.median_score_pct ?? 0,
              best: p.best_score_pct ?? 0,
            }))}
            series={[
              { key: 'avg',    label: t('kpm.common.avgPct'),         color: '#ff6a18' },
              { key: 'median', label: t('kpm.performance.medianPct'), color: '#3d8bff' },
              { key: 'best',   label: t('kpm.common.bestPct'),        color: '#16a34a' },
            ]}
            valueSuffix="%"
            yDomain={[0, 100]}
            onPointClick={(i) => {
              const p = trend[i]
              if (p) setMonthPick({ bucket: p.bucket, avg: p.avg_score_pct, median: p.median_score_pct, best: p.best_score_pct })
            }}
          />
        ) : (
          <EmptyState title={t('admin1.noScoreActivity')} />
        )}
        <p className="text-[11px] text-text-faint mt-2">{t('kpm.performance.trendClickHint')}</p>
      </SectionCard>

      {/* Practice vs tournament */}
      <SectionCard title={t('kpm.performance.comparisonTitle')} className="mb-6">
        <BreakdownTable<KpmPracticeTournamentRow>
          rows={comparison}
          getKey={(r) => r.bucket}
          emptyTitle={t('common.noData')}
          columns={compareColumns(t)}
        />
      </SectionCard>

      {/* Improvement breakdown */}
      <SectionCard title={t('kpm.performance.improvementTitle')} className="mb-6">
        <GroupBySelect value={groupBy} onChange={setGroupBy} options={GROUP_OPTS} />
        <BreakdownTable<KpmScoreImprovementBreakdownRow>
          rows={bdRows}
          getKey={(r) => `${r.group_key ?? r.group_label ?? 'null'}`}
          emptyTitle={t('common.noData')}
          columns={improvementBdColumns(t, groupBy)}
        />
      </SectionCard>

      {/* Top improvers */}
      <SectionCard title={t('kpm.performance.topImprovers')} className="mb-6">
        <BreakdownTable<KpmScoreImprovementRow>
          rows={topImprovers}
          getKey={(r) => r.archer_id}
          emptyTitle={t('kpm.performance.noImprovement')}
          columns={improversColumns(t)}
        />
        <ShowingNote shown={topImprovers.length} total={improvement.filter((r) => r.improvement_pp != null).length} />
      </SectionCard>

      {/* Card explainer — how each headline number is calculated */}
      <PerfMetricModal metric={metric} onClose={() => setMetric(null)} />

      {/* Funnel drill-down — the actual submissions behind a status count */}
      <ScoresListModal
        pick={funnelPick}
        scores={scoresList}
        loading={scoresLoading}
        onClose={() => setFunnelPick(null)}
      />

      {/* Monthly detail — top scorer + the scores behind avg & median */}
      <TrendMonthModal
        month={monthPick}
        scores={scoresList}
        loading={scoresLoading}
        onClose={() => setMonthPick(null)}
      />
    </>
  )
}

export default KpmPerformanceSection

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui'
import { MultiSeriesChart } from '@/components/charts/TrendChart'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmSummary, getKpmTrend, getKpmBreakdown, getKpmScoresList, getKpmRetentionArchers,
  type KpmGroupBy, type KpmBreakdownRow, type KpmTrendBucket, type KpmRetentionArcher,
} from '@/services/kpmMetrics'
import { resolveRange } from '@/services/reports'
import {
  fmtNum, fmtPct, GroupBySelect, KpmBackendNotice, groupRowLabel, ExplainBox,
  ORG_DIMS, DEMO_DIMS,
} from './shared'
import { PerfMetricModal, ScoresListModal } from './KpmPerformanceModals'
import { ArcherListModal } from './KpmArcherListModal'

/**
 * KPM Overview building blocks (Section 1 — National / Scope Summary).
 * Every figure comes from kpm_report_summary / kpm_score_trend /
 * kpm_report_breakdown (migration 061) — nothing is computed in the browser.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Coarser buckets for long windows — pure display granularity (DB buckets). */
export function trendBucketFor(preset?: string): KpmTrendBucket {
  if (preset === '3y' || preset === '5y' || preset === 'all') return 'month'
  if (preset === '6m' || preset === '1y') return 'week'
  return 'day'
}

// ─── SUMMARY CARDS ───────────────────────────────────────────────────────────

export function KpmSummaryCards({ filters }: { filters: ReportFilters }) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const { data: s, error } = useQuery({
    queryKey: ['kpm-summary', fkey],
    queryFn: () => getKpmSummary(filters),
    staleTime: 60_000,
  })

  // Explanation pop-up, a real scores list, and a real archer list (with filters).
  const [metric, setMetric] = useState<{ title: string; value: React.ReactNode; howKey: string } | null>(null)
  const [scorePick, setScorePick] = useState<{ status: string | null; title: string; explainKey: string } | null>(null)
  const [archerPick, setArcherPick] = useState<{ title: string; value: React.ReactNode; howKey: string; filter: (a: KpmRetentionArcher) => boolean } | null>(null)

  const { data: scoresList = [], isFetching: scoresLoading } = useQuery({
    queryKey: ['kpm-ov-scores', fkey],
    queryFn: () => getKpmScoresList(filters),
    staleTime: 120_000,
    enabled: scorePick != null,
  })
  const { data: archerList = [], isFetching: archersLoading, error: archersError } = useQuery({
    queryKey: ['kpm-ov-archers', fkey],
    queryFn: () => getKpmRetentionArchers(filters),
    staleTime: 120_000,
    enabled: archerPick != null,
  })

  // "New" = registered within the selected period.
  const { startISO, endISO } = resolveRange(filters)
  const startD = startISO?.slice(0, 10)
  const endD = endISO.slice(0, 10)
  const isNew = (a: KpmRetentionArcher) =>
    a.registered_at != null && (!startD || a.registered_at >= startD) && a.registered_at <= endD

  const explain = (title: string, value: React.ReactNode, howKey: string) => () => setMetric({ title, value, howKey })
  const scores = (status: string | null, label: string, explainKey: string) => () =>
    setScorePick({ status, title: t('kpm.performance.scoresListTitle', { label }), explainKey })
  const archers = (title: string, value: React.ReactNode, howKey: string, filter: (a: KpmRetentionArcher) => boolean) => () =>
    setArcherPick({ title, value, howKey, filter })

  if (error) return <KpmBackendNotice migrations="061" error={error} />

  return (
    <>
    <ExplainBox>{t('kpm.explain.overview')}</ExplainBox>
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-1">
      <StatCard label={t('stateReport.registeredArchers')} value={fmtNum(s?.registered_archers)}
        tone="primary"
        onClick={archers(t('stateReport.registeredArchers'), fmtNum(s?.registered_archers), 'kpm.summary.how.registered', () => true)} />
      <StatCard label={t('coachDash.activeArchers')}       value={fmtNum(s?.active_archers)} sub={t('kpm.summary.activeHint')}
        tone="success"
        onClick={archers(t('coachDash.activeArchers'), fmtNum(s?.active_archers), 'kpm.summary.how.active', (a) => a.active_current)} />
      <StatCard label={t('kpm.summary.newArchers')}        value={fmtNum(s?.new_registrations)} sub={t('kpm.summary.inPeriod')}
        tone="success"
        trend={(s?.new_registrations ?? 0) > 0 ? 'up' : 'flat'}
        onClick={archers(t('kpm.summary.newArchers'), fmtNum(s?.new_registrations), 'kpm.summary.how.new', isNew)} />
      <StatCard label={t('nav.coaches')}                   value={fmtNum(s?.coaches)}
        onClick={explain(t('nav.coaches'), fmtNum(s?.coaches), 'kpm.summary.how.coaches')} />
      <StatCard
        label={t('reports.schoolsReporting')}
        value={s ? `${s.schools_reporting}/${s.schools_total}` : '—'}
        sub={t('kpm.summary.reportingHint')}
        tone="warning"
        progressPct={s?.schools_total ? Math.round((s.schools_reporting / s.schools_total) * 100) : null}
        onClick={explain(t('reports.schoolsReporting'), s ? `${s.schools_reporting}/${s.schools_total}` : '—', 'kpm.summary.how.schools')}
      />
      <StatCard label={t('admin1.scoresSubmitted')}     value={fmtNum(s?.scores_submitted)}
        onClick={scores(null, t('admin1.scoresSubmitted'), 'kpm.performance.funnelExplain.submitted')} />
      <StatCard label={t('admin1.approvedScores')}      value={fmtNum(s?.scores_admin_approved)} accent
        onClick={scores('admin_approved', t('admin1.approvedScores'), 'kpm.performance.funnelExplain.verified')} />
      <StatCard
        label={t('coachDash.pendingValidation')}
        value={fmtNum(s?.scores_pending)}
        badge={s?.scores_pending}
        tone={(s?.scores_pending ?? 0) > 0 ? 'warning' : 'success'}
        onClick={scores('pending', t('coachDash.pendingValidation'), 'kpm.performance.funnelExplain.pending')}
      />
      <StatCard label={t('kpm.summary.avgScorePct')}  value={fmtPct(s?.avg_score_pct)} sub={t('kpm.summary.verifiedOnlyHint')}
        tone="primary"
        progressPct={s?.avg_score_pct ?? null}
        onClick={explain(t('kpm.summary.avgScorePct'), fmtPct(s?.avg_score_pct), 'kpm.summary.how.avg')} />
      <StatCard label={t('kpm.summary.bestScorePct')} value={fmtPct(s?.best_score_pct)}
        tone="success"
        progressPct={s?.best_score_pct ?? null}
        onClick={explain(t('kpm.summary.bestScorePct'), fmtPct(s?.best_score_pct), 'kpm.summary.how.best')} />
      <StatCard label={t('common.sessions')}          value={fmtNum(s?.training_sessions)} sub={t('kpm.training.title')}
        onClick={explain(t('common.sessions'), fmtNum(s?.training_sessions), 'kpm.summary.how.sessions')} />
      <StatCard label={t('reports.achievementsMonth')} value={fmtNum(s?.achievements_earned)} sub={t('kpm.summary.inPeriod')}
        tone="success"
        onClick={explain(t('reports.achievementsMonth'), fmtNum(s?.achievements_earned), 'kpm.summary.how.achievements')} />
    </div>
    <p className="text-[11px] text-text-faint mb-6">{t('kpm.summary.clickCardHint')}</p>

    <PerfMetricModal metric={metric} onClose={() => setMetric(null)} />
    <ScoresListModal pick={scorePick} scores={scoresList} loading={scoresLoading} onClose={() => setScorePick(null)} />
    <ArcherListModal pick={archerPick} archers={archerList} loading={archersLoading} error={archersError} onClose={() => setArcherPick(null)} />
    </>
  )
}

// ─── SUBMITTED VS VALIDATED TREND ────────────────────────────────────────────

export function KpmScoreFunnelTrend({ filters }: { filters: ReportFilters }) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const bucket = trendBucketFor(filters.preset)
  const { data: trend = [], error } = useQuery({
    queryKey: ['kpm-trend', fkey, bucket],
    queryFn: () => getKpmTrend(filters, bucket),
    staleTime: 60_000,
  })

  return (
    <SectionCard title={t('admin1.activityTrend')} className="mb-6">
      <ExplainBox defaultOpen>{t('kpm.explain.trend')}</ExplainBox>
      {error ? (
        <KpmBackendNotice migrations="061" error={error} />
      ) : trend.length ? (
        <MultiSeriesChart
          data={trend.map((p) => ({ date: p.bucket, submitted: p.submitted, approved: p.admin_approved }))}
          series={[
            { key: 'submitted', label: t('archerProfile.submitted'), color: '#3d8bff' },
            { key: 'approved',  label: t('status.approved'),  color: '#16a34a' },
          ]}
        />
      ) : (
        <EmptyState title={t('admin1.noScoreActivity')} description={t('admin1.noSubmissionsWindow')} />
      )}
    </SectionCard>
  )
}

// ─── DIMENSION BREAKDOWN (period-based, any dimension) ───────────────────────

const DIM_OPTS: { value: KpmGroupBy; labelKey: string }[] = [
  ...ORG_DIMS,
  { value: 'coach', labelKey: 'roles.coach' },
  ...DEMO_DIMS,
  { value: 'round_category', labelKey: 'kpm.common.roundCategory' },
  { value: 'distance',       labelKey: 'kpm.common.distance' },
]

const dimColumns = (t: Translate, groupBy: KpmGroupBy): Column<KpmBreakdownRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => <span className="font-medium text-text">{groupRowLabel(t, groupBy, r.group_label ?? r.group_key)}</span>,
  },
  { key: 'archers',   header: t('nav.archers'),      render: (r) => r.archers, align: 'right' },
  { key: 'submitted', header: t('archerProfile.submitted'), render: (r) => r.scores_submitted, align: 'right' },
  { key: 'approved',  header: t('status.approved'),  render: (r) => r.scores_admin_approved, align: 'right' },
  { key: 'pending',   header: t('status.pending'),   render: (r) => r.scores_pending, align: 'right', hide: 'sm' },
  { key: 'rejected',  header: t('status.rejected'),  render: (r) => r.scores_rejected, align: 'right', hide: 'md' },
  { key: 'avg',       header: t('kpm.common.avgPct'), render: (r) => fmtPct(r.avg_score_pct), align: 'right' },
  { key: 'best',      header: t('kpm.common.bestPct'), render: (r) => fmtPct(r.best_score_pct), align: 'right', hide: 'sm' },
]

export function KpmDimensionBreakdown({
  filters, defaultDim = 'state',
}: {
  filters: ReportFilters
  defaultDim?: KpmGroupBy
}) {
  const { t } = useLanguage()
  const [dim, setDim] = useState<KpmGroupBy>(defaultDim)
  const fkey = JSON.stringify(filters)
  const { data: rows = [], error } = useQuery({
    queryKey: ['kpm-breakdown', dim, fkey],
    queryFn: () => getKpmBreakdown(dim, filters),
    staleTime: 60_000,
  })

  return (
    <SectionCard title={t('kpm.summary.dimensionBreakdown')} className="mb-6">
      <GroupBySelect value={dim} onChange={setDim} options={DIM_OPTS} />
      {error ? (
        <KpmBackendNotice migrations="061" error={error} />
      ) : (
        <BreakdownTable<KpmBreakdownRow>
          rows={rows}
          getKey={(r) => `${r.group_key ?? r.group_label ?? 'null'}`}
          emptyTitle={t('common.noData')}
          columns={dimColumns(t, dim)}
        />
      )}
    </SectionCard>
  )
}

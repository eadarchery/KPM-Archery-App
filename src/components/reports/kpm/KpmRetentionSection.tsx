import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Badge, Select } from '@/components/ui'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate } from '@/utils/dates'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmRetentionSummary, getKpmRetentionBreakdown, getKpmCohortRetention,
  getKpmInactiveArchers, getKpmRetentionArchers,
  type KpmRetentionGroupBy, type KpmRetentionBreakdownRow, type KpmCohortRow,
  type KpmInactiveArcherRow,
} from '@/services/kpmMetrics'
import {
  fmtNum, fmtPct, monthLabel, GroupBySelect, KpmBackendNotice, ShowingNote,
  groupRowLabel, ORG_DIMS, DEMO_DIMS,
} from './shared'
import { RetentionMetricModal, InactiveBucketModal } from './KpmRetentionModals'

/**
 * Section 4 — Retention & Dropout (KPM Q2: are students staying active?).
 * Retention/dropout rates, inactivity buckets and cohorts all come from the
 * migration 064 RPCs. The inactivity threshold is an RPC *parameter* — the
 * classification itself still happens in the database.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const GROUP_OPTS: { value: KpmRetentionGroupBy; labelKey: string }[] = [
  ...ORG_DIMS,
  { value: 'coach', labelKey: 'roles.coach' },
  ...DEMO_DIMS,
]

const THRESHOLDS = [30, 60, 90, 180] as const
const LIST_LIMIT = 50

const breakdownColumns = (t: Translate, groupBy: KpmRetentionGroupBy): Column<KpmRetentionBreakdownRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => <span className="font-medium text-text">{groupRowLabel(t, groupBy, r.group_label ?? r.group_key)}</span>,
  },
  { key: 'archers',  header: t('nav.archers'),               render: (r) => r.archers, align: 'right', hide: 'sm' },
  { key: 'cur',      header: t('kpm.retention.activeCurrent'),  render: (r) => r.active_current, align: 'right' },
  { key: 'prev',     header: t('kpm.retention.activePrevious'), render: (r) => r.active_previous, align: 'right', hide: 'sm' },
  { key: 'retained', header: t('kpm.retention.retained'),    render: (r) => r.retained, align: 'right' },
  { key: 'dropout',  header: t('kpm.retention.dropout'),     render: (r) => r.dropout, align: 'right' },
  { key: 'rate',     header: t('kpm.retention.retentionRate'), render: (r) => fmtPct(r.retention_rate), align: 'right' },
]

const cohortColumns = (t: Translate): Column<KpmCohortRow>[] => [
  { key: 'month',    header: t('kpm.retention.cohortMonth'), render: (r) => <span className="font-medium text-text">{monthLabel(r.cohort_month)}</span> },
  { key: 'size',     header: t('kpm.retention.cohortSize'),  render: (r) => r.cohort_size, align: 'right' },
  { key: 'active',   header: t('kpm.retention.stillActive'), render: (r) => r.active_count, align: 'right', hide: 'sm' },
  { key: 'retained', header: t('kpm.retention.retained'),    render: (r) => r.retained_count, align: 'right' },
  { key: 'dropout',  header: t('kpm.retention.dropout'),     render: (r) => r.dropout_count, align: 'right' },
  { key: 'rate',     header: t('kpm.retention.retentionRate'), render: (r) => fmtPct(r.retention_rate), align: 'right' },
]

const inactiveColumns = (t: Translate): Column<KpmInactiveArcherRow>[] => [
  {
    key: 'archer', header: t('roles.archer'),
    render: (r) => (
      <span>
        <span className="font-medium text-text">{r.archer_name ?? '—'}</span>
        {r.archer_code && <span className="text-text-faint text-xs ml-1.5">{r.archer_code}</span>}
      </span>
    ),
  },
  { key: 'school', header: t('common.school'), render: (r) => r.school ?? r.pld ?? r.state ?? '—', hide: 'md' },
  { key: 'age',    header: t('common.ageGroup'), render: (r) => r.age_group ?? '—', hide: 'sm' },
  { key: 'last',   header: t('archerDetail.lastActivity'), render: (r) => r.last_activity ? formatDate(r.last_activity) : t('kpm.retention.neverActive'), align: 'right', hide: 'sm' },
  {
    key: 'days', header: t('kpm.retention.daysInactive'), align: 'right',
    render: (r) => (
      <Badge variant={r.days_inactive >= 180 ? 'danger' : 'warning'}>
        {t('kpm.retention.daysCount', { days: r.days_inactive })}
      </Badge>
    ),
  },
]

export function KpmRetentionSection({
  filters, defaultGroupBy = 'state',
}: {
  filters: ReportFilters
  defaultGroupBy?: KpmRetentionGroupBy
}) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const [groupBy, setGroupBy] = useState<KpmRetentionGroupBy>(defaultGroupBy)
  const [threshold, setThreshold] = useState<number>(90)
  const [metricPick, setMetricPick] = useState<string | null>(null)
  const [bucketDays, setBucketDays] = useState<number | null>(null)

  const { data: s, error: e1 } = useQuery({
    queryKey: ['kpm-ret-sum', fkey],
    queryFn: () => getKpmRetentionSummary(filters),
    staleTime: 120_000,
  })
  const { data: rows = [], error: e2 } = useQuery({
    queryKey: ['kpm-ret-bd', groupBy, fkey],
    queryFn: () => getKpmRetentionBreakdown(groupBy, filters),
    staleTime: 120_000,
  })
  const { data: cohorts = [], error: e3 } = useQuery({
    queryKey: ['kpm-ret-cohort', threshold, fkey],
    queryFn: () => getKpmCohortRetention(filters, threshold),
    staleTime: 120_000,
  })
  const { data: inactive = [], error: e4 } = useQuery({
    queryKey: ['kpm-ret-inactive', threshold, fkey],
    queryFn: () => getKpmInactiveArchers(filters, threshold),
    staleTime: 120_000,
  })
  // On-demand list for a clicked inactivity bucket (its own day threshold).
  const { data: bucketRows = [], isFetching: bucketLoading } = useQuery({
    queryKey: ['kpm-ret-bucket', bucketDays, fkey],
    queryFn: () => getKpmInactiveArchers(filters, bucketDays ?? 0),
    staleTime: 120_000,
    enabled: bucketDays != null,
  })
  // Per-archer retention rows — fetched once a metric card is opened.
  const { data: retArchers = [], isFetching: retArchersLoading } = useQuery({
    queryKey: ['kpm-ret-archers', fkey],
    queryFn: () => getKpmRetentionArchers(filters),
    staleTime: 120_000,
    enabled: metricPick != null,
  })

  const backendError = e1 ?? e2 ?? e3 ?? e4

  return (
    <>
      {backendError != null && <KpmBackendNotice migrations="064" error={backendError} />}

      {/* Period-over-period cards — click any for how it's calculated + all figures */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-1">
        <StatCard label={t('kpm.retention.activeCurrent')}  value={fmtNum(s?.active_current)} accent onClick={() => setMetricPick('activeCurrent')} />
        <StatCard label={t('kpm.retention.activePrevious')} value={fmtNum(s?.active_previous)} tone="neutral" onClick={() => setMetricPick('activePrevious')} />
        <StatCard label={t('kpm.retention.returning')}      value={fmtNum(s?.returning_active)} tone="success" onClick={() => setMetricPick('returning')} />
        <StatCard label={t('kpm.retention.newActive')}      value={fmtNum(s?.new_active)} tone="success"
          trend={(s?.new_active ?? 0) > 0 ? 'up' : 'flat'} onClick={() => setMetricPick('newActive')} />
        <StatCard label={t('kpm.retention.retained')}       value={fmtNum(s?.retained)} tone="success" onClick={() => setMetricPick('retained')} />
        <StatCard label={t('kpm.retention.dropout')}        value={fmtNum(s?.dropout)} badge={s?.dropout}
          tone={(s?.dropout ?? 0) > 0 ? 'danger' : 'success'}
          trend={(s?.dropout ?? 0) > 0 ? 'down' : 'flat'} onClick={() => setMetricPick('dropout')} />
        <StatCard label={t('kpm.retention.retentionRate')}  value={fmtPct(s?.retention_rate)} tone="success"
          progressPct={s?.retention_rate ?? null} onClick={() => setMetricPick('retentionRate')} />
        <StatCard label={t('kpm.retention.dropoutRate')}    value={fmtPct(s?.dropout_rate)}
          tone={(s?.dropout_rate ?? 0) > 0 ? 'danger' : 'success'}
          progressPct={s?.dropout_rate ?? null} onClick={() => setMetricPick('dropoutRate')} />
      </div>
      <p className="text-[11px] text-text-faint mb-4">{t('kpm.retention.clickCardHint')}</p>

      {/* Inactivity buckets — click one to see WHO is not shooting */}
      <SectionCard title={t('kpm.retention.inactivityTitle')} className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {([
            [30,  s?.inactive_30], [60, s?.inactive_60], [90, s?.inactive_90],
            [180, s?.inactive_180], [365, s?.inactive_365],
          ] as const).map(([days, value]) => (
            <button
              key={days}
              type="button"
              onClick={() => setBucketDays(days)}
              className="rounded-[var(--r)] border border-line bg-surface p-4 text-center transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <div className="font-display font-semibold text-[26px] leading-none text-text">{fmtNum(value)}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-text-faint mt-2">
                {t('kpm.retention.inactiveDays', { days })}
              </div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-faint mt-3">{t('kpm.retention.clickBucketHint')}</p>
      </SectionCard>

      {/* Breakdown */}
      <SectionCard title={t('kpm.retention.breakdown')} className="mb-6">
        <GroupBySelect value={groupBy} onChange={setGroupBy} options={GROUP_OPTS} />
        <BreakdownTable<KpmRetentionBreakdownRow>
          rows={rows}
          getKey={(r) => `${r.group_key ?? r.group_label ?? 'null'}`}
          emptyTitle={t('common.noData')}
          columns={breakdownColumns(t, groupBy)}
        />
      </SectionCard>

      {/* Cohort retention */}
      <SectionCard title={t('kpm.retention.cohortTitle')} className="mb-6">
        <div className="max-w-[240px] mb-3">
          <Select
            label={t('kpm.retention.threshold')}
            value={String(threshold)}
            onChange={(e) => setThreshold(Number(e.target.value))}
            options={THRESHOLDS.map((d) => ({ value: String(d), label: t('kpm.retention.thresholdOpt', { days: d }) }))}
          />
        </div>
        <BreakdownTable<KpmCohortRow>
          rows={cohorts}
          getKey={(r) => r.cohort_month}
          emptyTitle={t('common.noData')}
          columns={cohortColumns(t)}
        />
      </SectionCard>

      {/* Inactive archers (follow-up list) */}
      <SectionCard title={t('kpm.retention.inactiveList', { days: threshold })} className="mb-6">
        <BreakdownTable<KpmInactiveArcherRow>
          rows={inactive.slice(0, LIST_LIMIT)}
          getKey={(r) => r.archer_id}
          emptyTitle={t('kpm.retention.noInactive')}
          columns={inactiveColumns(t)}
        />
        <ShowingNote shown={Math.min(LIST_LIMIT, inactive.length)} total={inactive.length} />
      </SectionCard>

      {/* Card drill-down — how it's built + the actual archers behind it */}
      <RetentionMetricModal
        metricKey={metricPick}
        summary={s}
        archers={retArchers}
        loading={retArchersLoading}
        onClose={() => setMetricPick(null)}
      />

      {/* Inactivity bucket drill-down — who is not shooting */}
      <InactiveBucketModal days={bucketDays} rows={bucketRows} loading={bucketLoading} onClose={() => setBucketDays(null)} />
    </>
  )
}

export default KpmRetentionSection

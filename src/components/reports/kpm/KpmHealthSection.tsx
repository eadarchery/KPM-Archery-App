import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { Badge } from '@/components/ui'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmNationalHealthSummary, getKpmScopeHealth,
  type KpmHealthGroupBy, type KpmNationalHealthRow, type KpmScopeHealth,
} from '@/services/kpmMetrics'
import {
  fmtNum, fmtPct, GroupBySelect, KpmBackendNotice, InternalNote, HealthBadge,
  ShowingNote,
} from './shared'
import { KpmHealthDashboard } from './KpmHealthDashboard'
import { HealthUnitDetailModal } from './HealthUnitDetailModal'

/**
 * Section 7 — School / PLD / State Health (KPM Q4: are units developing
 * properly?). Green/Yellow/Red, health score and reasons are computed by
 * migration 067 with conservative INTERNAL default rules — NOT an official
 * KPM standard. The caption below is mandatory.
 *
 * Note: health_reasons come from the database as English diagnostic phrases
 * (no stable slugs) and are shown verbatim.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const LEVEL_OPTS: { value: KpmHealthGroupBy; labelKey: string }[] = [
  { value: 'state',  labelKey: 'common.state' },
  { value: 'pld',    labelKey: 'common.pld' },
  { value: 'school', labelKey: 'common.school' },
]

const LIST_LIMIT = 40

const scopeLabelKey: Record<string, string> = {
  state: 'common.state', pld: 'common.pld', school: 'common.school',
}

const nationalColumns = (t: Translate): Column<KpmNationalHealthRow>[] => [
  {
    key: 'scope', header: t('kpm.health.scopeLevel'),
    render: (r) => <span className="font-medium text-text">{scopeLabelKey[r.scope_type] ? t(scopeLabelKey[r.scope_type]) : r.scope_type}</span>,
  },
  { key: 'units',  header: t('kpm.health.units'), render: (r) => r.total_units, align: 'right' },
  { key: 'green',  header: t('kpm.health.green'),  render: (r) => <span className="text-success font-semibold">{r.green}</span>, align: 'right' },
  { key: 'yellow', header: t('kpm.health.yellow'), render: (r) => <span className="text-warning font-semibold">{r.yellow}</span>, align: 'right' },
  { key: 'red',    header: t('kpm.health.red'),    render: (r) => <span className="text-danger font-semibold">{r.red}</span>, align: 'right' },
  { key: 'attention', header: t('kpm.health.needsAttention'), render: (r) => r.needs_attention, align: 'right', hide: 'sm' },
  { key: 'score', header: t('kpm.health.avgScore'), render: (r) => fmtNum(r.avg_health_score), align: 'right', hide: 'sm' },
]

function ReasonList({ reasons }: { reasons: string[] }) {
  if (!reasons?.length) return <span className="text-text-faint">—</span>
  const shown = reasons.slice(0, 2)
  return (
    <span className="flex flex-wrap gap-1 justify-end" title={reasons.join(' · ')}>
      {shown.map((r) => <Badge key={r} variant="neutral">{r}</Badge>)}
      {reasons.length > shown.length && <Badge variant="neutral">+{reasons.length - shown.length}</Badge>}
    </span>
  )
}

const unitColumns = (t: Translate): Column<KpmScopeHealth>[] => [
  {
    key: 'unit', header: t('kpm.health.unit'),
    render: (r) => (
      <span>
        <span className="font-medium text-text">{r.unit_name ?? '—'}</span>
        {r.needs_attention && <span className="text-danger ml-1.5" title={t('kpm.health.needsAttention')}>⚑</span>}
        {(r.parent_pld || r.parent_state) && (
          <span className="block text-[11px] text-text-faint">{[r.parent_pld, r.parent_state].filter(Boolean).join(' · ')}</span>
        )}
      </span>
    ),
  },
  { key: 'status', header: t('kpm.health.status'), render: (r) => <HealthBadge status={r.health_status} /> },
  { key: 'score',  header: t('kpm.health.score'),  render: (r) => fmtNum(r.health_score), align: 'right', hide: 'sm' },
  { key: 'archers', header: t('nav.archers'), render: (r) => `${r.active_archers}/${r.registered_archers}`, align: 'right' },
  { key: 'sessions', header: t('common.sessions'), render: (r) => r.training_sessions, align: 'right', hide: 'sm' },
  { key: 'avg',      header: t('kpm.common.avgPct'), render: (r) => fmtPct(r.avg_score_pct), align: 'right', hide: 'md' },
  { key: 'retention', header: t('kpm.retention.retentionRate'), render: (r) => fmtPct(r.retention_rate), align: 'right', hide: 'md' },
  { key: 'coaches',  header: t('nav.coaches'), render: (r) => r.active_coaches, align: 'right', hide: 'lg' },
  { key: 'reasons',  header: t('kpm.health.reasons'), render: (r) => <ReasonList reasons={r.health_reasons ?? []} />, align: 'right', hide: 'sm' },
]

export function KpmHealthSection({
  filters, defaultLevel = 'state',
}: {
  filters: ReportFilters
  defaultLevel?: KpmHealthGroupBy
}) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const [level, setLevel] = useState<KpmHealthGroupBy>(defaultLevel)
  const [detailUnit, setDetailUnit] = useState<KpmScopeHealth | null>(null)

  const { data: national = [], error: e1 } = useQuery({
    queryKey: ['kpm-health-nat', fkey],
    queryFn: () => getKpmNationalHealthSummary(filters),
    staleTime: 300_000,
  })
  const { data: units = [], error: e2 } = useQuery({
    queryKey: ['kpm-health-units', level, fkey],
    queryFn: () => getKpmScopeHealth(level, filters),
    staleTime: 300_000,
  })

  const backendError = e1 ?? e2

  return (
    <>
      {/* MANDATORY caption — internal indicator, not official KPM classification. */}
      <InternalNote>{t('kpm.health.internalNote')}</InternalNote>

      {backendError != null && <KpmBackendNotice migrations="067" error={backendError} />}

      {/* Visual dashboard — status distribution, correlation explorer, worst units */}
      <KpmHealthDashboard filters={filters} />

      {/* Green / Yellow / Red overview per scope level */}
      <SectionCard title={t('kpm.health.overviewTitle')} className="mb-6">
        <BreakdownTable<KpmNationalHealthRow>
          rows={national}
          getKey={(r) => r.scope_type}
          emptyTitle={t('common.noData')}
          columns={nationalColumns(t)}
        />
      </SectionCard>

      {/* Per-unit health table (worst first, straight from the RPC ordering) */}
      <SectionCard title={t('kpm.health.unitTitle')} className="mb-6">
        <GroupBySelect
          value={level}
          onChange={setLevel}
          options={LEVEL_OPTS}
          label={t('kpm.common.level')}
        />
        <BreakdownTable<KpmScopeHealth>
          rows={units.slice(0, LIST_LIMIT)}
          getKey={(r) => r.unit_id}
          emptyTitle={t('common.noData')}
          columns={unitColumns(t)}
          onRowClick={setDetailUnit}
        />
        <ShowingNote shown={Math.min(LIST_LIMIT, units.length)} total={units.length} />
        <p className="text-[11px] text-text-faint mt-2">{t('kpm.health.orderNote')} {t('kpm.health.clickRowHint')}</p>
      </SectionCard>

      {/* Single-unit detail: score explainer + problems (with fix links) */}
      <HealthUnitDetailModal unit={detailUnit} onClose={() => setDetailUnit(null)} />
    </>
  )
}

export default KpmHealthSection

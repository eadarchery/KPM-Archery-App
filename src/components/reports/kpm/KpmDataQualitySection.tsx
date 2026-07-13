import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Select } from '@/components/ui'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmDataQualitySummary, getKpmDataQualityIssues, getKpmDataQualityBreakdown,
  getKpmDataQualityByScope,
  type KpmDqBreakdownBy, type KpmDqScopeBy, type KpmDataQualityIssue,
  type KpmDataQualityBreakdownRow, type KpmDataQualityScopeRow,
  type KpmDataQualitySummary,
} from '@/services/kpmMetrics'
import {
  fmtNum, fmtPct, GroupBySelect, KpmBackendNotice, SeverityBadge, ShowingNote,
  dqCategoryLabel, issueTypeLabel, ExplainBox, StatusWord,
} from './shared'
import { DataQualityCategoryModal, type DqCardKey } from './DataQualityCategoryModal'

/**
 * Section 8 — Data Quality (KPM Q8: can KPM trust the reports?).
 * Issue detection, severity and completeness percentages all come from the
 * migration 068 RPCs. The only client-side work is display filtering of the
 * already-fetched issue list. Severity levels are internal definitions.
 *
 * Equipment completeness reads scoring.equipment_setups, which only Admin 2 /
 * Super Admin can see — pass showEquipment={false} on scoped (Admin 1) pages
 * so a misleading 0% is never presented as official.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const BREAKDOWN_OPTS: { value: KpmDqBreakdownBy; labelKey: string }[] = [
  { value: 'issue_type', labelKey: 'kpm.dq.issueType' },
  { value: 'category',   labelKey: 'kpm.dq.category' },
  { value: 'severity',   labelKey: 'kpm.dq.severity' },
]
const SCOPE_OPTS: { value: KpmDqScopeBy; labelKey: string }[] = [
  { value: 'state',  labelKey: 'common.state' },
  { value: 'pld',    labelKey: 'common.pld' },
  { value: 'school', labelKey: 'common.school' },
]

const ISSUE_LIMIT = 100

const breakdownColumns = (t: Translate, groupBy: KpmDqBreakdownBy): Column<KpmDataQualityBreakdownRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => {
      const raw = r.group_key ?? '—'
      const label =
        groupBy === 'issue_type' ? issueTypeLabel(t, raw)
        : groupBy === 'category' ? dqCategoryLabel(t, raw)
        : raw === 'critical' || raw === 'warning' || raw === 'info' ? t(`kpm.severity.${raw}`)
        : raw
      return <span className="font-medium text-text">{label}</span>
    },
  },
  { key: 'total',    header: t('common.total'), render: (r) => r.total, align: 'right' },
  { key: 'critical', header: t('kpm.severity.critical'), render: (r) => <span className="text-danger font-semibold">{r.critical}</span>, align: 'right' },
  { key: 'warning',  header: t('kpm.severity.warning'),  render: (r) => <span className="text-warning font-semibold">{r.warning}</span>, align: 'right' },
  { key: 'info',     header: t('kpm.severity.info'),     render: (r) => r.info, align: 'right', hide: 'sm' },
]

const scopeColumns = (t: Translate): Column<KpmDataQualityScopeRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => <span className="font-medium text-text">{r.group_label ?? '—'}</span>,
  },
  { key: 'total',    header: t('common.total'), render: (r) => r.total, align: 'right' },
  { key: 'critical', header: t('kpm.severity.critical'), render: (r) => <span className="text-danger font-semibold">{r.critical}</span>, align: 'right' },
  { key: 'warning',  header: t('kpm.severity.warning'),  render: (r) => <span className="text-warning font-semibold">{r.warning}</span>, align: 'right' },
  { key: 'info',     header: t('kpm.severity.info'),     render: (r) => r.info, align: 'right', hide: 'sm' },
]

const issueColumns = (t: Translate): Column<KpmDataQualityIssue>[] => [
  { key: 'severity', header: t('kpm.dq.severity'), render: (r) => <SeverityBadge severity={r.severity} /> },
  { key: 'category', header: t('kpm.dq.category'), render: (r) => dqCategoryLabel(t, r.category), hide: 'sm' },
  {
    key: 'issue', header: t('kpm.dq.issue'),
    render: (r) => <span className="text-text">{issueTypeLabel(t, r.issue_type, r.issue_message)}</span>,
  },
  { key: 'entity', header: t('kpm.dq.entity'), render: (r) => <span className="font-medium text-text">{r.entity_label ?? '—'}</span> },
  { key: 'where',  header: t('common.school'), render: (r) => r.school ?? r.pld ?? r.state ?? '—', hide: 'md' },
]

export function KpmDataQualitySection({
  filters, showEquipment, defaultScopeBy = 'state',
}: {
  filters: ReportFilters
  /** Equipment completeness is only reliable for Admin 2 / Super Admin (RLS). */
  showEquipment: boolean
  defaultScopeBy?: KpmDqScopeBy
}) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const [breakdownBy, setBreakdownBy] = useState<KpmDqBreakdownBy>('issue_type')
  const [scopeBy, setScopeBy] = useState<KpmDqScopeBy>(defaultScopeBy)
  const [sevFilter, setSevFilter] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [dqPick, setDqPick] = useState<DqCardKey | null>(null)

  const { data: s, error: e1 } = useQuery({
    queryKey: ['kpm-dq-sum', fkey],
    queryFn: () => getKpmDataQualitySummary(filters),
    staleTime: 300_000,
  })
  const { data: bdRows = [], error: e2 } = useQuery({
    queryKey: ['kpm-dq-bd', breakdownBy, fkey],
    queryFn: () => getKpmDataQualityBreakdown(breakdownBy, filters),
    staleTime: 300_000,
  })
  const { data: scopeRows = [], error: e3 } = useQuery({
    queryKey: ['kpm-dq-scope', scopeBy, fkey],
    queryFn: () => getKpmDataQualityByScope(scopeBy, filters),
    staleTime: 300_000,
  })
  const { data: issues = [], error: e4 } = useQuery({
    queryKey: ['kpm-dq-issues', fkey],
    queryFn: () => getKpmDataQualityIssues(filters),
    staleTime: 300_000,
  })

  const backendError = e1 ?? e2 ?? e3 ?? e4

  // Display filtering only — the issue list itself comes from the DB.
  const visibleIssues = useMemo(
    () => issues.filter((i) =>
      (!sevFilter || i.severity === sevFilter) &&
      (!catFilter || i.category === catFilter) &&
      (showEquipment || i.category !== 'equipment')),
    [issues, sevFilter, catFilter, showEquipment],
  )

  const catOptions = useMemo(() => {
    const cats = ['profile', 'score', 'training', 'coach', 'organisation', ...(showEquipment ? ['equipment'] : [])]
    return [{ value: '', label: t('kpm.dq.allCategories') }, ...cats.map((c) => ({ value: c, label: dqCategoryLabel(t, c) }))]
  }, [t, showEquipment])

  return (
    <>
      {backendError != null && <KpmBackendNotice migrations="068" error={backendError} />}

      <ExplainBox defaultOpen>
        <p>{t('kpm.explain.dqIntro')}</p>
        <p><StatusWord tone="danger">🔴 {t('kpm.severity.critical')}</StatusWord> — {t('kpm.explain.dqCritical')}</p>
        <p><StatusWord tone="warning">🟡 {t('kpm.severity.warning')}</StatusWord> — {t('kpm.explain.dqWarning')}</p>
        <p><StatusWord tone="neutral">⚪ {t('kpm.severity.info')}</StatusWord> — {t('kpm.explain.dqInfo')}</p>
        <p className="text-text-faint">{t('kpm.explain.dqOutro')}</p>
      </ExplainBox>

      {/* Completeness cards (percentages computed by the DB). Click to see what
          each metric measures + the specific entities that are incomplete. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-4">
        <StatCard label={t('kpm.dq.overall')}  value={fmtPct(s?.overall_completeness_pct)} accent sub={t('kpm.dq.completenessHint')}
          progressPct={s?.overall_completeness_pct ?? null} onClick={() => setDqPick('overall')} />
        <StatCard label={t('kpm.dq.profile')}  value={fmtPct(s?.profile_completeness_pct)}
          tone={(s?.profile_completeness_pct ?? 100) < 80 ? 'warning' : 'success'}
          progressPct={s?.profile_completeness_pct ?? null} onClick={() => setDqPick('profile')} />
        <StatCard label={t('kpm.dq.score')}    value={fmtPct(s?.score_quality_pct)}
          tone={(s?.score_quality_pct ?? 100) < 80 ? 'warning' : 'success'}
          progressPct={s?.score_quality_pct ?? null} onClick={() => setDqPick('score')} />
        <StatCard label={t('kpm.dq.training')} value={fmtPct(s?.training_quality_pct)}
          tone={(s?.training_quality_pct ?? 100) < 80 ? 'warning' : 'success'}
          progressPct={s?.training_quality_pct ?? null} onClick={() => setDqPick('training')} />
        <StatCard label={t('kpm.dq.coach')}    value={fmtPct(s?.coach_quality_pct)}
          tone={(s?.coach_quality_pct ?? 100) < 80 ? 'warning' : 'success'}
          progressPct={s?.coach_quality_pct ?? null} onClick={() => setDqPick('coach')} />
        <StatCard label={t('kpm.dq.org')}      value={fmtPct(s?.org_quality_pct)}
          tone={(s?.org_quality_pct ?? 100) < 80 ? 'warning' : 'success'}
          progressPct={s?.org_quality_pct ?? null} onClick={() => setDqPick('organisation')} />
        {showEquipment && (
          <StatCard label={t('kpm.dq.equipment')} value={fmtPct(s?.equipment_completeness_pct)} sub={t('kpm.dq.equipmentNationalHint')}
            tone={(s?.equipment_completeness_pct ?? 100) < 80 ? 'warning' : 'success'}
            progressPct={s?.equipment_completeness_pct ?? null} onClick={() => setDqPick('equipment')} />
        )}
      </div>
      <p className="text-[11px] text-text-faint mb-4">
        {t('kpm.dq.clickCardHint')}{!showEquipment && ` ${t('kpm.dq.equipmentScopedNote')}`}
      </p>

      {/* Severity counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('kpm.dq.totalIssues')} value={fmtNum(s?.total_issues)} tone="neutral" />
        <StatCard label={t('kpm.severity.critical')} value={<span className="text-danger">{fmtNum(s?.critical_issues)}</span>} badge={s?.critical_issues}
          tone={(s?.critical_issues ?? 0) > 0 ? 'danger' : 'success'} />
        <StatCard label={t('kpm.severity.warning')}  value={<span className="text-warning">{fmtNum(s?.warning_issues)}</span>}
          tone={(s?.warning_issues ?? 0) > 0 ? 'warning' : 'success'} />
        <StatCard label={t('kpm.severity.info')}     value={fmtNum(s?.info_issues)} tone="neutral" />
      </div>

      {/* Top issues */}
      <SectionCard title={t('kpm.dq.breakdownTitle')} className="mb-6">
        <GroupBySelect value={breakdownBy} onChange={setBreakdownBy} options={BREAKDOWN_OPTS} />
        <BreakdownTable<KpmDataQualityBreakdownRow>
          rows={bdRows}
          getKey={(r) => `${r.group_key ?? 'null'}`}
          emptyTitle={t('kpm.dq.noIssues')}
          columns={breakdownColumns(t, breakdownBy)}
        />
      </SectionCard>

      {/* Issues by scope */}
      <SectionCard title={t('kpm.dq.byScopeTitle')} className="mb-6">
        <GroupBySelect value={scopeBy} onChange={setScopeBy} options={SCOPE_OPTS} label={t('kpm.common.level')} />
        <BreakdownTable<KpmDataQualityScopeRow>
          rows={scopeRows}
          getKey={(r) => `${r.group_key ?? 'null'}`}
          emptyTitle={t('kpm.dq.noIssues')}
          columns={scopeColumns(t)}
        />
      </SectionCard>

      {/* Detailed issue list */}
      <SectionCard title={t('kpm.dq.issueList')} className="mb-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3 max-w-xl">
          <Select
            label={t('kpm.dq.severity')}
            value={sevFilter}
            onChange={(e) => setSevFilter(e.target.value)}
            options={[
              { value: '', label: t('kpm.dq.allSeverities') },
              { value: 'critical', label: t('kpm.severity.critical') },
              { value: 'warning',  label: t('kpm.severity.warning') },
              { value: 'info',     label: t('kpm.severity.info') },
            ]}
          />
          <Select
            label={t('kpm.dq.category')}
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value)}
            options={catOptions}
          />
        </div>
        <BreakdownTable<KpmDataQualityIssue>
          rows={visibleIssues.slice(0, ISSUE_LIMIT)}
          getKey={(r) => `${r.entity_id}-${r.issue_type}`}
          emptyTitle={t('kpm.dq.noIssues')}
          columns={issueColumns(t)}
        />
        <ShowingNote shown={Math.min(ISSUE_LIMIT, visibleIssues.length)} total={visibleIssues.length} />
        <p className="text-[11px] text-text-faint mt-2">{t('kpm.dq.internalNote')}</p>
      </SectionCard>

      {/* Card drill-down: what the metric means + which entities are incomplete */}
      <DataQualityCategoryModal
        pick={dqPick}
        pct={dqPick ? DQ_CARD_PCT[dqPick](s) : null}
        issues={showEquipment ? issues : issues.filter((i) => i.category !== 'equipment')}
        onClose={() => setDqPick(null)}
      />
    </>
  )
}

/** Maps a clicked completeness card to its percentage in the summary row. */
const DQ_CARD_PCT: Record<DqCardKey, (s?: KpmDataQualitySummary) => number | null> = {
  overall:      (s) => s?.overall_completeness_pct ?? null,
  profile:      (s) => s?.profile_completeness_pct ?? null,
  score:        (s) => s?.score_quality_pct ?? null,
  training:     (s) => s?.training_quality_pct ?? null,
  coach:        (s) => s?.coach_quality_pct ?? null,
  organisation: (s) => s?.org_quality_pct ?? null,
  equipment:    (s) => s?.equipment_completeness_pct ?? null,
}

export default KpmDataQualitySection

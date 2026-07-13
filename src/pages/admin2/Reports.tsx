import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, HelpTip } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { ReportFilters, type Opt } from '@/components/reports/ReportFilters'
import { ReportPrintShell, PrintReportButton, describeReportFilters, rangeLabel } from '@/components/reports/ReportPrintShell'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { ValidationSummary } from '@/components/reports/ValidationSummary'
import { KpmSummaryCards, KpmScoreFunnelTrend, KpmDimensionBreakdown } from '@/components/reports/kpm/KpmOverviewKit'
import { KpmTrainingSection } from '@/components/reports/kpm/KpmTrainingSection'
import { KpmCoachSection } from '@/components/reports/kpm/KpmCoachSection'
import { KpmRetentionSection } from '@/components/reports/kpm/KpmRetentionSection'
import { KpmPerformanceSection } from '@/components/reports/kpm/KpmPerformanceSection'
import { KpmTalentSection } from '@/components/reports/kpm/KpmTalentSection'
import { KpmHealthSection } from '@/components/reports/kpm/KpmHealthSection'
import { KpmDataQualitySection } from '@/components/reports/kpm/KpmDataQualitySection'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useHasPermission } from '@/hooks/useRolePermissions'
import { canViewReports } from '@/lib/permissions'
import { writeAuditLog } from '@/services/auditLog'
import { getActiveStates, getActivePLDs, getActiveSchools } from '@/services/organization'
import {
  getStateBreakdown, getPLDBreakdown, getSchoolBreakdown, getValidationSummary,
  type ReportFilters as Filters, type StateBreakdownRow, type PLDBreakdownRow, type SchoolBreakdownRow,
} from '@/services/reports'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'

/**
 * Admin 2 — national KPM reporting view.
 *
 * GOLDEN RULE: every official figure on this page comes from the trusted
 * SECURITY INVOKER backend (migrations 025 + 061–068) via reports.ts /
 * kpmMetrics.ts. Nothing official is computed in the browser. Sections are
 * tabbed and lazily mounted so the heavier RPCs (health, data quality) only
 * run when opened.
 */

// ─── KPM SECTION TABS ─────────────────────────────────────────────────────────

type KpmTab =
  | 'overview' | 'training' | 'coaches' | 'retention'
  | 'performance' | 'talent' | 'health' | 'quality'

const TABS: { key: KpmTab; labelKey: string }[] = [
  { key: 'overview',    labelKey: 'kpm.tabs.overview' },
  { key: 'training',    labelKey: 'kpm.tabs.training' },
  { key: 'coaches',     labelKey: 'kpm.tabs.coaches' },
  { key: 'retention',   labelKey: 'kpm.tabs.retention' },
  { key: 'performance', labelKey: 'kpm.tabs.performance' },
  { key: 'talent',      labelKey: 'kpm.tabs.talent' },
  { key: 'health',      labelKey: 'kpm.tabs.health' },
  { key: 'quality',     labelKey: 'kpm.tabs.quality' },
]

// ─── CSV EXPORT (state breakdown) ─────────────────────────────────────────────

function downloadStatesCsv(rows: StateBreakdownRow[]) {
  const headers = ['State', 'Code', 'Registered', 'Active', 'Coaches', 'Schools', 'Reporting', 'Scores', 'Approved', 'Avg', 'Top']
  const lines = rows.map((r) => [
    r.state, r.state_code, r.registered_archers, r.active_archers, r.coaches,
    r.schools_total, r.schools_reporting, r.scores_submitted, r.approved_scores, r.avg_score, r.top_score,
  ])
  const csv = [headers, ...lines]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `national-state-report-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── PAGE ──────────────────────────────────────────────────────────────────────

export default function Admin2Reports() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const role = profile?.role
  const canView = useHasPermission(role, 'view_national_reports', canViewReports(role))
  const canExport = useHasPermission(role, 'export_reports', true)

  const [filters, setFilters] = useState<Filters>({ preset: '3m' })
  const [tab, setTab] = useState<KpmTab>('overview')

  // Filter option sources (active org entities).
  const { data: states = [] } = useQuery({ queryKey: ['rpt-states'], queryFn: getActiveStates, staleTime: 300_000 })
  const { data: plds = [] }   = useQuery({ queryKey: ['rpt-plds'],   queryFn: getActivePLDs,   staleTime: 300_000 })
  const { data: schools = [] }= useQuery({ queryKey: ['rpt-schools'],queryFn: getActiveSchools,staleTime: 300_000 })

  const stateOpts: Opt[] = useMemo(() => states.map((s) => ({ value: s.id, label: s.name })), [states])
  const pldOpts: Opt[] = useMemo(
    () => plds.filter((p) => !filters.stateId || p.state_id === filters.stateId).map((p) => ({ value: p.id, label: p.name })),
    [plds, filters.stateId],
  )
  const schoolOpts: Opt[] = useMemo(
    () => schools
      .filter((s) => (!filters.stateId || s.state_id === filters.stateId) && (!filters.pldId || s.pld_id === filters.pldId))
      .map((s) => ({ value: s.id, label: s.name })),
    [schools, filters.stateId, filters.pldId],
  )

  const fkey = JSON.stringify(filters)
  const onOverview = tab === 'overview'

  // Legacy all-time coverage tables (migration 025 views) — Overview tab only.
  const { data: stateRows = [] } = useQuery({ queryKey: ['rpt-state', fkey], queryFn: () => getStateBreakdown(filters), enabled: onOverview })
  const { data: pldRows = [] } = useQuery({ queryKey: ['rpt-pld', fkey], queryFn: () => getPLDBreakdown(filters), enabled: onOverview })
  const { data: schoolRows = [] } = useQuery({ queryKey: ['rpt-school', fkey], queryFn: () => getSchoolBreakdown(filters), enabled: onOverview })
  const { data: validation } = useQuery({ queryKey: ['rpt-validation', fkey], queryFn: () => getValidationSummary(filters), enabled: onOverview })

  if (!canView) return <AccessDenied />

  // Print header context: resolved date range + human filter summary (EN/BM).
  const printFilters = describeReportFilters(t, filters, {
    state: states.find((s) => s.id === filters.stateId)?.name,
    pld: plds.find((p) => p.id === filters.pldId)?.name,
    school: schools.find((s) => s.id === filters.schoolId)?.name,
  })

  return (
    <PageWrapper>
      <PageHead
        title={t('reports.title')}
        description={t('reports.description')}
        action={
          <div className="flex items-center gap-2">
            <HelpTip
              title={t('helpTips.reportExport.title')}
              what={t('helpTips.reportExport.what')}
              who={t('helpTips.reportExport.who')}
              reversible={t('helpTips.reportExport.reversible')}
              align="right"
            />
            {onOverview && (
              <Button
                variant="outline"
                size="sm"
                disabled={!canExport || stateRows.length === 0}
                onClick={() => {
                  downloadStatesCsv(stateRows)
                  if (profile) writeAuditLog(profile.id, 'report.exported', 'report', undefined, { scope: 'national', kind: 'state_breakdown' })
                }}
              >
                {t('reports.exportCsv')}
              </Button>
            )}
            <PrintReportButton />
          </div>
        }
      />

      <ReportFilters
        value={filters}
        onChange={setFilters}
        states={stateOpts}
        plds={pldOpts}
        schools={schoolOpts}
        showGender
        ageScheme="kpm"
      />

      {/* KPM section tabs (screen only — the print shell captures the open tab) */}
      <div className="flex gap-1 border-b border-line mb-5 overflow-x-auto scrollbar-none print:hidden">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.key}
            onClick={() => setTab(tabDef.key)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
              tab === tabDef.key
                ? 'border-primary text-primary'
                : 'border-transparent text-text-dim hover:text-text',
            )}
          >
            {t(tabDef.labelKey)}
          </button>
        ))}
      </div>

      <ReportPrintShell
        title={`${t('reports.title')} — ${t(TABS.find((x) => x.key === tab)!.labelKey)}`}
        range={rangeLabel(t, filters)}
        filtersSummary={printFilters}
      >

      {tab === 'overview' && (
        <>
          {/* Trusted period summary (kpm_report_summary, migration 061) */}
          <KpmSummaryCards filters={filters} />

          {/* Submitted vs validated trend (kpm_score_trend) */}
          <KpmScoreFunnelTrend filters={filters} />

          {/* Validation workload (operational widget) */}
          <SectionCard title={t('reports.validationSummary')} className="mb-6">
            {validation
              ? <ValidationSummary data={validation} />
              : <p className="text-sm text-text-faint py-4 text-center">{t('common.loading')}</p>}
          </SectionCard>

          {/* Period breakdown by any dimension (kpm_report_breakdown) */}
          <KpmDimensionBreakdown filters={filters} defaultDim="state" />

          {/* Legacy all-time coverage tables (migration 025 views) */}
          <SectionCard title={t('reports.stateBreakdown')} className="mb-6">
            <BreakdownTable<StateBreakdownRow>
              rows={stateRows}
              getKey={(r) => r.state_id}
              emptyTitle={t('overview.noStateData')}
              columns={stateColumns(t)}
            />
          </SectionCard>

          <SectionCard title={t('reports.pldBreakdown')} className="mb-6">
            <BreakdownTable<PLDBreakdownRow>
              rows={pldRows}
              getKey={(r) => r.pld_id}
              emptyTitle={t('reports.noPldData')}
              columns={pldColumns(t)}
            />
          </SectionCard>

          <SectionCard title={t('reports.schoolActivity')} className="mb-6">
            <BreakdownTable<SchoolBreakdownRow>
              rows={schoolRows}
              getKey={(r) => r.school_id}
              emptyTitle={t('reports.noSchoolData')}
              columns={schoolColumns(t)}
            />
          </SectionCard>
        </>
      )}

      {tab === 'training'    && <KpmTrainingSection filters={filters} />}
      {tab === 'coaches'     && <KpmCoachSection filters={filters} defaultGroupBy="state" />}
      {tab === 'retention'   && <KpmRetentionSection filters={filters} defaultGroupBy="state" />}
      {tab === 'performance' && <KpmPerformanceSection filters={filters} defaultGroupBy="state" />}
      {tab === 'talent'      && <KpmTalentSection filters={filters} defaultGroupBy="state" />}
      {tab === 'health'      && <KpmHealthSection filters={filters} defaultLevel="state" />}
      {tab === 'quality'     && <KpmDataQualitySection filters={filters} showEquipment defaultScopeBy="state" />}

      </ReportPrintShell>
    </PageWrapper>
  )
}

// ─── LEGACY COLUMN DEFINITIONS (migration 025 views) ─────────────────────────

type Translate = (key: string, vars?: Record<string, string | number>) => string

const stateColumns = (t: Translate): Column<StateBreakdownRow>[] => [
  { key: 'state',    header: t('common.state'),     render: (r) => <span className="font-medium text-text">{r.state}</span> },
  { key: 'archers',  header: t('nav.archers'),   render: (r) => `${r.active_archers}/${r.registered_archers}`, align: 'right' },
  { key: 'coaches',  header: t('nav.coaches'),   render: (r) => r.coaches, align: 'right', hide: 'sm' },
  { key: 'schools',  header: t('nav.schools'),   render: (r) => `${r.schools_reporting}/${r.schools_total}`, align: 'right', hide: 'sm' },
  { key: 'scores',   header: t('common.scores'),    render: (r) => r.scores_submitted, align: 'right' },
  { key: 'approved', header: t('status.approved'),  render: (r) => r.approved_scores, align: 'right' },
  { key: 'avg',      header: t('common.average'),       render: (r) => r.avg_score || '—', align: 'right', hide: 'md' },
  { key: 'top',      header: t('reports.top'),       render: (r) => r.top_score || '—', align: 'right', hide: 'md' },
]

const pldColumns = (t: Translate): Column<PLDBreakdownRow>[] => [
  { key: 'pld',      header: t('common.pld'),      render: (r) => <span className="font-medium text-text">{r.pld}</span> },
  { key: 'state',    header: t('common.state'),    render: (r) => r.state, hide: 'sm' },
  { key: 'archers',  header: t('nav.archers'),  render: (r) => `${r.active_archers}/${r.registered_archers}`, align: 'right' },
  { key: 'schools',  header: t('nav.schools'),  render: (r) => `${r.schools_reporting}/${r.schools_total}`, align: 'right', hide: 'sm' },
  { key: 'scores',   header: t('common.scores'),   render: (r) => r.scores_submitted, align: 'right' },
  { key: 'approved', header: t('status.approved'), render: (r) => r.approved_scores, align: 'right' },
  { key: 'top',      header: t('reports.top'),      render: (r) => r.top_score || '—', align: 'right', hide: 'md' },
]

const schoolColumns = (t: Translate): Column<SchoolBreakdownRow>[] => [
  { key: 'school',   header: t('common.school'),   render: (r) => <span className="font-medium text-text">{r.school}</span> },
  { key: 'pld',      header: t('common.pld'),      render: (r) => r.pld ?? '—', hide: 'md' },
  { key: 'state',    header: t('common.state'),    render: (r) => r.state, hide: 'sm' },
  { key: 'archers',  header: t('nav.archers'),  render: (r) => `${r.active_archers}/${r.registered_archers}`, align: 'right' },
  { key: 'coaches',  header: t('nav.coaches'),  render: (r) => r.coaches, align: 'right', hide: 'md' },
  { key: 'scores',   header: t('common.scores'),   render: (r) => r.scores_submitted, align: 'right' },
  { key: 'approved', header: t('status.approved'), render: (r) => r.approved_scores, align: 'right' },
  { key: 'last',     header: t('archerDetail.lastActivity'), render: (r) => r.last_activity ? formatDate(r.last_activity) : '—', align: 'right', hide: 'sm' },
]

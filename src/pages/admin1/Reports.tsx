import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { EmptyState, HelpTip } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { ReportFilters } from '@/components/reports/ReportFilters'
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
import { useRuleValue } from '@/hooks/useSystemRules'
import { useHasPermission } from '@/hooks/useRolePermissions'
import { canViewReports, isOperationalAdmin } from '@/lib/permissions'
import { getAdminScope, getScopeLabel, assignmentsSummary } from '@/lib/scope'
import { getAdmin1Scopes } from '@/services/adminScopes'
import { getActiveStates, getActivePLDs, getActiveSchools } from '@/services/organization'
import {
  getSchoolBreakdown, getValidationSummary, scopeToFilters,
  type ReportFilters as Filters, type SchoolBreakdownRow,
} from '@/services/reports'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'

/**
 * Admin 1 — scoped KPM reporting view.
 *
 * Scope safety is enforced twice: the page narrows filters to the selected
 * assignment, AND every KPM RPC is SECURITY INVOKER, so RLS (migrations
 * 052/054/063) re-scopes whatever reaches the database. National data is
 * never exposed here; equipment data-quality (admin2-only) is hidden.
 */

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

export default function Admin1Reports() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const role = profile?.role
  const canView = useHasPermission(role, 'view_school_reports', canViewReports(role))
  const moduleEnabled = useRuleValue<boolean>('module_reports_enabled', true)

  const [filters, setFilters] = useState<Filters>({ preset: '3m' })
  const [scopeSel, setScopeSel] = useState('') // "level:id" from multi-scope assignments
  const [tab, setTab] = useState<KpmTab>('overview')

  // Multi-scope assignments (migration 052) — pick one entity at a time to report on.
  const { data: assignments = [] } = useQuery({
    queryKey: ['my-admin1-scopes', profile?.id],
    queryFn: () => getAdmin1Scopes(profile!.id),
    enabled: !!profile?.id,
    staleTime: 60_000,
  })
  const multiScoped = assignments.length > 0
  const effectiveSel = scopeSel || (assignments[0] ? `${assignments[0].level}:${assignments[0].ref_id}` : '')

  // Resolve the admin's effective scope (assignments → assigned → derived → none).
  const scope = useMemo(() => getAdminScope(profile ?? null), [profile])
  const scoped = useMemo(() => {
    if (multiScoped && effectiveSel) {
      const [level, id] = effectiveSel.split(':')
      return {
        ...filters,
        stateId:  level === 'state'  ? id : undefined,
        pldId:    level === 'pld'    ? id : undefined,
        schoolId: level === 'school' ? id : undefined,
      } as Filters
    }
    return scopeToFilters(scope, filters)
  }, [multiScoped, effectiveSel, scope, filters])
  const fkey = JSON.stringify(scoped)
  const hasScope = multiScoped || scope.type !== 'none'
  const onOverview = tab === 'overview'

  // Org names for the scope banner.
  const { data: states = [] } = useQuery({ queryKey: ['rpt-states'], queryFn: getActiveStates, staleTime: 300_000 })
  const { data: plds = [] }   = useQuery({ queryKey: ['rpt-plds'],   queryFn: getActivePLDs,   staleTime: 300_000 })
  const { data: schools = [] }= useQuery({ queryKey: ['rpt-schools'],queryFn: getActiveSchools,staleTime: 300_000 })

  const scopeNames = useMemo(() => ({
    state:  states.find((s) => s.id === scope.stateId)?.name,
    pld:    plds.find((p) => p.id === scope.pldId)?.name,
    school: schools.find((s) => s.id === scope.schoolId)?.name,
  }), [states, plds, schools, scope])

  // Legacy school coverage table (migration 025 view) — Overview tab only.
  const { data: schoolRows = [] } = useQuery({ queryKey: ['a1-school', fkey], queryFn: () => getSchoolBreakdown(scoped), enabled: hasScope && onOverview })
  const { data: validation } = useQuery({ queryKey: ['a1-validation', fkey], queryFn: () => getValidationSummary(scoped), enabled: hasScope && onOverview })

  if (!canView) return <AccessDenied />
  if (!moduleEnabled && !isOperationalAdmin(role)) {
    return <FeatureUnavailable title={t('admin1.reportsUnavailable')} message={t('admin1.reportsUnavailableHint')} />
  }

  // Print header context: resolved date range + human filter summary (EN/BM).
  const printFilters = describeReportFilters(t, scoped, {
    state: states.find((s) => s.id === scoped.stateId)?.name,
    pld: plds.find((p) => p.id === scoped.pldId)?.name,
    school: schools.find((s) => s.id === scoped.schoolId)?.name,
  })

  return (
    <PageWrapper>
      <PageHead
        title={t('admin1.scopedReports')}
        description={t('admin1.reportsDescription')}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <PrintReportButton />
            <a href="/admin1/state-report"
              className="inline-flex items-center px-4 py-2 rounded-[var(--r-sm)] bg-primary text-primary-on text-sm font-semibold hover:opacity-90 transition-opacity">
              {t('admin1.generateStateReport')} →
            </a>
          </div>
        }
      />

      {/* Scope banner */}
      <div className={`card mb-5 flex items-center gap-3 flex-wrap ${hasScope ? '' : 'border-warning'}`}>
        <div className={`w-2.5 h-2.5 rounded-full ${hasScope ? 'bg-success' : 'bg-warning'}`} />
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-text-faint font-semibold flex items-center gap-1.5">
            {t('admin1.reportingScope')}
            <HelpTip
              title={t('helpTips.reportScope.title')}
              what={t('helpTips.reportScope.what')}
              who={t('helpTips.reportScope.who')}
              reversible={t('helpTips.reportScope.reversible')}
            />
          </div>
          <div className="font-semibold text-sm text-text">
            {multiScoped
              ? `${t('admin1.assigned')} — ${assignmentsSummary(t, assignments)}`
              : getScopeLabel(t, profile ?? null, scopeNames)}
          </div>
        </div>
        {multiScoped && (
          <select
            value={effectiveSel}
            onChange={(e) => setScopeSel(e.target.value)}
            className="field text-sm py-1.5 ml-auto w-auto"
          >
            {assignments.map((a) => {
              const name =
                a.level === 'state' ? states.find((s) => s.id === a.ref_id)?.name
                : a.level === 'pld' ? plds.find((p) => p.id === a.ref_id)?.name
                : schools.find((s) => s.id === a.ref_id)?.name
              return (
                <option key={`${a.level}:${a.ref_id}`} value={`${a.level}:${a.ref_id}`}>
                  {a.level === 'state' ? `${t('common.state')}: ` : a.level === 'pld' ? `${t('common.pld')}: ` : `${t('common.school')}: `}{name ?? a.ref_id}
                </option>
              )
            })}
          </select>
        )}
      </div>

      {!hasScope ? (
        <EmptyState
          title={t('admin1.noScope')}
          description={t('admin1.noScopeHint')}
        />
      ) : (
        <>
          <ReportFilters value={filters} onChange={setFilters} showBow showAge showGender ageScheme="kpm" />

          {/* KPM section tabs (screen only) */}
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
            title={`${t('admin1.scopedReports')} — ${t(TABS.find((x) => x.key === tab)!.labelKey)}`}
            range={rangeLabel(t, scoped)}
            filtersSummary={printFilters}
          >

          {tab === 'overview' && (
            <>
              {/* Trusted period summary (kpm_report_summary — RLS re-scopes) */}
              <KpmSummaryCards filters={scoped} />

              {/* Submitted vs validated trend */}
              <KpmScoreFunnelTrend filters={scoped} />

              {/* Validation workload (operational widget) */}
              <SectionCard title={t('reports.validationSummary')} className="mb-6">
                {validation
                  ? <ValidationSummary data={validation} />
                  : <p className="text-sm text-text-faint py-4 text-center">{t('common.loading')}</p>}
              </SectionCard>

              {/* Period breakdown by any dimension */}
              <KpmDimensionBreakdown filters={scoped} defaultDim="school" />

              {/* Legacy school coverage table (migration 025 view) */}
              <SectionCard title={t('reports.schoolActivity')} className="mb-6">
                <BreakdownTable<SchoolBreakdownRow>
                  rows={schoolRows}
                  getKey={(r) => r.school_id}
                  emptyTitle={t('admin1.noSchoolActivity')}
                  columns={schoolColumns(t)}
                />
              </SectionCard>
            </>
          )}

          {tab === 'training'    && <KpmTrainingSection filters={scoped} />}
          {tab === 'coaches'     && <KpmCoachSection filters={scoped} defaultGroupBy="school" />}
          {tab === 'retention'   && <KpmRetentionSection filters={scoped} defaultGroupBy="school" />}
          {tab === 'performance' && <KpmPerformanceSection filters={scoped} defaultGroupBy="school" />}
          {tab === 'talent'      && <KpmTalentSection filters={scoped} defaultGroupBy="school" />}
          {tab === 'health'      && <KpmHealthSection filters={scoped} defaultLevel="school" />}
          {/* Equipment DQ hidden: scoring.equipment_setups has no admin1 read policy. */}
          {tab === 'quality'     && <KpmDataQualitySection filters={scoped} showEquipment={false} defaultScopeBy="school" />}

          </ReportPrintShell>
        </>
      )}
    </PageWrapper>
  )
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

const schoolColumns = (t: Translate): Column<SchoolBreakdownRow>[] => [
  { key: 'school',   header: t('common.school'),   render: (r) => <span className="font-medium text-text">{r.school}</span> },
  { key: 'archers',  header: t('nav.archers'),  render: (r) => `${r.active_archers}/${r.registered_archers}`, align: 'right' },
  { key: 'coaches',  header: t('nav.coaches'),  render: (r) => r.coaches, align: 'right', hide: 'sm' },
  { key: 'scores',   header: t('common.scores'),   render: (r) => r.scores_submitted, align: 'right' },
  { key: 'approved', header: t('status.approved'), render: (r) => r.approved_scores, align: 'right' },
  { key: 'last',     header: t('archerDetail.lastActivity'), render: (r) => r.last_activity ? formatDate(r.last_activity) : '—', align: 'right', hide: 'sm' },
]

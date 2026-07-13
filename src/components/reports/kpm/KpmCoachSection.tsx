import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Badge } from '@/components/ui'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate } from '@/utils/dates'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmCoachCoverage, getKpmCoachCoverageBreakdown, getKpmCoachWorkload,
  getKpmCertificationExpiry, getKpmCoachCertifications, getKpmSchoolsWithoutCoach,
  type KpmCoachGroupBy, type KpmCoachBreakdownRow, type KpmCoachWorkloadRow,
  type KpmCertificationExpiryRow, type KpmCoachCertRow,
} from '@/services/kpmMetrics'
import {
  fmtNum, GroupBySelect, KpmBackendNotice, CertStatusBadge, ShowingNote,
  groupRowLabel, ORG_DIMS,
} from './shared'
import { CoachCertModal, CoachMetricModal, SchoolsWithoutCoachModal } from './KpmCoachModals'

/**
 * Section 3 — "Coach Support Analytics" (KPM Q5: are coaches supporting
 * development?). Deliberately NOT a coach ranking: workload and expiry lists
 * are support/renewal task lists, straight from migration 063 RPCs.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const GROUP_OPTS: { value: KpmCoachGroupBy; labelKey: string }[] = [
  ...ORG_DIMS,
  { value: 'certification_level',  labelKey: 'kpm.coach.certLevel' },
  { value: 'certification_status', labelKey: 'kpm.coach.certStatus' },
  { value: 'experience_band',      labelKey: 'kpm.coach.experienceBand' },
]

const LIST_LIMIT = 30

// Card → which coaches its certificate drill-down lists (mirrors migration 063
// coverage-summary logic so the list length matches the card number).
const approvedCoach = (c: KpmCoachCertRow) => c.coach_status === 'approved'
const CERT_FILTERS: Record<string, (c: KpmCoachCertRow) => boolean> = {
  total:       () => true,
  active:      approvedCoach,
  certified:   (c) => approvedCoach(c) && c.has_valid_cert,
  uncertified: (c) => approvedCoach(c) && !c.has_valid_cert,
  expired:     (c) => approvedCoach(c) && !c.has_valid_cert && c.has_expired_cert,
  expiring:    (c) => approvedCoach(c) && c.has_valid_cert && c.days_to_expiry != null && c.days_to_expiry <= 90,
}

const breakdownColumns = (t: Translate, groupBy: KpmCoachGroupBy): Column<KpmCoachBreakdownRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => <span className="font-medium text-text">{groupRowLabel(t, groupBy, r.group_label ?? r.group_key)}</span>,
  },
  { key: 'coaches',     header: t('nav.coaches'),           render: (r) => r.coaches, align: 'right' },
  { key: 'certified',   header: t('kpm.coach.certified'),   render: (r) => r.certified, align: 'right' },
  { key: 'uncertified', header: t('kpm.coach.uncertified'), render: (r) => r.uncertified, align: 'right', hide: 'sm' },
  { key: 'expired',     header: t('kpm.coach.expired'),     render: (r) => r.expired, align: 'right', hide: 'sm' },
  { key: 'expiring',    header: t('kpm.coach.expiringSoon'), render: (r) => r.expiring_soon, align: 'right', hide: 'md' },
  { key: 'exp',         header: t('kpm.coach.avgExperience'), render: (r) => fmtNum(r.avg_experience), align: 'right', hide: 'md' },
]

const workloadColumns = (t: Translate): Column<KpmCoachWorkloadRow>[] => [
  { key: 'coach',  header: t('roles.coach'),  render: (r) => <span className="font-medium text-text">{r.coach_name ?? '—'}</span> },
  { key: 'school', header: t('common.school'), render: (r) => r.school ?? r.pld ?? r.state ?? '—', hide: 'md' },
  { key: 'cert',   header: t('kpm.coach.certStatus'), render: (r) => <CertStatusBadge status={r.cert_status} /> },
  { key: 'active', header: t('kpm.coach.linkedActive'), render: (r) => r.linked_active, align: 'right' },
  { key: 'pending', header: t('status.pending'), render: (r) => r.pending_links, align: 'right', hide: 'sm' },
  { key: 'activeStudents', header: t('kpm.coach.studentsActive'), render: (r) => r.active_students_with_activity, align: 'right', hide: 'sm' },
  {
    key: 'recent', header: t('kpm.coach.recentActivity'), align: 'right',
    render: (r) => r.has_recent_activity
      ? <Badge variant="success">{t('common.yes')}</Badge>
      : <Badge variant="neutral">{t('common.no')}</Badge>,
  },
]

function daysBadge(t: Translate, days: number | null) {
  if (days == null) return <span className="text-text-faint">—</span>
  if (days < 0)   return <Badge variant="danger">{t('kpm.coach.expiredDays', { days: Math.abs(days) })}</Badge>
  if (days <= 30) return <Badge variant="danger">{t('kpm.coach.daysLeft', { days })}</Badge>
  if (days <= 90) return <Badge variant="warning">{t('kpm.coach.daysLeft', { days })}</Badge>
  return <Badge variant="neutral">{t('kpm.coach.daysLeft', { days })}</Badge>
}

const expiryColumns = (t: Translate): Column<KpmCertificationExpiryRow>[] => [
  { key: 'coach',  header: t('roles.coach'),  render: (r) => <span className="font-medium text-text">{r.coach_name ?? '—'}</span> },
  { key: 'scope',  header: t('common.school'), render: (r) => r.school ?? r.pld ?? r.state ?? '—', hide: 'md' },
  { key: 'level',  header: t('kpm.coach.certLevel'), render: (r) => r.latest_cert_level ?? '—', hide: 'sm' },
  { key: 'status', header: t('kpm.coach.certStatus'), render: (r) => <CertStatusBadge status={r.cert_status} /> },
  { key: 'expiry', header: t('kpm.coach.expiresOn'), render: (r) => r.max_cert_expiry ? formatDate(r.max_cert_expiry) : '—', align: 'right', hide: 'sm' },
  { key: 'days',   header: t('kpm.coach.daysToExpiry'), render: (r) => daysBadge(t, r.days_to_expiry), align: 'right' },
]

export function KpmCoachSection({
  filters, defaultGroupBy = 'state',
}: {
  filters: ReportFilters
  defaultGroupBy?: KpmCoachGroupBy
}) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const [groupBy, setGroupBy] = useState<KpmCoachGroupBy>(defaultGroupBy)
  const [certPick, setCertPick] = useState<{ titleKey: string; explainKey: string; filter: (c: KpmCoachCertRow) => boolean } | null>(null)
  const [metricPick, setMetricPick] = useState<{ title: string; value: React.ReactNode; howKey: string } | null>(null)
  const [schoolsOpen, setSchoolsOpen] = useState(false)

  const { data: cov, error: e1 } = useQuery({
    queryKey: ['kpm-coach-cov', fkey],
    queryFn: () => getKpmCoachCoverage(filters),
    staleTime: 120_000,
  })
  const { data: rows = [], error: e2 } = useQuery({
    queryKey: ['kpm-coach-bd', groupBy, fkey],
    queryFn: () => getKpmCoachCoverageBreakdown(groupBy, filters),
    staleTime: 120_000,
  })
  const { data: workload = [], error: e3 } = useQuery({
    queryKey: ['kpm-coach-work', fkey],
    queryFn: () => getKpmCoachWorkload(filters),
    staleTime: 120_000,
  })
  const { data: expiry = [], error: e4 } = useQuery({
    queryKey: ['kpm-coach-exp', fkey],
    queryFn: () => getKpmCertificationExpiry(filters),
    staleTime: 120_000,
  })
  // Per-coach certificate list — fetched once a certificate card is opened.
  const { data: coachCerts = [], isFetching: certsLoading, error: certsError } = useQuery({
    queryKey: ['kpm-coach-certs', fkey],
    queryFn: () => getKpmCoachCertifications(filters),
    staleTime: 120_000,
    enabled: certPick != null,
  })
  // Schools with no approved coach — fetched once that card is opened.
  const { data: schoolsNoCoach = [], isFetching: schoolsLoading, error: schoolsError } = useQuery({
    queryKey: ['kpm-coach-schools', fkey],
    queryFn: () => getKpmSchoolsWithoutCoach(filters),
    staleTime: 120_000,
    enabled: schoolsOpen,
  })

  const backendError = e1 ?? e2 ?? e3 ?? e4

  return (
    <>
      {backendError != null && <KpmBackendNotice migrations="063" error={backendError} />}

      {/* Coverage cards — certificate cards list coaches + their certificates;
          coverage cards explain how they are calculated. */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-1">
        <StatCard label={t('kpm.coach.totalCoaches')}  value={fmtNum(cov?.total_coaches)}
          tone="primary"
          onClick={() => setCertPick({ titleKey: 'kpm.coach.totalCoaches', explainKey: 'kpm.coach.explain.total', filter: CERT_FILTERS.total })} />
        <StatCard label={t('kpm.coach.activeCoaches')} value={fmtNum(cov?.active_coaches)} accent
          onClick={() => setCertPick({ titleKey: 'kpm.coach.activeCoaches', explainKey: 'kpm.coach.explain.active', filter: CERT_FILTERS.active })} />
        <StatCard label={t('kpm.coach.certified')}     value={fmtNum(cov?.certified_coaches)}
          tone="success"
          progressPct={cov?.active_coaches ? Math.round(((cov.certified_coaches ?? 0) / cov.active_coaches) * 100) : null}
          onClick={() => setCertPick({ titleKey: 'kpm.coach.certified', explainKey: 'kpm.coach.explain.certified', filter: CERT_FILTERS.certified })} />
        <StatCard label={t('kpm.coach.uncertified')}   value={fmtNum(cov?.uncertified_coaches)}
          tone={(cov?.uncertified_coaches ?? 0) > 0 ? 'warning' : 'success'}
          onClick={() => setCertPick({ titleKey: 'kpm.coach.uncertified', explainKey: 'kpm.coach.explain.uncertified', filter: CERT_FILTERS.uncertified })} />
        <StatCard label={t('kpm.coach.expiredCerts')}  value={fmtNum(cov?.expired_cert_coaches)} badge={cov?.expired_cert_coaches}
          tone={(cov?.expired_cert_coaches ?? 0) > 0 ? 'danger' : 'success'}
          onClick={() => setCertPick({ titleKey: 'kpm.coach.expiredCerts', explainKey: 'kpm.coach.explain.expired', filter: CERT_FILTERS.expired })} />
        <StatCard label={t('kpm.coach.expiring90')}    value={fmtNum(cov?.expiring_90)} sub={t('kpm.coach.cumulativeHint')}
          tone={(cov?.expiring_90 ?? 0) > 0 ? 'warning' : 'success'}
          onClick={() => setCertPick({ titleKey: 'kpm.coach.expiring90', explainKey: 'kpm.coach.explain.expiring', filter: CERT_FILTERS.expiring })} />
        <StatCard label={t('kpm.coach.schoolsWithoutCoach')} value={fmtNum(cov?.schools_without_active_coach)} badge={cov?.schools_without_active_coach}
          tone={(cov?.schools_without_active_coach ?? 0) > 0 ? 'danger' : 'success'}
          onClick={() => setSchoolsOpen(true)} />
        <StatCard label={t('kpm.coach.archersPerCoach')} value={fmtNum(cov?.archers_per_active_coach)} sub={t('kpm.coach.activeArchersHint')}
          tone="neutral"
          onClick={() => setMetricPick({ title: t('kpm.coach.archersPerCoach'), value: fmtNum(cov?.archers_per_active_coach), howKey: 'kpm.coach.explain.archersPer' })} />
        <StatCard label={t('kpm.coach.pendingLinks')}  value={fmtNum(cov?.pending_link_approvals)} badge={cov?.pending_link_approvals}
          tone={(cov?.pending_link_approvals ?? 0) > 0 ? 'warning' : 'success'}
          onClick={() => setMetricPick({ title: t('kpm.coach.pendingLinks'), value: fmtNum(cov?.pending_link_approvals), howKey: 'kpm.coach.explain.pendingLinks' })} />
        <StatCard label={t('kpm.coach.avgLinked')}     value={fmtNum(cov?.avg_linked_per_active_coach)}
          tone="neutral"
          onClick={() => setMetricPick({ title: t('kpm.coach.avgLinked'), value: fmtNum(cov?.avg_linked_per_active_coach), howKey: 'kpm.coach.explain.avgLinked' })} />
        <StatCard label={t('kpm.coach.noLinkedArchers')} value={fmtNum(cov?.coaches_no_linked_archers)}
          tone={(cov?.coaches_no_linked_archers ?? 0) > 0 ? 'warning' : 'success'}
          onClick={() => setMetricPick({ title: t('kpm.coach.noLinkedArchers'), value: fmtNum(cov?.coaches_no_linked_archers), howKey: 'kpm.coach.explain.noArchers' })} />
        <StatCard label={t('kpm.coach.stale')}         value={fmtNum(cov?.coaches_stale)} sub={t('kpm.coach.staleHint')}
          tone={(cov?.coaches_stale ?? 0) > 0 ? 'danger' : 'success'}
          onClick={() => setMetricPick({ title: t('kpm.coach.stale'), value: fmtNum(cov?.coaches_stale), howKey: 'kpm.coach.explain.stale' })} />
      </div>
      <p className="text-[11px] text-text-faint mb-4">{t('kpm.coach.clickCardHint')}</p>

      {/* Data-conflict callout: is_certified flag without a cert record */}
      {(cov?.certified_by_flag_only ?? 0) > 0 && (
        <p className="text-sm text-warning bg-warning-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-6">
          {t('kpm.coach.flagOnlyWarning', { count: cov!.certified_by_flag_only })}
        </p>
      )}

      {/* Breakdown */}
      <SectionCard title={t('kpm.coach.breakdown')} className="mb-6">
        <GroupBySelect value={groupBy} onChange={setGroupBy} options={GROUP_OPTS} />
        <BreakdownTable<KpmCoachBreakdownRow>
          rows={rows}
          getKey={(r) => `${r.group_key ?? r.group_label ?? 'null'}`}
          emptyTitle={t('common.noData')}
          columns={breakdownColumns(t, groupBy)}
        />
      </SectionCard>

      {/* Workload list */}
      <SectionCard title={t('kpm.coach.workload')} className="mb-6">
        <BreakdownTable<KpmCoachWorkloadRow>
          rows={workload.slice(0, LIST_LIMIT)}
          getKey={(r) => r.coach_id}
          emptyTitle={t('common.noData')}
          columns={workloadColumns(t)}
        />
        <ShowingNote shown={Math.min(LIST_LIMIT, workload.length)} total={workload.length} />
      </SectionCard>

      {/* Certification expiry list */}
      <SectionCard title={t('kpm.coach.expiryList')} className="mb-6">
        <BreakdownTable<KpmCertificationExpiryRow>
          rows={expiry.slice(0, LIST_LIMIT)}
          getKey={(r) => r.coach_id}
          emptyTitle={t('kpm.coach.noExpiry')}
          columns={expiryColumns(t)}
        />
        <ShowingNote shown={Math.min(LIST_LIMIT, expiry.length)} total={expiry.length} />
        <p className="text-[11px] text-text-faint mt-2">
          {t('kpm.coach.sourceNote')}
        </p>
      </SectionCard>

      {/* Certificate cards → coaches + their certificates (count + type) */}
      <CoachCertModal pick={certPick} coaches={coachCerts} loading={certsLoading} error={certsError} onClose={() => setCertPick(null)} />

      {/* Schools-without-coach card → the actual schools + archer impact */}
      <SchoolsWithoutCoachModal open={schoolsOpen} rows={schoolsNoCoach} loading={schoolsLoading} error={schoolsError} onClose={() => setSchoolsOpen(false)} />

      {/* Coverage cards → how the number is calculated */}
      <CoachMetricModal metric={metricPick} onClose={() => setMetricPick(null)} />
    </>
  )
}

export default KpmCoachSection

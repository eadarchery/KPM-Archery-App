import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import {
  Button,
  CertBadge,
  RoleBadge,
  Input,
  Textarea,
  Modal,
  Select,
  EmptyState,
  useToast,
  Badge,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { writeAuditLog } from '@/services/auditLog'
import {
  getAdminReviewPage,
  getAdminReviewSummary,
  type AdminReviewCursor,
} from '@/services/adminReviewQueues'
import { formatDate, daysUntil, isExpired } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { CertificationStatus } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

type CertTab = 'pending_review' | 'approved' | 'rejected' | 'expiring_soon' | 'all'

interface CertFilters {
  stateCode:   string
  pldId:       string
  schoolId:    string
  certLevel:   string
  issuer:      string
  status:      string
  issuedFrom:  string
  issuedTo:    string
  expiryFrom:  string
  expiryTo:    string
}

const DEFAULT_FILTERS: CertFilters = {
  stateCode: '', pldId: '', schoolId: '', certLevel: '',
  issuer: '', status: '', issuedFrom: '', issuedTo: '',
  expiryFrom: '', expiryTo: '',
}

const PAGE_SIZE = 50

interface CoachShape {
  id: string
  name: string
  email: string
  school?: { id: string; name: string }
  pld?:   { id: string; name: string }
  state?: { id: string; name: string; code: string }
}

interface CertRow {
  id: string
  coach_id: string
  title: string
  issuer?: string
  certificate_level?: string
  certificate_number?: string
  issued_date?: string
  expiry_date?: string
  cert_url: string
  status: CertificationStatus
  rejection_reason?: string
  reviewed_by?: string
  reviewed_at?: string
  notes?: string
  created_at: string
  coach: CoachShape | null
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TABS: { key: CertTab; labelKey: string }[] = [
  { key: 'pending_review', labelKey: 'adminCerts.pendingReview' },
  { key: 'approved',       labelKey: 'status.approved'       },
  { key: 'rejected',       labelKey: 'status.rejected'       },
  { key: 'expiring_soon',  labelKey: 'certPage.expiringSoon'  },
  { key: 'all',            labelKey: 'common.all'            },
]

// DB stores English level values; labels are translated at render time.
const CERT_LEVEL_KEYS = [
  { value: '',                         labelKey: 'adminCerts.allLevels' },
  { value: 'School Coach',             labelKey: 'certPage.levelSchool' },
  { value: 'District / PLD Coach',     labelKey: 'certPage.levelPld' },
  { value: 'State Coach',              labelKey: 'certPage.levelState' },
  { value: 'National Coach',           labelKey: 'certPage.levelNational' },
  { value: 'World Archery / External', labelKey: 'certPage.levelExternal' },
  { value: 'Other',                    labelKey: 'adminCerts.levelOther' },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function coachName(r: CertRow)   { return r.coach?.name  ?? '—' }
function coachEmail(r: CertRow)  { return r.coach?.email ?? '—' }
function schoolName(r: CertRow)  { return r.coach?.school?.name ?? '—' }
function pldName(r: CertRow)     { return r.coach?.pld?.name    ?? '—' }
function stateCode_(r: CertRow)  { return r.coach?.state?.code  ?? '—' }

type Translate = (key: string, vars?: Record<string, string | number>) => string

function expiryChip(t: Translate, expiry_date?: string) {
  if (!expiry_date) return null
  if (isExpired(expiry_date)) return <Badge variant="danger">{t('status.expired')}</Badge>
  const d = daysUntil(expiry_date)
  if (d <= 60) return <Badge variant="warning">{t('adminCerts.daysLeft', { days: d })}</Badge>
  return null
}

async function resolveFileUrl(cert_url: string): Promise<string | null> {
  if (cert_url.startsWith('http')) return cert_url
  const { data } = await supabase.storage
    .from('certifications')
    .createSignedUrl(cert_url, 3600)
  return data?.signedUrl ?? null
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function Admin2Certifications() {
  const { profile: actor } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const queryClient = useQueryClient()

  const [tab, setTab]           = useState<CertTab>('pending_review')
  const [search, setSearch]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters]   = useState<CertFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [pageCursors, setPageCursors] = useState<(AdminReviewCursor | null)[]>([null])
  const pageIndex = pageCursors.length - 1
  const cursor = pageCursors[pageIndex]

  const [selectedRow, setSelectedRow]   = useState<CertRow | null>(null)
  const [actionType, setActionType]     = useState<'approve' | 'reject' | 'photo' | 'details' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [reasonErr, setReasonErr]       = useState(false)
  const [acting, setActing]             = useState(false)
  const [photoUrl, setPhotoUrl]         = useState<string | null>(null)
  const [photoLoading, setPhotoLoading] = useState(false)
  const [isPdf, setIsPdf]               = useState(false)

  const setFilter = (key: keyof CertFilters, value: string) =>
    setFilters(f => ({ ...f, [key]: value }))

  const clearFilters = () => setFilters(DEFAULT_FILTERS)
  const activeFilterCount = Object.values(filters).filter(v => v !== '').length

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])

  useEffect(() => {
    setPageCursors([null])
  }, [tab, debouncedSearch, filters])

  // ── Fetch one server-filtered page ───────────────────────────────────────
  const { data: certPage, isLoading, isError } = useQuery({
    queryKey: ['admin-certifications', tab, debouncedSearch, filters, cursor],
    queryFn: () => getAdminReviewPage<CertRow>('certifications', {
      search: debouncedSearch,
      status: tab === 'pending_review' ? 'pending'
        : tab === 'expiring_soon' ? null
        : tab === 'all' ? filters.status
        : tab,
      expiring_soon: tab === 'expiring_soon',
      state_code: filters.stateCode,
      pld_id: filters.pldId,
      school_id: filters.schoolId,
      cert_level: filters.certLevel,
      issuer: filters.issuer,
      issued_from: filters.issuedFrom,
      issued_to: filters.issuedTo,
      expiry_from: filters.expiryFrom,
      expiry_to: filters.expiryTo,
    }, cursor, PAGE_SIZE),
    staleTime: 30_000,
  })
  const certs = certPage?.items ?? []

  // ── Tab counts ────────────────────────────────────────────────────────────
  const { data: counts } = useQuery<Record<CertTab, number>>({
    queryKey: ['admin-certifications-counts'],
    queryFn: () => getAdminReviewSummary<Record<CertTab, number>>('certifications'),
    staleTime: 30_000,
  })

  const filtered = certs

  // ── Derived filter options from loaded data ────────────────────────────────
  const { stateOpts, pldOpts, schoolOpts } = useMemo(() => {
    const stateMap  = new Map<string, string>()
    const pldMap    = new Map<string, string>()
    const schoolMap = new Map<string, string>()
    for (const r of certs) {
      if (r.coach?.state)  stateMap.set(r.coach.state.code, r.coach.state.name)
      if (r.coach?.pld)    pldMap.set(r.coach.pld.id, r.coach.pld.name)
      if (r.coach?.school) schoolMap.set(r.coach.school.id, r.coach.school.name)
    }
    return {
      stateOpts:  [{ value: '', label: t('common.allStates') },  ...[...stateMap.entries()].map(([v, l]) => ({ value: v, label: l }))],
      pldOpts:    [{ value: '', label: t('common.allPlds') },    ...[...pldMap.entries()].map(([v, l])   => ({ value: v, label: l }))],
      schoolOpts: [{ value: '', label: t('common.allSchools') }, ...[...schoolMap.entries()].map(([v, l]) => ({ value: v, label: l }))],
    }
  }, [certs, t])

  // ── Action handlers ───────────────────────────────────────────────────────
  const openApprove = (row: CertRow) => { setSelectedRow(row); setActionType('approve'); setRejectReason(''); setReasonErr(false) }
  const openReject  = (row: CertRow) => { setSelectedRow(row); setActionType('reject');  setRejectReason(''); setReasonErr(false) }
  const openDetails = (row: CertRow) => { setSelectedRow(row); setActionType('details') }

  const openPhoto = async (row: CertRow) => {
    setSelectedRow(row)
    setActionType('photo')
    setPhotoUrl(null)
    setPhotoLoading(true)
    setIsPdf(row.cert_url.toLowerCase().includes('.pdf'))

    const url = await resolveFileUrl(row.cert_url)
    setPhotoUrl(url)
    setPhotoLoading(false)

    if (actor?.id) {
      writeAuditLog(actor.id, 'certification.proof_viewed', 'certification', row.id, {
        coach_name: coachName(row), cert_title: row.title, status: row.status,
      })
    }
  }

  const closeModal = () => {
    if (acting) return
    setSelectedRow(null)
    setActionType(null)
    setPhotoUrl(null)
    setRejectReason('')
    setReasonErr(false)
  }

  // ── Approve / Reject submit ───────────────────────────────────────────────
  async function handleAction() {
    if (!selectedRow || !actor?.id) return
    if (actionType === 'reject') {
      if (!rejectReason.trim()) { setReasonErr(true); return }
    }
    setActing(true)
    try {
      const now = new Date().toISOString()
      const updates =
        actionType === 'approve'
          ? { status: 'approved' as CertificationStatus, reviewed_by: actor.id, reviewed_at: now, rejection_reason: null as null }
          : { status: 'rejected' as CertificationStatus, reviewed_by: actor.id, reviewed_at: now, rejection_reason: rejectReason.trim() }

      const { error } = await supabase
        .from('certifications')
        .update(updates)
        .eq('id', selectedRow.id)
      if (error) throw error

      writeAuditLog(actor.id, actionType === 'approve' ? 'certification.approved' : 'certification.rejected', 'certification', selectedRow.id, {
        coach_name: coachName(selectedRow),
        cert_title: selectedRow.title,
        old_status: selectedRow.status,
        new_status: updates.status,
        ...(actionType === 'reject' ? { reason: rejectReason.trim() } : {}),
      })

      ok(actionType === 'approve' ? t('adminCerts.approvedToast') : t('adminCerts.rejectedToast'))
      queryClient.invalidateQueries({ queryKey: ['admin-certifications'] })
      queryClient.invalidateQueries({ queryKey: ['admin-certifications-counts'] })
      closeModal()
    } catch (e: unknown) {
      err((e as Error).message ?? t('common.actionFailed'))
    } finally {
      setActing(false)
    }
  }

  const pendingCount = counts?.pending_review ?? 0

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <PageWrapper>
      <PageHead
        title={t('adminCerts.title')}
        description={t('adminCerts.description')}
        pill={
          pendingCount > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] bg-danger text-white text-[11px] font-bold rounded-full px-1.5">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line mb-5 overflow-x-auto scrollbar-none">
        {TABS.map(tabDef => {
          const cnt = counts?.[tabDef.key] ?? 0
          return (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={cn(
                'relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                tab === tabDef.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-dim hover:text-text',
              )}
            >
              {t(tabDef.labelKey)}
              {cnt > 0 && (
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full px-1',
                  tabDef.key === 'pending_review'
                    ? 'bg-danger text-white'
                    : 'bg-surface-raised text-text-dim',
                )}>
                  {cnt > 99 ? '99+' : cnt}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input
          wrapperClassName="flex-1"
          placeholder={t('adminCerts.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Button
          variant={filtersOpen ? 'primary' : 'secondary'}
          onClick={() => setFiltersOpen(v => !v)}
        >
          {t('common.filters')} {activeFilterCount > 0 && `(${activeFilterCount})`}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" onClick={clearFilters}>{t('common.clear')}</Button>
        )}
      </div>

      {filtersOpen && (
        <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Select
            label={t('common.state')}
            value={filters.stateCode}
            onChange={e => setFilter('stateCode', e.target.value)}
            options={stateOpts}
          />
          <Select
            label={t('common.pld')}
            value={filters.pldId}
            onChange={e => setFilter('pldId', e.target.value)}
            options={pldOpts}
          />
          <Select
            label={t('common.school')}
            value={filters.schoolId}
            onChange={e => setFilter('schoolId', e.target.value)}
            options={schoolOpts}
          />
          <Select
            label={t('adminCerts.certLevel')}
            value={filters.certLevel}
            onChange={e => setFilter('certLevel', e.target.value)}
            options={CERT_LEVEL_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
          />
          <Input
            label={t('adminCerts.issuerContains')}
            value={filters.issuer}
            onChange={e => setFilter('issuer', e.target.value)}
            placeholder={t('adminCerts.issuerPlaceholder')}
          />
          {tab === 'all' && (
            <Select
              label={t('common.status')}
              value={filters.status}
              onChange={e => setFilter('status', e.target.value)}
              options={[
                { value: '',         label: t('common.allStatuses') },
                { value: 'pending',  label: t('status.pending')      },
                { value: 'approved', label: t('status.approved')     },
                { value: 'rejected', label: t('status.rejected')     },
              ]}
            />
          )}
          <Input label={t('adminCerts.issuedFrom')} type="date" value={filters.issuedFrom} onChange={e => setFilter('issuedFrom', e.target.value)} />
          <Input label={t('adminCerts.issuedTo')}   type="date" value={filters.issuedTo}   onChange={e => setFilter('issuedTo',   e.target.value)} />
          <Input label={t('adminCerts.expiryFrom')} type="date" value={filters.expiryFrom} onChange={e => setFilter('expiryFrom', e.target.value)} />
          <Input label={t('adminCerts.expiryTo')}   type="date" value={filters.expiryTo}   onChange={e => setFilter('expiryTo',   e.target.value)} />
        </div>
      )}

      {/* Result count */}
      {!isLoading && !isError && (
        <p className="text-xs text-text-faint mb-3">
          {t('adminCerts.showingRecords', { shown: filtered.length, total: certs.length })}
        </p>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-[var(--r-md)] bg-surface-raised animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <p className="text-sm text-danger text-center py-10">
          {t('adminCerts.loadError')}
        </p>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState
          icon={
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="12" y2="15"/>
            </svg>
          }
          title={t('adminCerts.noneFound')}
          description={search || activeFilterCount > 0 ? t('common.noResultsFilters') : t('adminCerts.noneForTab')}
        />
      )}

      {/* Desktop table */}
      {!isLoading && !isError && filtered.length > 0 && (
        <>
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {[t('roles.coach'), t('adminCerts.schoolPld'), t('common.title'), t('certPage.level'), t('certPage.issued'), t('certPage.expires'), t('archerProfile.submitted'), t('common.status'), t('common.actions')].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint pb-2 pr-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(row => (
                  <CertTableRow
                    key={row.id}
                    row={row}
                    onApprove={openApprove}
                    onReject={openReject}
                    onPhoto={openPhoto}
                    onDetails={openDetails}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map(row => (
              <CertMobileCard
                key={row.id}
                row={row}
                onApprove={openApprove}
                onReject={openReject}
                onPhoto={openPhoto}
                onDetails={openDetails}
              />
            ))}
          </div>
          <div className="flex items-center justify-between mt-5">
            <Button
              variant="secondary"
              disabled={pageIndex === 0}
              onClick={() => setPageCursors(current => current.slice(0, -1))}
            >
              {t('common.previous')}
            </Button>
            <span className="text-xs text-text-faint">{t('adminUsers.page', { page: pageIndex + 1 })}</span>
            <Button
              variant="secondary"
              disabled={!certPage?.nextCursor}
              onClick={() => certPage?.nextCursor && setPageCursors(current => [...current, certPage.nextCursor])}
            >
              {t('common.next')}
            </Button>
          </div>
        </>
      )}

      {/* Approve modal */}
      <Modal
        open={actionType === 'approve'}
        onClose={closeModal}
        title={t('adminCerts.approveTitle')}
      >
        {selectedRow && (
          <>
            <p className="text-sm text-text-dim mb-1">{t('adminCerts.youAreApproving')}</p>
            <div className="bg-surface-raised rounded-[var(--r-md)] p-3 mb-5 text-sm space-y-1">
              <p><strong>{selectedRow.title}</strong></p>
              <p className="text-text-dim">{t('roles.coach')}: {coachName(selectedRow)}</p>
              {selectedRow.issuer && <p className="text-text-dim">{t('certPage.issuerCol')}: {selectedRow.issuer}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModal} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="success" onClick={handleAction} disabled={acting}>
                {acting ? t('common.approving') : t('common.approve')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal
        open={actionType === 'reject'}
        onClose={closeModal}
        title={t('adminCerts.rejectTitle')}
      >
        {selectedRow && (
          <>
            <p className="text-sm text-text-dim mb-4">
              {t('adminCerts.rejectingIntro', { title: selectedRow.title, coach: coachName(selectedRow) })}
            </p>
            <Textarea
              label={t('adminCerts.rejectionReason')}
              value={rejectReason}
              onChange={e => { setRejectReason(e.target.value); setReasonErr(false) }}
              error={reasonErr ? t('adminCerts.reasonRequired') : undefined}
              placeholder={t('adminCerts.rejectionPlaceholder')}
              minRows={3}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={closeModal} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={handleAction} disabled={acting}>
                {acting ? t('common.rejecting') : t('common.reject')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Photo modal */}
      <Modal
        open={actionType === 'photo'}
        onClose={closeModal}
        title={selectedRow?.title ?? t('certPage.viewProof')}
        width="min(820px,100%)"
      >
        {photoLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!photoLoading && photoUrl && isPdf && (
          <div className="text-center py-6">
            <p className="text-sm text-text-dim mb-4">{t('certPage.pdfNewTab')}</p>
            <Button variant="primary" onClick={() => window.open(photoUrl, '_blank')}>{t('certPage.openPdf')}</Button>
          </div>
        )}
        {!photoLoading && photoUrl && !isPdf && (
          <img src={photoUrl} alt={t('adminCerts.proofAlt')} className="w-full max-h-[70vh] object-contain rounded-[var(--r-md)]" />
        )}
        {!photoLoading && !photoUrl && (
          <p className="text-sm text-text-dim text-center py-8">{t('certPage.proofLoadFailed')}</p>
        )}
      </Modal>

      {/* Details modal */}
      <Modal
        open={actionType === 'details'}
        onClose={closeModal}
        title={t('adminCerts.detailsTitle')}
        width="min(680px,100%)"
      >
        {selectedRow && <CertDetails row={selectedRow} />}
      </Modal>
    </PageWrapper>
  )
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function CertTableRow({
  row,
  onApprove,
  onReject,
  onPhoto,
  onDetails,
}: {
  row: CertRow
  onApprove: (r: CertRow) => void
  onReject:  (r: CertRow) => void
  onPhoto:   (r: CertRow) => void
  onDetails: (r: CertRow) => void
}) {
  const { t } = useLanguage()
  return (
    <tr className="hover:bg-surface-raised/40 transition-colors">
      <td className="py-3 pr-3">
        <p className="font-medium text-text whitespace-nowrap">{coachName(row)}</p>
        <p className="text-[11px] text-text-faint">{coachEmail(row)}</p>
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">
        <p>{schoolName(row)}</p>
        <p>{pldName(row)} · {stateCode_(row)}</p>
      </td>
      <td className="py-3 pr-3 font-medium text-text max-w-[160px] truncate" title={row.title}>
        {row.title}
        {row.certificate_number && (
          <p className="text-[11px] text-text-faint">#{row.certificate_number}</p>
        )}
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">{row.certificate_level ?? '—'}</td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">
        {row.issued_date ? formatDate(row.issued_date) : '—'}
      </td>
      <td className="py-3 pr-3 whitespace-nowrap">
        {row.expiry_date ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-text-dim">{formatDate(row.expiry_date)}</span>
            {expiryChip(t, row.expiry_date)}
          </div>
        ) : '—'}
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">{formatDate(row.created_at)}</td>
      <td className="py-3 pr-3 whitespace-nowrap">
        <CertBadge status={row.status} />
        {row.status === 'rejected' && row.rejection_reason && (
          <p className="text-[10px] text-danger mt-0.5 max-w-[120px] truncate" title={row.rejection_reason}>
            {row.rejection_reason}
          </p>
        )}
      </td>
      <td className="py-3 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onDetails(row)}>{t('common.details')}</Button>
          <Button variant="ghost" size="sm" onClick={() => onPhoto(row)}>{t('adminCerts.proof')}</Button>
          {row.status !== 'approved' && (
            <Button variant="ghost" size="sm" onClick={() => onApprove(row)} className="text-success hover:text-success">
              {t('common.approve')}
            </Button>
          )}
          {row.status !== 'rejected' && (
            <Button variant="ghost" size="sm" onClick={() => onReject(row)} className="text-danger hover:text-danger">
              {t('common.reject')}
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function CertMobileCard({
  row,
  onApprove,
  onReject,
  onPhoto,
  onDetails,
}: {
  row: CertRow
  onApprove: (r: CertRow) => void
  onReject:  (r: CertRow) => void
  onPhoto:   (r: CertRow) => void
  onDetails: (r: CertRow) => void
}) {
  const { t } = useLanguage()
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-text">{coachName(row)}</p>
          <p className="text-xs text-text-faint">{coachEmail(row)}</p>
          <p className="text-xs text-text-dim">{schoolName(row)} · {pldName(row)} · {stateCode_(row)}</p>
        </div>
        <CertBadge status={row.status} />
      </div>

      <div>
        <p className="font-medium text-sm text-text">{row.title}</p>
        {row.certificate_level && <p className="text-xs text-text-dim">{row.certificate_level}</p>}
        {row.issuer && <p className="text-xs text-text-dim">{row.issuer}</p>}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-dim">
        <span>{t('certPage.issued')}: <strong className="text-text">{row.issued_date ? formatDate(row.issued_date) : '—'}</strong></span>
        <span className="flex items-center gap-1">
          {t('certPage.expires')}: <strong className="text-text">{row.expiry_date ? formatDate(row.expiry_date) : '—'}</strong>
          {expiryChip(t, row.expiry_date)}
        </span>
        <span>{t('archerProfile.submitted')}: <strong className="text-text">{formatDate(row.created_at)}</strong></span>
      </div>

      {row.status === 'rejected' && row.rejection_reason && (
        <p className="text-xs text-danger bg-danger/10 rounded-[var(--r-sm)] px-2 py-1">
          {row.rejection_reason}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={() => onDetails(row)}>{t('common.details')}</Button>
        <Button variant="outline" size="sm" onClick={() => onPhoto(row)}>{t('certPage.viewProof')}</Button>
        {row.status !== 'approved' && (
          <Button variant="success" size="sm" onClick={() => onApprove(row)}>{t('common.approve')}</Button>
        )}
        {row.status !== 'rejected' && (
          <Button variant="danger" size="sm" onClick={() => onReject(row)}>{t('common.reject')}</Button>
        )}
      </div>
    </div>
  )
}

function CertDetails({ row }: { row: CertRow }) {
  const { t } = useLanguage()
  const fields: [string, string | undefined][] = [
    [t('roles.coach'),              coachName(row)],
    [t('common.email'),              coachEmail(row)],
    [t('common.school'),             schoolName(row)],
    [t('common.pld'),                pldName(row)],
    [t('common.state'),              stateCode_(row)],
    [t('certPage.certTitle'),  row.title],
    [t('certPage.issuerCol'),             row.issuer],
    [t('certPage.levelType'),       row.certificate_level],
    [t('certPage.certNumber'),        row.certificate_number],
    [t('certPage.issuedDate'),        row.issued_date ? formatDate(row.issued_date) : undefined],
    [t('certPage.expiryDate'),        row.expiry_date ? formatDate(row.expiry_date) : undefined],
    [t('common.status'),             t(`status.${row.status}`)],
    [t('archerProfile.submitted'),          formatDate(row.created_at)],
    [t('adminCerts.reviewedAt'),        row.reviewed_at ? formatDate(row.reviewed_at) : undefined],
    [t('adminCerts.rejectionReasonLabel'),   row.rejection_reason],
    [t('common.notes'),              row.notes],
  ]

  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
      {fields.map(([label, val]) => (
        val ? (
          <div key={label}>
            <dt className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint">{label}</dt>
            <dd className="text-sm text-text mt-0.5">{val}</dd>
          </div>
        ) : null
      ))}
    </dl>
  )
}

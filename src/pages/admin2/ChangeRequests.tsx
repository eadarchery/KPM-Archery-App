import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import {
  Button, Badge, StatCard, Input, Textarea, Modal, Select, EmptyState, useToast,
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
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'

// ─── TYPES ───────────────────────────────────────────────────────────────────

type CRTab    = 'pending' | 'approved' | 'rejected' | 'withdrawn' | 'all'
type CRAction = 'details' | 'approve' | 'reject' | 'doc' | null

interface CRFilters {
  fieldKey: string
  status:   string
  stateId:  string
  pldId:    string
  schoolId: string
  dateFrom: string
  dateTo:   string
}

const DEFAULT_FILTERS: CRFilters = {
  fieldKey: '', status: '', stateId: '', pldId: '', schoolId: '', dateFrom: '', dateTo: '',
}

const PAGE_SIZE = 50

interface OrgItem   { id: string; name: string }
interface StateItem { id: string; name: string; code: string }

interface ArcherShape {
  id: string
  name: string
  email: string
  archer_id: string | null
  school: OrgItem | OrgItem[] | null
  pld:    OrgItem | OrgItem[] | null
  state:  StateItem | StateItem[] | null
}

interface ReviewerShape { id: string; name: string; email: string }

interface CRRow {
  id: string
  user_id: string
  requested_by: string
  field_key: string
  field_label: string
  current_value: string | null
  requested_value: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  supporting_file_bucket: string | null
  supporting_file_path: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  rejection_reason: string | null
  created_at: string
  updated_at: string
  archer:   ArcherShape | ArcherShape[] | null
  reviewer: ReviewerShape | ReviewerShape[] | null
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TABS: { key: CRTab; labelKey: string }[] = [
  { key: 'pending',   labelKey: 'status.pending'   },
  { key: 'approved',  labelKey: 'status.approved'  },
  { key: 'rejected',  labelKey: 'status.rejected'  },
  { key: 'withdrawn', labelKey: 'status.withdrawn' },
  { key: 'all',       labelKey: 'common.all'       },
]

const CR_STATUS_OPTION_KEYS = [
  { value: '',          labelKey: 'common.allStatuses' },
  { value: 'pending',   labelKey: 'status.pending'      },
  { value: 'approved',  labelKey: 'status.approved'     },
  { value: 'rejected',  labelKey: 'status.rejected'     },
  { value: 'withdrawn', labelKey: 'status.withdrawn'    },
]

// field_key → translation key; field_label in the DB stays English.
const CR_FIELD_LABEL_KEYS: Record<string, string> = {
  full_name:     'crFields.fullName',
  school:        'common.school',
  state:         'common.state',
  pld:           'common.pld',
  age_group:     'adminScores.ageGroup',
  bow_category:  'common.bowCategory',
  date_of_birth: 'adminCr.dateOfBirth',
  phone:         'common.phone',
  other:         'crFields.other',
}

const CR_FIELD_OPTION_KEYS = [
  { value: '', labelKey: 'adminCr.allFields' },
  ...Object.entries(CR_FIELD_LABEL_KEYS).map(([value, labelKey]) => ({ value, labelKey })),
]

type Translate = (key: string, vars?: Record<string, string | number>) => string

function fieldLabel(t: Translate, r: { field_key: string; field_label: string }): string {
  const key = CR_FIELD_LABEL_KEYS[r.field_key]
  return key ? t(key) : r.field_label
}

const STATUS_VARIANT: Record<CRRow['status'], 'warning' | 'success' | 'danger' | 'neutral'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'danger',
  withdrawn: 'neutral',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function getArcher(r: CRRow): ArcherShape | null { return one(r.archer) }
function getReviewer(r: CRRow): ReviewerShape | null { return one(r.reviewer) }

function archerName(r: CRRow)   { return getArcher(r)?.name     ?? '—' }
function archerEmail(r: CRRow)  { return getArcher(r)?.email    ?? '—' }
function archerCode(r: CRRow)   { return getArcher(r)?.archer_id ?? null }
function archerSchool(r: CRRow) { return one(getArcher(r)?.school)?.name ?? '—' }
function archerPld(r: CRRow)    { return one(getArcher(r)?.pld)?.name    ?? '—' }
function archerStateCode(r: CRRow) {
  const s = one(getArcher(r)?.state)
  return s ? `${s.name} (${s.code})` : '—'
}
function archerSchoolObj(r: CRRow) { return one(getArcher(r)?.school) }
function archerPldObj(r: CRRow)    { return one(getArcher(r)?.pld) }
function archerStateObj(r: CRRow)  { return one(getArcher(r)?.state) }

function displayVal(v: string | null | undefined): string {
  if (!v) return '—'
  const i = v.indexOf('|')
  return i >= 0 ? v.slice(i + 1) : v
}

function parseOrgId(v: string): string {
  const i = v.indexOf('|')
  return i >= 0 ? v.slice(0, i) : v
}

function statusLabel(t: Translate, s: CRRow['status']): string {
  return t(`status.${s}`)
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function Admin2ChangeRequests() {
  const { profile: actor } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const queryClient = useQueryClient()

  const [tab, setTab]         = useState<CRTab>('pending')
  const [search, setSearch]   = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters] = useState<CRFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [pageCursors, setPageCursors] = useState<(AdminReviewCursor | null)[]>([null])
  const pageIndex = pageCursors.length - 1
  const cursor = pageCursors[pageIndex]

  const [selectedRow, setSelectedRow]   = useState<CRRow | null>(null)
  const [actionType, setActionType]     = useState<CRAction>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [reasonErr, setReasonErr]       = useState(false)
  const [reviewNote, setReviewNote]     = useState('')
  const [acting, setActing]             = useState(false)
  const [docUrl, setDocUrl]             = useState<string | null>(null)
  const [docLoading, setDocLoading]     = useState(false)
  const [isDocPdf, setIsDocPdf]         = useState(false)

  const setFilter = (k: keyof CRFilters, v: string) => setFilters(f => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters(DEFAULT_FILTERS)
  const activeFilterCount = Object.values(filters).filter(v => v !== '').length

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])

  useEffect(() => {
    setPageCursors([null])
  }, [tab, debouncedSearch, filters])

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: requestPage, isLoading, isError } = useQuery({
    queryKey: ['admin-change-requests', tab, debouncedSearch, filters, cursor],
    queryFn: () => getAdminReviewPage<CRRow>('change_requests', {
      search: debouncedSearch,
      status: tab === 'all' ? filters.status : tab,
      field_key: filters.fieldKey,
      state_id: filters.stateId,
      pld_id: filters.pldId,
      school_id: filters.schoolId,
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
    }, cursor, PAGE_SIZE),
    staleTime: 30_000,
  })
  const requests = requestPage?.items ?? []

  const { data: counts } = useQuery<Record<CRTab, number> & { today: number }>({
    queryKey: ['admin-change-requests-counts'],
    queryFn: () => getAdminReviewSummary<Record<CRTab, number> & { today: number }>('change_requests'),
    staleTime: 30_000,
  })

  const filtered = requests

  // ── Dynamic filter options derived from loaded data ───────────────────────

  const { stateOpts, pldOpts, schoolOpts } = useMemo(() => {
    const stateMap  = new Map<string, string>()
    const pldMap    = new Map<string, string>()
    const schoolMap = new Map<string, string>()
    for (const r of requests) {
      const st = archerStateObj(r)
      const pl = archerPldObj(r)
      const sc = archerSchoolObj(r)
      if (st) stateMap.set(st.id, `${st.name} (${(st as StateItem).code ?? ''})`)
      if (pl) pldMap.set(pl.id, pl.name)
      if (sc) schoolMap.set(sc.id, sc.name)
    }
    return {
      stateOpts:  [{ value: '', label: t('common.allStates')  }, ...[...stateMap.entries()].map(([v, l]) => ({ value: v, label: l }))],
      pldOpts:    [{ value: '', label: t('common.allPlds')    }, ...[...pldMap.entries()].map(([v, l])   => ({ value: v, label: l }))],
      schoolOpts: [{ value: '', label: t('common.allSchools') }, ...[...schoolMap.entries()].map(([v, l]) => ({ value: v, label: l }))],
    }
  }, [requests, t])

  // ── Action handlers ───────────────────────────────────────────────────────

  const openDetails = (row: CRRow) => {
    setSelectedRow(row)
    setActionType('details')
  }

  const openApprove = (row: CRRow) => {
    setSelectedRow(row)
    setActionType('approve')
    setReviewNote('')
    setRejectReason('')
    setReasonErr(false)
  }

  const openReject = (row: CRRow) => {
    setSelectedRow(row)
    setActionType('reject')
    setRejectReason('')
    setReasonErr(false)
  }

  const openDoc = async (row: CRRow) => {
    if (!row.supporting_file_bucket || !row.supporting_file_path) return
    setSelectedRow(row)
    setActionType('doc')
    setDocUrl(null)
    setDocLoading(true)
    setIsDocPdf(row.supporting_file_path.toLowerCase().endsWith('.pdf'))

    const { data } = await supabase.storage
      .from(row.supporting_file_bucket)
      .createSignedUrl(row.supporting_file_path, 3600)

    setDocUrl(data?.signedUrl ?? null)
    setDocLoading(false)

    if (actor?.id) {
      writeAuditLog(actor.id, 'admin2.profile_change_document_viewed', 'profile_change_request', row.id, {
        archer_name: archerName(row),
        field_label: row.field_label,
      })
    }
  }

  const closeModal = () => {
    if (acting) return
    setSelectedRow(null)
    setActionType(null)
    setDocUrl(null)
    setRejectReason('')
    setReasonErr(false)
    setReviewNote('')
  }

  // ── Apply field update on approve ─────────────────────────────────────────

  async function applyFieldUpdate(req: CRRow): Promise<void> {
    const { field_key, requested_value, user_id } = req
    const orgId = parseOrgId(requested_value)

    switch (field_key) {
      case 'full_name': {
        const { error } = await supabase.from('profiles').update({ name: requested_value }).eq('id', user_id)
        if (error) throw new Error(`Name update failed: ${error.message}`)
        break
      }
      case 'phone': {
        const { error } = await supabase.from('profiles').update({ phone: requested_value }).eq('id', user_id)
        if (error) throw new Error(`Phone update failed: ${error.message}`)
        break
      }
      case 'date_of_birth': {
        const { error } = await supabase.from('profiles').update({ date_of_birth: requested_value }).eq('id', user_id)
        if (error) throw new Error(`Date of birth update failed: ${error.message}`)
        break
      }
      case 'school': {
        const { error } = await supabase.from('profiles').update({ school_id: orgId }).eq('id', user_id)
        if (error) throw new Error(`School update failed: ${error.message}`)
        break
      }
      case 'state': {
        const { error } = await supabase.from('profiles').update({ state_id: orgId }).eq('id', user_id)
        if (error) throw new Error(`State update failed: ${error.message}`)
        break
      }
      case 'pld': {
        const { error } = await supabase.from('profiles').update({ pld_id: orgId }).eq('id', user_id)
        if (error) throw new Error(`PLD update failed: ${error.message}`)
        break
      }
      case 'age_group': {
        const { error } = await supabase
          .from('archer_profiles')
          .upsert({ profile_id: user_id, age_group: requested_value }, { onConflict: 'profile_id' })
        if (error) throw new Error(`Age group update failed: ${error.message}`)
        break
      }
      case 'bow_category': {
        const [pRes, apRes] = await Promise.all([
          supabase.from('profiles').update({ bow_category: requested_value }).eq('id', user_id),
          supabase.from('archer_profiles').upsert(
            { profile_id: user_id, bow_category: requested_value },
            { onConflict: 'profile_id' },
          ),
        ])
        if (pRes.error)  throw new Error(`Bow category update failed: ${pRes.error.message}`)
        if (apRes.error) throw new Error(`Archer profile update failed: ${apRes.error.message}`)
        break
      }
      case 'other':
        // No automatic field update for "other" requests — admin applies manually
        break
      default:
        break
    }
  }

  // ── Approve / Reject ──────────────────────────────────────────────────────

  async function handleApprove() {
    if (!selectedRow || !actor?.id) return
    setActing(true)
    try {
      if (selectedRow.field_key !== 'other') {
        await applyFieldUpdate(selectedRow)
      }

      const now = new Date().toISOString()
      const { error } = await supabase
        .from('profile_change_requests')
        .update({
          status:      'approved',
          reviewed_by: actor.id,
          reviewed_at: now,
          review_note: reviewNote.trim() || null,
        })
        .eq('id', selectedRow.id)
      if (error) throw error

      writeAuditLog(actor.id, 'admin2.profile_change_approved', 'profile_change_request', selectedRow.id, {
        archer_name:     archerName(selectedRow),
        archer_email:    archerEmail(selectedRow),
        field_key:       selectedRow.field_key,
        field_label:     selectedRow.field_label,
        requested_value: selectedRow.requested_value,
        review_note:     reviewNote.trim() || null,
      })

      ok(t('adminCr.approvedToast', { field: fieldLabel(t, selectedRow) }))
      queryClient.invalidateQueries({ queryKey: ['admin-change-requests'] })
      queryClient.invalidateQueries({ queryKey: ['admin-change-requests-counts'] })
      closeModal()
    } catch (e: unknown) {
      err(t('common.actionFailed'), (e as Error).message)
    } finally {
      setActing(false)
    }
  }

  async function handleReject() {
    if (!selectedRow || !actor?.id) return
    if (!rejectReason.trim()) { setReasonErr(true); return }
    setActing(true)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('profile_change_requests')
        .update({
          status:           'rejected',
          reviewed_by:      actor.id,
          reviewed_at:      now,
          rejection_reason: rejectReason.trim(),
        })
        .eq('id', selectedRow.id)
      if (error) throw error

      writeAuditLog(actor.id, 'admin2.profile_change_rejected', 'profile_change_request', selectedRow.id, {
        archer_name:      archerName(selectedRow),
        field_label:      selectedRow.field_label,
        rejection_reason: rejectReason.trim(),
      })

      ok(t('adminCr.rejectedToast'))
      queryClient.invalidateQueries({ queryKey: ['admin-change-requests'] })
      queryClient.invalidateQueries({ queryKey: ['admin-change-requests-counts'] })
      closeModal()
    } catch (e: unknown) {
      err(t('common.actionFailed'), (e as Error).message)
    } finally {
      setActing(false)
    }
  }

  if (!actor) return null
  const pendingCount = counts?.pending ?? 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <PageWrapper>
      <PageHead
        title={t('adminCr.title')}
        description={t('adminCr.description')}
        pill={
          pendingCount > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] bg-danger text-white text-[11px] font-bold rounded-full px-1.5">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          ) : undefined
        }
      />

      {/* Summary stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard
          label={t('common.total')}
          value={counts?.all ?? 0}
          clickable
          onClick={() => setTab('all')}
          active={tab === 'all'}
        />
        <StatCard
          label={t('status.pending')}
          value={counts?.pending ?? 0}
          clickable
          onClick={() => setTab('pending')}
          active={tab === 'pending'}
          accent={pendingCount > 0}
          badge={pendingCount}
        />
        <StatCard
          label={t('status.approved')}
          value={counts?.approved ?? 0}
          clickable
          onClick={() => setTab('approved')}
          active={tab === 'approved'}
        />
        <StatCard
          label={t('status.rejected')}
          value={counts?.rejected ?? 0}
          clickable
          onClick={() => setTab('rejected')}
          active={tab === 'rejected'}
        />
        <StatCard
          label={t('status.withdrawn')}
          value={counts?.withdrawn ?? 0}
          clickable
          onClick={() => setTab('withdrawn')}
          active={tab === 'withdrawn'}
        />
        <StatCard label={t('adminCr.today')} value={counts?.today ?? 0} />
      </div>

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
                  tabDef.key === 'pending'
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

      {/* Search + filter row */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input
          wrapperClassName="flex-1"
          placeholder={t('adminCr.searchPlaceholder')}
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
            label={t('adminCr.fieldRequested')}
            value={filters.fieldKey}
            onChange={e => setFilter('fieldKey', e.target.value)}
            options={CR_FIELD_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
          />
          {tab === 'all' && (
            <Select
              label={t('common.status')}
              value={filters.status}
              onChange={e => setFilter('status', e.target.value)}
              options={CR_STATUS_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
            />
          )}
          <Select
            label={t('common.state')}
            value={filters.stateId}
            onChange={e => setFilter('stateId', e.target.value)}
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
          <Input
            label={t('auditPage.from')}
            type="date"
            value={filters.dateFrom}
            onChange={e => setFilter('dateFrom', e.target.value)}
          />
          <Input
            label={t('auditPage.to')}
            type="date"
            value={filters.dateTo}
            onChange={e => setFilter('dateTo', e.target.value)}
          />
        </div>
      )}

      {/* Record count */}
      {!isLoading && !isError && (
        <p className="text-xs text-text-faint mb-3">
          {t('adminCerts.showingRecords', { shown: filtered.length, total: requests.length })}
        </p>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 rounded-[var(--r-md)] bg-surface-raised animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <p className="text-sm text-danger text-center py-10">
          {t('adminCr.loadError')}
        </p>
      )}

      {/* Empty state */}
      {!isLoading && !isError && filtered.length === 0 && (
        <EmptyState
          icon={<DocIcon />}
          title={
            tab === 'pending'
              ? t('adminCr.noPending')
              : t('adminCr.noneFound')
          }
          description={
            search || activeFilterCount > 0
              ? t('common.noResultsFilters')
              : t('adminCr.noneInTab')
          }
        />
      )}

      {/* Desktop table */}
      {!isLoading && !isError && filtered.length > 0 && (
        <>
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {[t('roles.archer'), t('adminCr.schoolPldState'), t('adminCr.field'), t('adminCr.currentToRequested'), t('archerProfile.submitted'), t('common.status'), t('common.actions')].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint pb-2 pr-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(row => (
                  <CRTableRow
                    key={row.id}
                    row={row}
                    onDetails={openDetails}
                    onApprove={openApprove}
                    onReject={openReject}
                    onDoc={openDoc}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map(row => (
              <CRMobileCard
                key={row.id}
                row={row}
                onDetails={openDetails}
                onApprove={openApprove}
                onReject={openReject}
                onDoc={openDoc}
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
              disabled={!requestPage?.nextCursor}
              onClick={() => requestPage?.nextCursor && setPageCursors(current => [...current, requestPage.nextCursor])}
            >
              {t('common.next')}
            </Button>
          </div>
        </>
      )}

      {/* ── MODALS ─────────────────────────────────────────────────────────── */}

      {/* Details */}
      <Modal
        open={actionType === 'details'}
        onClose={closeModal}
        title={t('adminCr.detailsTitle')}
        width="min(720px,100%)"
      >
        {selectedRow && (
          <CRDetails
            row={selectedRow}
            onApprove={() => setActionType('approve')}
            onReject={() => setActionType('reject')}
            onDoc={openDoc}
          />
        )}
      </Modal>

      {/* Approve */}
      <Modal
        open={actionType === 'approve'}
        onClose={closeModal}
        title={t('adminCr.approveTitle')}
        width="min(480px,100%)"
      >
        {selectedRow && (
          <div className="space-y-4">
            <div className="bg-surface-raised rounded-[var(--r-md)] p-4 text-sm space-y-2">
              <p className="font-semibold text-text">{archerName(selectedRow)}</p>
              <p className="text-xs text-text-faint">{archerEmail(selectedRow)}</p>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs mt-2">
                <span className="text-text-faint">{t('adminCr.field')}:</span>
                <span className="text-text font-medium">{fieldLabel(t, selectedRow)}</span>
                <span className="text-text-faint">{t('adminCr.current')}:</span>
                <span className="text-text-dim">{displayVal(selectedRow.current_value)}</span>
                <span className="text-text-faint">{t('adminCr.newValue')}:</span>
                <span className="text-success font-semibold">{displayVal(selectedRow.requested_value)}</span>
              </div>
              {selectedRow.field_key === 'other' && (
                <p className="text-xs text-warning bg-warning-soft rounded-[var(--r-sm)] px-2 py-1.5 mt-2">
                  {t('adminCr.otherNote')}
                </p>
              )}
            </div>
            <Textarea
              label={t('adminCr.adminNote')}
              placeholder={t('adminCr.adminNotePlaceholder')}
              value={reviewNote}
              onChange={e => setReviewNote(e.target.value)}
              minRows={2}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModal} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="success" onClick={handleApprove} loading={acting}>{t('common.approve')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reject */}
      <Modal
        open={actionType === 'reject'}
        onClose={closeModal}
        title={t('adminCr.rejectTitle')}
        width="min(480px,100%)"
      >
        {selectedRow && (
          <div className="space-y-4">
            <p className="text-sm text-text-dim">
              {t('adminCr.rejectingIntro', { field: fieldLabel(t, selectedRow), name: archerName(selectedRow) })}
            </p>
            <Textarea
              label={t('adminCerts.rejectionReason')}
              value={rejectReason}
              onChange={e => { setRejectReason(e.target.value); setReasonErr(false) }}
              error={reasonErr ? t('adminCerts.reasonRequired') : undefined}
              placeholder={t('adminCr.rejectionPlaceholder')}
              minRows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModal} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={handleReject} loading={acting}>{t('common.reject')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Document viewer */}
      <Modal
        open={actionType === 'doc'}
        onClose={closeModal}
        title={t('adminCr.supportingDoc')}
        width="min(820px,100%)"
      >
        {docLoading && (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!docLoading && docUrl && isDocPdf && (
          <div className="text-center py-6">
            <p className="text-sm text-text-dim mb-4">{t('certPage.pdfNewTab')}</p>
            <Button variant="primary" onClick={() => window.open(docUrl, '_blank')}>{t('certPage.openPdf')}</Button>
          </div>
        )}
        {!docLoading && docUrl && !isDocPdf && (
          <img
            src={docUrl}
            alt={t('adminCr.supportingDoc')}
            className="w-full max-h-[70vh] object-contain rounded-[var(--r-md)]"
          />
        )}
        {!docLoading && !docUrl && (
          <p className="text-sm text-text-dim text-center py-8">{t('adminCr.docLoadFailed')}</p>
        )}
      </Modal>
    </PageWrapper>
  )
}

// ─── TABLE ROW ────────────────────────────────────────────────────────────────

interface RowProps {
  row: CRRow
  onDetails: (r: CRRow) => void
  onApprove: (r: CRRow) => void
  onReject:  (r: CRRow) => void
  onDoc:     (r: CRRow) => void
}

function CRTableRow({ row, onDetails, onApprove, onReject, onDoc }: RowProps) {
  const { t } = useLanguage()
  const code = archerCode(row)
  return (
    <tr className="hover:bg-surface-raised/40 transition-colors">
      <td className="py-3 pr-3">
        <p className="font-medium text-text whitespace-nowrap">{archerName(row)}</p>
        <p className="text-[11px] text-text-faint">{archerEmail(row)}</p>
        {code && <p className="text-[11px] font-mono text-primary">{code}</p>}
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">
        <p>{archerSchool(row)}</p>
        <p>{archerPld(row)} · {archerStateCode(row)}</p>
      </td>
      <td className="py-3 pr-3 whitespace-nowrap">
        <p className="text-sm font-medium text-text">{fieldLabel(t, row)}</p>
      </td>
      <td className="py-3 pr-3 max-w-[200px]">
        <p className="text-xs text-text-dim truncate" title={displayVal(row.current_value)}>
          {displayVal(row.current_value)}
        </p>
        <p className="text-xs font-medium text-text truncate" title={displayVal(row.requested_value)}>
          → {displayVal(row.requested_value)}
        </p>
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">
        {formatDate(row.created_at)}
      </td>
      <td className="py-3 pr-3 whitespace-nowrap">
        <Badge variant={STATUS_VARIANT[row.status]} dot>
          {statusLabel(t, row.status)}
        </Badge>
      </td>
      <td className="py-3 whitespace-nowrap">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onDetails(row)}>{t('common.details')}</Button>
          {row.supporting_file_bucket && row.supporting_file_path && (
            <Button variant="ghost" size="sm" onClick={() => onDoc(row)}>{t('adminCr.doc')}</Button>
          )}
          {row.status === 'pending' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onApprove(row)}
                className="text-success hover:text-success"
              >
                {t('common.approve')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onReject(row)}
                className="text-danger hover:text-danger"
              >
                {t('common.reject')}
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── MOBILE CARD ─────────────────────────────────────────────────────────────

function CRMobileCard({ row, onDetails, onApprove, onReject, onDoc }: RowProps) {
  const { t } = useLanguage()
  const code = archerCode(row)
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-text">{archerName(row)}</p>
          <p className="text-xs text-text-faint">{archerEmail(row)}</p>
          {code && <p className="text-xs font-mono text-primary">{code}</p>}
          <p className="text-xs text-text-dim mt-0.5">
            {archerSchool(row)} · {archerPld(row)} · {archerStateCode(row)}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[row.status]} dot>{statusLabel(t, row.status)}</Badge>
      </div>

      <div>
        <p className="text-[11px] text-text-faint uppercase tracking-wide">{t('adminCr.field')}</p>
        <p className="text-sm font-medium text-text">{fieldLabel(t, row)}</p>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
        <div>
          <p className="text-text-faint">{t('adminCr.current')}</p>
          <p className="text-text-dim">{displayVal(row.current_value)}</p>
        </div>
        <div>
          <p className="text-text-faint">{t('adminCr.requested')}</p>
          <p className="text-text font-medium">{displayVal(row.requested_value)}</p>
        </div>
      </div>

      <p className="text-xs text-text-faint">{t('archerProfile.submitted')} {formatDate(row.created_at)}</p>

      {row.status === 'rejected' && row.rejection_reason && (
        <p className="text-xs text-danger bg-danger-soft rounded-[var(--r-sm)] px-2 py-1.5">
          {t('status.rejected')}: {row.rejection_reason}
        </p>
      )}
      {row.status === 'approved' && row.review_note && (
        <p className="text-xs text-success bg-success-soft rounded-[var(--r-sm)] px-2 py-1.5">
          {t('common.notes')}: {row.review_note}
        </p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={() => onDetails(row)}>{t('common.details')}</Button>
        {row.supporting_file_bucket && row.supporting_file_path && (
          <Button variant="outline" size="sm" onClick={() => onDoc(row)}>{t('adminCr.viewDoc')}</Button>
        )}
        {row.status === 'pending' && (
          <>
            <Button variant="success" size="sm" onClick={() => onApprove(row)}>{t('common.approve')}</Button>
            <Button variant="danger"  size="sm" onClick={() => onReject(row)}>{t('common.reject')}</Button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── DETAILS MODAL CONTENT ────────────────────────────────────────────────────

function CRDetails({
  row, onApprove, onReject, onDoc,
}: {
  row: CRRow
  onApprove: () => void
  onReject:  () => void
  onDoc:     (r: CRRow) => void
}) {
  const { t } = useLanguage()
  const reviewer = getReviewer(row)
  const code     = archerCode(row)

  const requestedValueLabel = t('adminCr.requestedValue')
  const rejectionReasonLabel = t('adminScores.rejectionReasonLabel')

  const archerFields: [string, string | null | undefined][] = [
    [t('crFields.fullName'),   archerName(row)],
    [t('common.archerId'),   code],
    [t('common.email'),       archerEmail(row)],
    [t('common.school'),      archerSchool(row)],
    [t('common.pld'),         archerPld(row)],
    [t('common.state'),       archerStateCode(row)],
  ]

  const requestFields: [string, string | null | undefined, boolean?][] = [
    [t('adminCr.fieldRequested'),  fieldLabel(t, row)],
    [t('adminCr.currentValue'),    displayVal(row.current_value)],
    [requestedValueLabel,  displayVal(row.requested_value)],
    [t('common.reason'),           row.reason, true],
    [t('common.status'),           statusLabel(t, row.status)],
    [t('archerProfile.submitted'),        formatDate(row.created_at)],
    [t('adminCr.reviewed'),         row.reviewed_at ? formatDate(row.reviewed_at) : null],
    [t('adminCr.reviewedBy'),      reviewer?.name],
    [t('adminCr.adminNoteLabel'),       row.review_note, true],
    [rejectionReasonLabel, row.rejection_reason, true],
  ]

  return (
    <div className="space-y-5">
      {/* Archer info */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-faint mb-3">
          {t('adminCr.archerInfo')}
        </h4>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
          {archerFields.map(([label, val]) =>
            val && val !== '—' ? (
              <div key={label}>
                <dt className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint">{label}</dt>
                <dd className="text-sm text-text mt-0.5">{val}</dd>
              </div>
            ) : null
          )}
        </dl>
      </div>

      <div className="border-t border-line" />

      {/* Request info */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-faint mb-3">
          {t('adminCr.changeRequest')}
        </h4>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
          {requestFields.map(([label, val, fullWidth]) =>
            val ? (
              <div key={label} className={fullWidth ? 'sm:col-span-2' : ''}>
                <dt className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint">{label}</dt>
                <dd className={cn(
                  'text-sm mt-0.5',
                  label === requestedValueLabel && 'font-semibold text-primary',
                  label === rejectionReasonLabel && 'text-danger',
                  label !== requestedValueLabel && label !== rejectionReasonLabel && 'text-text',
                )}>
                  {val}
                </dd>
              </div>
            ) : null
          )}
        </dl>

        {row.supporting_file_bucket && row.supporting_file_path && (
          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={() => onDoc(row)}>
              {t('adminCr.viewSupportingDoc')}
            </Button>
          </div>
        )}

        {row.field_key === 'other' && row.status === 'pending' && (
          <div className="mt-4 bg-warning-soft rounded-[var(--r-md)] px-4 py-3">
            <p className="text-sm text-warning font-semibold">{t('adminCr.manualActionTitle')}</p>
            <p className="text-xs text-warning/80 mt-0.5">
              {t('adminCr.manualActionHint')}
            </p>
          </div>
        )}
      </div>

      {row.status === 'pending' && (
        <>
          <div className="border-t border-line" />
          <div className="flex gap-2 justify-end">
            <Button variant="danger"  onClick={onReject}>{t('common.reject')}</Button>
            <Button variant="success" onClick={onApprove}>{t('common.approve')}</Button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── ICON ─────────────────────────────────────────────────────────────────────

function DocIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  )
}

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import {
  Button,
  SubmissionStatusBadge,
  RoleBadge,
  Input,
  Textarea,
  Modal,
  Select,
  EmptyState,
  useToast,
  Avatar,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import { useHasPermission } from '@/hooks/useRolePermissions'
import { supabase } from '@/services/supabase'
import { approveScore, rejectScore } from '@/services/scores'
import { writeAuditLog } from '@/services/auditLog'
import {
  getAdminReviewPage,
  getAdminReviewSummary,
  type AdminReviewCursor,
} from '@/services/adminReviewQueues'
import { canValidateTournamentScores } from '@/lib/permissions'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { Role, SubmissionStatus } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

type ScoreTab = 'pending_validation' | 'validated' | 'rejected' | 'all'

interface ScoreFilters {
  role: string
  stateCode: string
  pldId: string
  schoolId: string
  bowCategory: string
  roundType: string
  ageGroup: string
  dateFrom: string
  dateTo: string
}

const DEFAULT_FILTERS: ScoreFilters = {
  role: '', stateCode: '', pldId: '', schoolId: '',
  bowCategory: '', roundType: '', ageGroup: '',
  dateFrom: '', dateTo: '',
}

const PAGE_SIZE = 50

interface ArcherShape {
  id: string
  name: string
  archer_id?: string
  role: Role
  age?: number
  school?: { id: string; name: string }
  pld?: { id: string; name: string }
  state?: { id: string; name: string; code: string }
}

interface RoundShape {
  id: string
  name: string
  category: string
  max_score: number
  bow_categories: string[]
}

interface CoachShape {
  id: string
  name: string
  role: Role
}

interface SubmissionRow {
  id: string
  archer_id: string
  coach_id?: string
  round_id: string
  date: string
  total_score: number
  max_score: number
  bow_category?: string
  notes?: string
  status: SubmissionStatus
  proof_url?: string
  coach_approved_at?: string
  admin_approved_at?: string
  approved_by?: string
  rejection_reason?: string
  created_at: string
  archer: ArcherShape | null
  round: RoundShape | null
  coach: CoachShape | null
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TABS: { key: ScoreTab; labelKey: string }[] = [
  { key: 'pending_validation', labelKey: 'adminScores.pendingValidation' },
  { key: 'validated',          labelKey: 'status.validated'          },
  { key: 'rejected',           labelKey: 'status.rejected'           },
  { key: 'all',                labelKey: 'common.all'                },
]

const STATUS_FOR_TAB: Record<ScoreTab, SubmissionStatus | null> = {
  pending_validation: 'coach_approved',
  validated:          'admin_approved',
  rejected:           'rejected',
  all:                null,
}

const BOW_CATEGORIES = ['Recurve', 'Compound', 'Barebow', 'Instinctive']
const ROUND_TYPES    = ['tournament', 'training', 'practice', 'selection']

const AGE_GROUPS = [
  { value: 'u14',  label: 'U14 (≤ 14)'   },
  { value: 'u18',  label: 'U18 (15 – 18)' },
  { value: 'u21',  label: 'U21 (19 – 21)' },
  { value: 'open', label: 'Open (22+)'    },
]

// Round-type values stay English in the DB; labels are translated at render.
const ROUND_TYPE_LABEL_KEYS: Record<string, string> = {
  tournament: 'adminScores.rtTournament',
  training:   'adminScores.rtTraining',
  practice:   'adminScores.rtPractice',
  selection:  'adminScores.rtSelection',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function archerName(r: SubmissionRow) { return r.archer?.name ?? '—' }
function schoolName(r: SubmissionRow) { return r.archer?.school?.name ?? '—' }
function pldName(r: SubmissionRow)    { return r.archer?.pld?.name ?? '—' }
function stateCode(r: SubmissionRow)  { return r.archer?.state?.code ?? '—' }
function roundName(r: SubmissionRow)  { return r.round?.name ?? '—' }
function bowCat(r: SubmissionRow)     {
  return r.bow_category ?? r.round?.bow_categories?.[0] ?? '—'
}

async function resolvePhotoUrl(proof_url: string): Promise<string | null> {
  if (proof_url.startsWith('http')) return proof_url
  const { data } = await supabase.storage
    .from('proof-photos')
    .createSignedUrl(proof_url, 3600)
  return data?.signedUrl ?? null
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function Admin2Scores() {
  const { profile: actor } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const queryClient = useQueryClient()

  const [tab, setTab]       = useState<ScoreTab>('pending_validation')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters]         = useState<ScoreFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [pageCursors, setPageCursors] = useState<(AdminReviewCursor | null)[]>([null])
  const pageIndex = pageCursors.length - 1
  const cursor = pageCursors[pageIndex]

  const [selectedRow, setSelectedRow]       = useState<SubmissionRow | null>(null)
  const [actionType, setActionType]         = useState<'approve' | 'reject' | 'photo' | 'details' | null>(null)
  const [rejectReason, setRejectReason]     = useState('')
  const [reasonErr, setReasonErr]           = useState(false)
  const [acting, setActing]                 = useState(false)
  const [photoUrl, setPhotoUrl]             = useState<string | null>(null)
  const [photoLoading, setPhotoLoading]     = useState(false)

  // ── Permission + system-rule gates (RLS is still the real guard) ──────────
  const role = actor?.role
  const canValidate = useHasPermission(role, 'validate_tournament_score', canValidateTournamentScores(role))
  const tournamentValidationOn = useRuleValue<boolean>('admin2_can_validate_tournament_scores', true)

  // A row is validatable when the actor holds the permission and — for
  // tournament rounds — the Admin 2 tournament-validation rule is enabled.
  const canValidateRow = (row: SubmissionRow) =>
    canValidate && (row.round?.category !== 'tournament' || tournamentValidationOn)

  const setFilter = (key: keyof ScoreFilters, value: string) =>
    setFilters(f => ({ ...f, [key]: value }))

  const clearFilters = () => setFilters(DEFAULT_FILTERS)
  const hasActiveFilters = Object.values(filters).some(v => v !== '')

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(id)
  }, [search])

  useEffect(() => {
    setPageCursors([null])
  }, [tab, debouncedSearch, filters])

  // ── Fetch one server-filtered page ───────────────────────────────────────
  const { data: scorePage, isLoading, isError } = useQuery({
    queryKey: ['admin-scores', tab, debouncedSearch, filters, cursor],
    queryFn: () => getAdminReviewPage<SubmissionRow>('scores', {
      search: debouncedSearch,
      status: STATUS_FOR_TAB[tab],
      date_from: filters.dateFrom,
      date_to: filters.dateTo,
      role: filters.role,
      state_code: filters.stateCode,
      pld_id: filters.pldId,
      school_id: filters.schoolId,
      bow_category: filters.bowCategory,
      round_type: filters.roundType,
      age_group: filters.ageGroup,
    }, cursor, PAGE_SIZE),
    staleTime: 30_000,
  })
  const scores = scorePage?.items ?? []

  // ── Tab counts ──────────────────────────────────────────────────────────
  const { data: counts } = useQuery<Record<ScoreTab, number>>({
    queryKey: ['admin-scores-counts'],
    queryFn: () => getAdminReviewSummary<Record<ScoreTab, number>>('scores'),
    staleTime: 30_000,
  })

  const filtered = scores

  // ── Derive filter dropdown options from loaded data ──────────────────────
  const { stateOpts, pldOpts, schoolOpts } = useMemo(() => {
    const stateMap  = new Map<string, string>()
    const pldMap    = new Map<string, string>()
    const schoolMap = new Map<string, string>()
    for (const r of scores) {
      if (r.archer?.state) stateMap.set(r.archer.state.code, r.archer.state.name)
      if (r.archer?.pld)   pldMap.set(r.archer.pld.id, r.archer.pld.name)
      if (r.archer?.school) schoolMap.set(r.archer.school.id, r.archer.school.name)
    }
    return {
      stateOpts:  [{ value: '', label: t('common.allStates') },  ...[...stateMap.entries()].map(([v, l]) => ({ value: v, label: l }))],
      pldOpts:    [{ value: '', label: t('common.allPlds') },    ...[...pldMap.entries()].map(([v, l])   => ({ value: v, label: l }))],
      schoolOpts: [{ value: '', label: t('common.allSchools') }, ...[...schoolMap.entries()].map(([v, l]) => ({ value: v, label: l }))],
    }
  }, [scores, t])

  // ── Action handlers ──────────────────────────────────────────────────────
  const openApprove = (row: SubmissionRow) => {
    setSelectedRow(row)
    setActionType('approve')
    setRejectReason('')
    setReasonErr(false)
  }

  const openReject = (row: SubmissionRow) => {
    setSelectedRow(row)
    setActionType('reject')
    setRejectReason('')
    setReasonErr(false)
  }

  const openDetails = (row: SubmissionRow) => {
    setSelectedRow(row)
    setActionType('details')
  }

  const openPhoto = async (row: SubmissionRow) => {
    setSelectedRow(row)
    setActionType('photo')
    setPhotoUrl(null)
    setPhotoLoading(true)
    try {
      const url = await resolvePhotoUrl(row.proof_url ?? '')
      setPhotoUrl(url)
    } finally {
      setPhotoLoading(false)
    }
    if (actor) {
      writeAuditLog(actor.id, 'score.proof_viewed', 'score_submission', row.id, {
        archer_name: archerName(row),
        round_name:  roundName(row),
        score:       `${row.total_score}/${row.max_score}`,
      })
    }
  }

  const closeAction = () => {
    if (acting) return
    setSelectedRow(null)
    setActionType(null)
    setRejectReason('')
    setReasonErr(false)
    setPhotoUrl(null)
  }

  const handleAction = async () => {
    if (!actor || !selectedRow || actionType !== 'approve' && actionType !== 'reject') return
    if (actionType === 'reject' && !rejectReason.trim()) {
      setReasonErr(true)
      return
    }
    setActing(true)
    try {
      const meta = {
        archer_name: archerName(selectedRow),
        round_name:  roundName(selectedRow),
        score:       `${selectedRow.total_score}/${selectedRow.max_score}`,
        old_status:  selectedRow.status,
      }
      // Guarded service calls: assert permission, update status, and write a
      // rich audit entry via the log_audit RPC. The DB also auto-grants score
      // achievements on the admin_approved transition (migration 007 trigger).
      if (actionType === 'approve') {
        await approveScore(selectedRow.id, meta)
      } else {
        await rejectScore(selectedRow.id, rejectReason.trim(), meta)
      }

      ok(
        actionType === 'approve'
          ? t('adminScores.scoreApproved', { name: archerName(selectedRow) })
          : t('adminScores.scoreRejected', { name: archerName(selectedRow) }),
      )
      queryClient.invalidateQueries({ queryKey: ['admin-scores'] })
      queryClient.invalidateQueries({ queryKey: ['admin-scores-counts'] })
      queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
      closeAction()
    } catch (e) {
      err(t('common.actionFailed'), (e as Error).message)
    } finally {
      setActing(false)
    }
  }

  if (!actor) return null

  const pendingCount = counts?.pending_validation ?? 0

  return (
    <PageWrapper>
      <PageHead
        title={t('adminScores.title')}
        description={t('adminScores.description')}
        pill={
          pendingCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning-soft text-warning text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block animate-pulse" />
              {t('adminScores.pendingPill', { count: pendingCount })}
            </span>
          ) : undefined
        }
      />

      {/* ── SEARCH + FILTER TOGGLE ── */}
      <div className="flex gap-2 mb-4">
        <Input
          placeholder={t('adminScores.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 max-w-[480px]"
        />
        <Button
          variant={filtersOpen || hasActiveFilters ? 'primary' : 'ghost'}
          size="sm"
          onClick={() => setFiltersOpen(o => !o)}
          icon={<FilterIcon />}
        >
          {t('common.filters')}
          {hasActiveFilters && (
            <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-current/20 text-[9px] font-bold ml-0.5">
              {Object.values(filters).filter(v => v !== '').length}
            </span>
          )}
        </Button>
      </div>

      {/* ── FILTER PANEL ── */}
      {filtersOpen && (
        <div className="card mb-5 p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <Select
              label={t('common.role')}
              value={filters.role}
              onChange={e => setFilter('role', e.target.value)}
              options={[
                { value: '', label: t('common.allRoles') },
                { value: 'archer', label: t('roles.archer') },
                { value: 'coach',  label: t('roles.coach')  },
              ]}
            />
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
              label={t('common.bowCategory')}
              value={filters.bowCategory}
              onChange={e => setFilter('bowCategory', e.target.value)}
              options={[
                { value: '', label: t('common.allCategories') },
                ...BOW_CATEGORIES.map(b => ({ value: b, label: b })),
              ]}
            />
            <Select
              label={t('adminScores.roundType')}
              value={filters.roundType}
              onChange={e => setFilter('roundType', e.target.value)}
              options={[
                { value: '', label: t('common.allTypes') },
                ...ROUND_TYPES.map(r => ({ value: r, label: t(ROUND_TYPE_LABEL_KEYS[r]) })),
              ]}
            />
            <Select
              label={t('adminScores.ageGroup')}
              value={filters.ageGroup}
              onChange={e => setFilter('ageGroup', e.target.value)}
              options={[{ value: '', label: t('common.allAges') }, ...AGE_GROUPS]}
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-semibold text-text-dim">{t('auditPage.from')}</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={e => setFilter('dateFrom', e.target.value)}
                className="field"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-semibold text-text-dim">{t('auditPage.to')}</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={e => setFilter('dateTo', e.target.value)}
                className="field"
              />
            </div>
          </div>
          {hasActiveFilters && (
            <div className="flex justify-end mt-3 pt-3 border-t border-line">
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                {t('coachAch.clearFilters')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── TABS ── */}
      <div className="flex flex-wrap gap-1 bg-section rounded-[13px] p-1 mb-5 w-fit">
        {TABS.map(tabDef => {
          const count    = counts?.[tabDef.key] ?? 0
          const isActive = tab === tabDef.key
          return (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-sm font-display font-semibold',
                'transition-all duration-150 whitespace-nowrap',
                isActive
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-dim hover:text-text hover:bg-surface-soft',
              )}
            >
              {t(tabDef.labelKey)}
              {count > 0 && (
                <span
                  className={cn(
                    'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 leading-none',
                    isActive && tabDef.key === 'pending_validation'
                      ? 'bg-warning text-white'
                      : isActive
                      ? 'bg-primary text-primary-on'
                      : 'bg-surface-soft text-text-faint',
                  )}
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── CONTENT ── */}
      {isLoading ? (
        <div className="card flex items-center justify-center py-16 text-text-faint text-sm">
          {t('adminScores.loading')}
        </div>
      ) : isError ? (
        <div className="card flex items-center justify-center py-12 text-danger text-sm">
          {t('adminScores.loadError')}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            search || hasActiveFilters
              ? t('adminScores.noResults')
              : tab === 'pending_validation'
              ? t('adminScores.noPending')
              : t('adminScores.noScoresInTab')
          }
          description={
            search || hasActiveFilters ? t('common.noResultsFilters') : undefined
          }
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden lg:block overflow-x-auto p-0">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-soft">
                  {[t('roles.archer'), t('common.role'), t('common.school'), t('common.pld'), t('common.state'), t('common.round'), t('adminScores.bow'), t('adminScores.score'), t('common.date'), t('adminScores.photo'), t('common.status'), ''].map(
                    (h, i) => (
                      <th
                        key={i}
                        className={cn(
                          'text-left py-3 text-[11px] font-semibold uppercase tracking-wide',
                          'text-text-faint border-b border-line-strong whitespace-nowrap',
                          i === 0 ? 'pl-4 pr-3' : 'px-3',
                        )}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <ScoreTableRow
                    key={row.id}
                    row={row}
                    canValidate={canValidateRow(row)}
                    onApprove={() => openApprove(row)}
                    onReject={() => openReject(row)}
                    onViewPhoto={() => openPhoto(row)}
                    onViewDetails={() => openDetails(row)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map(row => (
              <ScoreCard
                key={row.id}
                row={row}
                canValidate={canValidateRow(row)}
                onApprove={() => openApprove(row)}
                onReject={() => openReject(row)}
                onViewPhoto={() => openPhoto(row)}
                onViewDetails={() => openDetails(row)}
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
              disabled={!scorePage?.nextCursor}
              onClick={() => scorePage?.nextCursor && setPageCursors(current => [...current, scorePage.nextCursor])}
            >
              {t('common.next')}
            </Button>
          </div>
        </>
      )}

      {/* ── APPROVE / REJECT MODAL ── */}
      <Modal
        open={(actionType === 'approve' || actionType === 'reject') && !!selectedRow}
        onClose={closeAction}
        title={actionType === 'approve' ? t('adminScores.approveScore') : t('adminScores.rejectScore')}
        width="min(460px,100%)"
      >
        {selectedRow && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-[var(--r)] bg-surface-soft border border-line">
              <Avatar name={archerName(selectedRow)} size="md" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm">{archerName(selectedRow)}</div>
                <div className="text-xs text-text-dim mt-0.5">
                  {roundName(selectedRow)} · {bowCat(selectedRow)}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <RoleBadge role={selectedRow.archer?.role ?? 'archer'} />
                  <span className="font-mono text-xs font-bold text-text bg-section px-2 py-0.5 rounded">
                    {selectedRow.total_score}/{selectedRow.max_score}
                  </span>
                </div>
              </div>
            </div>

            {actionType === 'approve' ? (
              <p className="text-sm text-text-dim leading-relaxed">
                {t('adminScores.approveExplain')}
              </p>
            ) : (
              <Textarea
                label={t('approvals.rejectionReasonLabel')}
                placeholder={t('adminScores.rejectionPlaceholder')}
                value={rejectReason}
                onChange={e => { setRejectReason(e.target.value); setReasonErr(false) }}
                minRows={3}
                error={reasonErr ? t('approvals.rejectionReasonRequired') : undefined}
              />
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" size="sm" onClick={closeAction} disabled={acting}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={actionType === 'approve' ? 'success' : 'danger'}
                size="sm"
                loading={acting}
                onClick={handleAction}
              >
                {actionType === 'approve' ? t('common.approve') : t('adminScores.rejectScore')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── PHOTO MODAL ── */}
      <Modal
        open={actionType === 'photo' && !!selectedRow}
        onClose={closeAction}
        title={t('adminScores.proofPhoto')}
        width="min(760px,100%)"
      >
        <div className="min-h-[200px] flex flex-col items-center justify-center">
          {photoLoading ? (
            <p className="text-text-faint text-sm">{t('adminScores.loadingPhoto')}</p>
          ) : photoUrl ? (
            <div className="space-y-3 w-full">
              <img
                src={photoUrl}
                alt={t('adminScores.proofAlt')}
                className="w-full max-h-[72vh] object-contain rounded-[var(--r)]"
              />
              {selectedRow && (
                <p className="text-xs text-text-faint text-center">
                  {archerName(selectedRow)} · {roundName(selectedRow)} · {formatDate(selectedRow.date)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-text-faint text-sm">{t('adminScores.noProof')}</p>
          )}
        </div>
      </Modal>

      {/* ── DETAILS MODAL ── */}
      <Modal
        open={actionType === 'details' && !!selectedRow}
        onClose={closeAction}
        title={t('adminScores.detailsTitle')}
        width="min(540px,100%)"
      >
        {selectedRow && <ScoreDetails row={selectedRow} />}
      </Modal>
    </PageWrapper>
  )
}

// ─── DESKTOP TABLE ROW ───────────────────────────────────────────────────────

function ScoreTableRow({
  row, canValidate, onApprove, onReject, onViewPhoto, onViewDetails,
}: {
  row: SubmissionRow
  canValidate: boolean
  onApprove: () => void
  onReject: () => void
  onViewPhoto: () => void
  onViewDetails: () => void
}) {
  const { t } = useLanguage()
  const pending  = row.status === 'coach_approved'
  const rejected = row.status === 'rejected'

  return (
    <tr className="border-b border-line last:border-0 hover:bg-surface-soft transition-colors">
      {/* Archer */}
      <td className="pl-4 pr-3 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={archerName(row)} size="sm" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate max-w-[150px]">{archerName(row)}</div>
            {row.coach && (
              <div className="text-[10px] text-text-faint truncate max-w-[150px]">
                {t('adminScores.via')} {row.coach.name}
              </div>
            )}
          </div>
        </div>
      </td>

      <td className="px-3 py-2.5 whitespace-nowrap">
        <RoleBadge role={row.archer?.role ?? 'archer'} />
      </td>

      <td className="px-3 py-2.5 text-sm text-text-dim">
        <span className="block truncate max-w-[120px]" title={schoolName(row)}>
          {schoolName(row)}
        </span>
      </td>

      <td className="px-3 py-2.5 text-sm text-text-dim whitespace-nowrap">
        {pldName(row)}
      </td>

      <td className="px-3 py-2.5 text-sm text-text-dim whitespace-nowrap">
        {stateCode(row)}
      </td>

      <td className="px-3 py-2.5 text-sm text-text-dim">
        <span className="block truncate max-w-[130px]" title={roundName(row)}>
          {roundName(row)}
        </span>
      </td>

      <td className="px-3 py-2.5 text-xs text-text-dim whitespace-nowrap">
        {bowCat(row)}
      </td>

      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="font-mono font-semibold text-sm text-text">
          {row.total_score}/{row.max_score}
        </span>
      </td>

      <td className="px-3 py-2.5 text-xs text-text-dim whitespace-nowrap">
        {formatDate(row.date)}
      </td>

      {/* Proof photo thumbnail */}
      <td className="px-3 py-2.5">
        {row.proof_url ? (
          <button
            onClick={onViewPhoto}
            title={t('adminScores.viewProofPhoto')}
            className={cn(
              'w-9 h-9 rounded-[7px] overflow-hidden border border-line bg-surface-soft',
              'flex items-center justify-center text-text-faint',
              'hover:border-primary hover:text-primary hover:scale-105 transition-all duration-150',
            )}
          >
            {row.proof_url.startsWith('http') ? (
              <img
                src={row.proof_url}
                alt={t('adminCerts.proof')}
                className="w-full h-full object-cover"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
              />
            ) : (
              <PhotoIcon />
            )}
          </button>
        ) : (
          <span className="text-text-faint text-xs">—</span>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-2.5 whitespace-nowrap">
        <SubmissionStatusBadge status={row.status} />
        {rejected && row.rejection_reason && (
          <p
            className="text-[10px] text-text-faint mt-0.5 max-w-[120px] truncate"
            title={row.rejection_reason}
          >
            {row.rejection_reason}
          </p>
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-2.5 pr-4 whitespace-nowrap">
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={onViewDetails}>
            {t('common.details')}
          </Button>
          {pending && canValidate && (
            <>
              <Button variant="success" size="sm" onClick={onApprove}>{t('common.approve')}</Button>
              <Button variant="danger"  size="sm" onClick={onReject}>{t('common.reject')}</Button>
            </>
          )}
          {pending && !canValidate && (
            <span className="text-[10px] text-text-faint italic whitespace-nowrap">{t('adminScores.validationDisabled')}</span>
          )}
          {rejected && canValidate && (
            <Button variant="ghost" size="sm" onClick={onApprove}>{t('adminScores.revalidate')}</Button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── MOBILE CARD ─────────────────────────────────────────────────────────────

function ScoreCard({
  row, canValidate, onApprove, onReject, onViewPhoto, onViewDetails,
}: {
  row: SubmissionRow
  canValidate: boolean
  onApprove: () => void
  onReject: () => void
  onViewPhoto: () => void
  onViewDetails: () => void
}) {
  const { t } = useLanguage()
  const pending  = row.status === 'coach_approved'
  const rejected = row.status === 'rejected'

  return (
    <div className="card space-y-3">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Avatar name={archerName(row)} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{archerName(row)}</div>
              {row.coach && (
                <div className="text-xs text-text-faint">{t('adminScores.via')} {row.coach.name}</div>
              )}
            </div>
            <SubmissionStatusBadge status={row.status} />
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <RoleBadge role={row.archer?.role ?? 'archer'} />
            <span className="font-mono text-xs font-bold text-text bg-section px-2 py-0.5 rounded">
              {row.total_score}/{row.max_score}
            </span>
          </div>
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div>
          <p className="text-text-faint mb-0.5">{t('common.round')}</p>
          <p className="text-text-dim font-medium truncate">{roundName(row)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('adminScores.bow')}</p>
          <p className="text-text-dim font-medium">{bowCat(row)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.school')}</p>
          <p className="text-text-dim font-medium truncate">{schoolName(row)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.state')}</p>
          <p className="text-text-dim font-medium">{stateCode(row)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.pld')}</p>
          <p className="text-text-dim font-medium truncate">{pldName(row)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.date')}</p>
          <p className="text-text-dim font-medium">{formatDate(row.date)}</p>
        </div>
      </div>

      {/* Proof photo link */}
      {row.proof_url && (
        <button
          onClick={onViewPhoto}
          className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
        >
          <PhotoIcon />
          {t('adminScores.viewProofPhoto')}
        </button>
      )}

      {/* Rejection reason */}
      {rejected && row.rejection_reason && (
        <div className="text-xs text-danger bg-danger-soft rounded-[var(--r-sm)] px-2.5 py-2 leading-relaxed">
          <span className="font-semibold">{t('status.rejected')}: </span>
          {row.rejection_reason}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
        <button
          onClick={onViewDetails}
          className="text-xs text-primary font-semibold hover:underline"
        >
          {t('adminScores.viewDetails')}
        </button>
        <div className="flex gap-1.5">
          {pending && canValidate && (
            <>
              <Button variant="success" size="sm" onClick={onApprove}>{t('common.approve')}</Button>
              <Button variant="danger"  size="sm" onClick={onReject}>{t('common.reject')}</Button>
            </>
          )}
          {pending && !canValidate && (
            <span className="text-[10px] text-text-faint italic">{t('adminScores.validationDisabled')}</span>
          )}
          {rejected && canValidate && (
            <Button variant="ghost" size="sm" onClick={onApprove}>{t('adminScores.revalidate')}</Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SCORE DETAILS ───────────────────────────────────────────────────────────

function ScoreDetails({ row }: { row: SubmissionRow }) {
  const { t } = useLanguage()
  return (
    <div className="space-y-5">
      {/* Archer */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint mb-2">{t('roles.archer')}</p>
        <div className="flex items-center gap-3">
          <Avatar name={archerName(row)} size="md" />
          <div>
            <div className="font-semibold text-sm">{archerName(row)}</div>
            {row.archer?.archer_id && (
              <div className="text-xs text-text-faint font-mono mt-0.5">{row.archer.archer_id}</div>
            )}
            <div className="mt-1.5">
              <RoleBadge role={row.archer?.role ?? 'archer'} />
            </div>
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-text-faint mb-0.5">{t('common.school')}</p>
          <p className="font-medium text-text-dim truncate">{schoolName(row)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.pld')}</p>
          <p className="font-medium text-text-dim truncate">{pldName(row)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.state')}</p>
          <p className="font-medium text-text-dim">{stateCode(row)}</p>
        </div>
      </div>

      <hr className="border-line" />

      {/* Score */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint mb-2">{t('adminScores.score')}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs">
          <div>
            <p className="text-text-faint mb-0.5">{t('common.round')}</p>
            <p className="font-medium text-text-dim">{roundName(row)}</p>
          </div>
          <div>
            <p className="text-text-faint mb-0.5">{t('common.bowCategory')}</p>
            <p className="font-medium text-text-dim">{bowCat(row)}</p>
          </div>
          <div>
            <p className="text-text-faint mb-0.5">{t('adminScores.score')}</p>
            <p className="font-mono font-bold text-text text-lg leading-tight">
              {row.total_score}<span className="text-text-faint font-normal text-sm">/{row.max_score}</span>
            </p>
          </div>
          <div>
            <p className="text-text-faint mb-0.5">{t('adminScores.dateCompeted')}</p>
            <p className="font-medium text-text-dim">{formatDate(row.date)}</p>
          </div>
          {row.coach && (
            <div>
              <p className="text-text-faint mb-0.5">{t('adminScores.submittedByCoach')}</p>
              <p className="font-medium text-text-dim">{row.coach.name}</p>
            </div>
          )}
          {row.coach_approved_at && (
            <div>
              <p className="text-text-faint mb-0.5">{t('status.coachApproved')}</p>
              <p className="font-medium text-text-dim">{formatDate(row.coach_approved_at)}</p>
            </div>
          )}
          {row.admin_approved_at && (
            <div>
              <p className="text-text-faint mb-0.5">{t('adminScores.adminValidated')}</p>
              <p className="font-medium text-text-dim">{formatDate(row.admin_approved_at)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Status */}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint mb-2">{t('common.status')}</p>
        <SubmissionStatusBadge status={row.status} />
        {row.rejection_reason && (
          <div className="mt-2 text-xs text-danger bg-danger-soft rounded-[var(--r-sm)] px-2.5 py-2.5 leading-relaxed">
            <span className="font-semibold">{t('adminScores.rejectionReasonLabel')}: </span>
            {row.rejection_reason}
          </div>
        )}
      </div>

      {/* Notes */}
      {row.notes && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint mb-1.5">{t('common.notes')}</p>
          <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5">
            {row.notes}
          </p>
        </div>
      )}

      <p className="text-[10px] text-text-faint pt-1">
        {t('adminScores.submissionId')}: <span className="font-mono">{row.id}</span>
      </p>
    </div>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

function FilterIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="7" y1="12" x2="17" y2="12" />
      <line x1="10" y1="18" x2="14" y2="18" />
    </svg>
  )
}

function PhotoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  )
}

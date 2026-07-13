import { useEffect, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import {
  Button, Badge, StatCard, Modal, ConfirmDialog,
  Input, Textarea, Select, Avatar, EmptyState, useToast,
  AccountStatusBadge, RoleBadge, HelpTip, TableSkeleton, ListSkeleton,
  ActionMenu, type ActionItem,
} from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { ArcherHistoryModal } from '@/components/admin/ArcherHistoryModal'
import { PasswordChangeModal } from '@/components/auth/PasswordChangeModal'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/dates'
import {
  canManageUsers, canApproveRegistrations, canManageUserWithRole, isSuperAdmin,
} from '@/lib/permissions'
import {
  getUsersAdminPage, getAdminUserSummary, getOrganizationOptions,
  getCoachArcherLinksForUser, getUserByIdAdmin,
  approveUser, rejectUser, suspendUser, reactivateUser,
  updateUserAdmin, changeUserRole, deleteUserCompletely,
  linkCoachToArcher, unlinkCoachFromArcher,
  type OrganizationOptions, type AdminUserRow, type AdminUsersCursor,
} from '@/services/users'
import { adminResetUserPassword, sendPasswordResetEmail } from '@/services/auth'
import { getAdmin1Scopes, saveAdmin1Scopes } from '@/services/adminScopes'
import type { Profile, Role, AccountStatus } from '@/types'

// ─── CONSTANTS / SMALL HELPERS ───────────────────────────────────────────────

const ROLE_LABEL_KEYS: Record<Role, string> = {
  archer: 'roles.archer', coach: 'roles.coach', admin1: 'roles.admin1', admin2: 'roles.admin2', super_admin: 'roles.super_admin',
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

type TabKey =
  | 'all' | 'pending' | 'approved' | 'rejected' | 'suspended'
  | 'archers' | 'coaches' | 'admin1' | 'admin2'

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'all',       labelKey: 'common.all' },
  { key: 'pending',   labelKey: 'status.pending' },
  { key: 'approved',  labelKey: 'status.approved' },
  { key: 'rejected',  labelKey: 'status.rejected' },
  { key: 'suspended', labelKey: 'status.suspended' },
  { key: 'archers',   labelKey: 'nav.archers' },
  { key: 'coaches',   labelKey: 'nav.coaches' },
  { key: 'admin1',    labelKey: 'roles.admin1' },
  { key: 'admin2',    labelKey: 'roles.admin2' },
]

type ActionType = 'approve' | 'reject' | 'suspend' | 'reactivate'

const ACTION_META: Record<ActionType, {
  titleKey: string; verbKey: string; doneKey: string
  reasonLabelKey: string; reasonPlaceholderKey: string
  variant: 'success' | 'danger' | 'warning'; needsReason: boolean
}> = {
  approve:    { titleKey: 'adminUsers.approveTitle',    verbKey: 'common.approve',    doneKey: 'adminUsers.approvedToast',    reasonLabelKey: '', reasonPlaceholderKey: '', variant: 'success', needsReason: false },
  reject:     { titleKey: 'adminUsers.rejectTitle',     verbKey: 'common.reject',     doneKey: 'adminUsers.rejectedToast',    reasonLabelKey: 'adminUsers.rejectReasonLabel',  reasonPlaceholderKey: 'adminUsers.rejectReasonPlaceholder',  variant: 'danger',  needsReason: true  },
  suspend:    { titleKey: 'adminUsers.suspendTitle',    verbKey: 'common.suspend',    doneKey: 'adminUsers.suspendedToast',   reasonLabelKey: 'adminUsers.suspendReasonLabel', reasonPlaceholderKey: 'adminUsers.suspendReasonPlaceholder', variant: 'warning', needsReason: true  },
  reactivate: { titleKey: 'adminUsers.reactivateTitle', verbKey: 'common.reactivate', doneKey: 'adminUsers.reactivatedToast', reasonLabelKey: '', reasonPlaceholderKey: '', variant: 'success', needsReason: false },
}

function schoolName(u: Profile) { return u.school?.name ?? '—' }
function pldName(u: Profile)    { return u.pld?.name ?? '—' }
function stateName(u: Profile)  { return u.state?.name ?? '—' }

// Submission status → translation key (mirrors SubmissionStatusBadge).
const SUBMISSION_STATUS_KEYS: Record<string, string> = {
  pending:        'status.pending',
  coach_approved: 'status.coachApproved',
  admin_approved: 'status.approved',
  rejected:       'status.rejected',
  withdrawn:      'status.withdrawn',
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function Admin2Users() {
  const { profile: actor } = useAuth()
  const { t } = useLanguage()
  const role = actor?.role ?? null
  const qc = useQueryClient()

  // System-rule feature flags — safe fallbacks keep behaviour unchanged if 015 isn't run.
  const registrationsOpen = useRuleValue<boolean>('allow_new_registrations', true)
  const admin2ApprovesAll = useRuleValue<boolean>('admin2_can_approve_all_users', true)

  const allowed = canManageUsers(role)

  const [tab, setTab]         = useState<TabKey>('all')
  const [search, setSearch]   = useState('')
  const [fRole, setFRole]     = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fState, setFState]   = useState('')
  const [fPld, setFPld]       = useState('')
  const [fSchool, setFSchool] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageCursors, setPageCursors] = useState<(AdminUsersCursor | null)[]>([null])

  const [detailUser, setDetailUser] = useState<Profile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const [editUser, setEditUser]     = useState<Profile | null>(null)
  const [historyUser, setHistoryUser] = useState<Profile | null>(null)
  const [linkUser, setLinkUser]     = useState<Profile | null>(null)
  const [action, setAction]         = useState<{ user: Profile; type: ActionType } | null>(null)
  const [passwordResetUser, setPasswordResetUser] = useState<Profile | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const tabRole = tab === 'archers' ? 'archer'
    : tab === 'coaches' ? 'coach'
    : tab === 'admin1' ? 'admin1'
    : tab === 'admin2' ? 'admin2'
    : ''
  const tabStatus = ['pending', 'approved', 'rejected', 'suspended'].includes(tab) ? tab : ''
  const effectiveRole = tabRole && fRole && tabRole !== fRole ? '__none__' : (tabRole || fRole)
  const effectiveStatus = tabStatus && fStatus && tabStatus !== fStatus ? '__none__' : (tabStatus || fStatus)
  const pageCursor = pageCursors[pageIndex] ?? null

  useEffect(() => {
    setPageIndex(0)
    setPageCursors([null])
  }, [tab, debouncedSearch, fRole, fStatus, fState, fPld, fSchool])

  const usersQ = useQuery({
    queryKey: ['admin2-users', tab, debouncedSearch, fRole, fStatus, fState, fPld, fSchool, pageCursor],
    queryFn: () => getUsersAdminPage({
      search: debouncedSearch,
      role: effectiveRole,
      status: effectiveStatus,
      stateId: fState,
      pldId: fPld,
      schoolId: fSchool,
      limit: 50,
    }, pageCursor),
    enabled: allowed,
    staleTime: 30_000,
  })
  const summaryQ = useQuery({
    queryKey: ['admin2-user-summary'],
    queryFn: getAdminUserSummary,
    enabled: allowed,
    staleTime: 60_000,
  })
  const orgQ   = useQuery({ queryKey: ['org-options'], queryFn: getOrganizationOptions, enabled: allowed, staleTime: 5 * 60_000 })

  const users = useMemo(() => usersQ.data?.items ?? [], [usersQ.data])
  const org   = orgQ.data
  const stats = summaryQ.data ?? {
    total: 0, pending: 0, approved: 0, rejected: 0, suspended: 0,
    archers: 0, coaches: 0, admin1: 0, admin2: 0,
  }

  const linkedCount = (u: Profile): number | null => {
    if (u.role === 'coach' || u.role === 'archer') return (u as AdminUserRow).link_count ?? 0
    return null
  }

  const filtered = users

  const tabCount = (key: TabKey) => {
    if (key === 'all') return stats.total
    if (key === 'archers') return stats.archers
    if (key === 'coaches') return stats.coaches
    if (key === 'admin1') return stats.admin1
    if (key === 'admin2') return stats.admin2
    return stats[key]
  }

  const nextPage = () => {
    if (!usersQ.data?.nextCursor) return
    setPageCursors((current) => [
      ...current.slice(0, pageIndex + 1),
      usersQ.data!.nextCursor,
    ])
    setPageIndex((current) => current + 1)
  }

  // Filter dropdown options (cascading state → PLD → school)
  const stateOptions = [{ value: '', label: t('common.allStates') }, ...(org?.states ?? []).map((s) => ({ value: s.id, label: s.name }))]
  const pldOptions = [
    { value: '', label: t('common.allPlds') },
    ...(org?.plds ?? []).filter((p) => !fState || p.state_id === fState).map((p) => ({ value: p.id, label: p.name })),
  ]
  const schoolOptions = [
    { value: '', label: t('common.allSchools') },
    ...(org?.schools ?? [])
      .filter((s) => (!fState || s.state_id === fState) && (!fPld || s.pld_id === fPld))
      .map((s) => ({ value: s.id, label: s.name })),
  ]
  const roleFilterOptions = [
    { value: '', label: t('common.allRoles') },
    ...(['archer', 'coach', 'admin1', 'admin2', 'super_admin'] as Role[]).map((r) => ({ value: r, label: t(ROLE_LABEL_KEYS[r]) })),
  ]
  const statusFilterOptions = [
    { value: '', label: t('common.allStatuses') },
    ...(['pending', 'approved', 'rejected', 'suspended', 'inactive'] as AccountStatus[])
      .map((s) => ({ value: s, label: t(`status.${s}`) })),
  ]

  const resetFilters = () => { setFRole(''); setFStatus(''); setFState(''); setFPld(''); setFSchool('') }
  const activeFilterCount = [fRole, fStatus, fState, fPld, fSchool].filter(Boolean).length

  // ── Guards (after all hooks) ──
  if (!actor) return null
  if (!allowed) return <AccessDenied />

  return (
    <PageWrapper>
      <PageHead
        title={t('adminUsers.title')}
        description={t('adminUsers.description')}
        pill={
          stats.pending > 0 ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-warning-soft text-warning text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
              {t('adminScores.pendingPill', { count: stats.pending })}
            </span>
          ) : undefined
        }
      />

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label={t('adminUsers.totalUsers')}  value={stats.total}     onClick={() => setTab('all')}       active={tab === 'all'} />
        <StatCard label={t('status.pending')}      value={stats.pending}   onClick={() => setTab('pending')}   active={tab === 'pending'}   badge={stats.pending} />
        <StatCard label={t('status.approved')}     value={stats.approved}  onClick={() => setTab('approved')}  active={tab === 'approved'} />
        <StatCard label={t('status.suspended')}    value={stats.suspended} onClick={() => setTab('suspended')} active={tab === 'suspended'} />
        <StatCard label={t('nav.archers')}      value={stats.archers}   onClick={() => setTab('archers')}   active={tab === 'archers'} />
        <StatCard label={t('nav.coaches')}      value={stats.coaches}   onClick={() => setTab('coaches')}   active={tab === 'coaches'} />
        <StatCard label={t('roles.admin1')}      value={stats.admin1}    onClick={() => setTab('admin1')}    active={tab === 'admin1'} />
        <StatCard label={t('roles.admin2')}      value={stats.admin2}    onClick={() => setTab('admin2')}    active={tab === 'admin2'} />
      </div>

      {/* ── SEARCH + FILTER TOGGLE ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <Input
          placeholder={t('approvals.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px] max-w-[480px]"
        />
        <Button variant="ghost" size="sm" onClick={() => setShowFilters((v) => !v)}>
          {showFilters ? t('approvals.hideFilters') : t('common.filters')}
          {activeFilterCount > 0 && (
            <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-primary text-primary-on text-[10px] font-bold px-1 leading-none">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* ── ADVANCED FILTERS ── */}
      {showFilters && (
        <div className="card mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <Select label={t('common.role')}   options={roleFilterOptions}   value={fRole}   onChange={(e) => setFRole(e.target.value)} />
          <Select label={t('common.status')} options={statusFilterOptions} value={fStatus} onChange={(e) => setFStatus(e.target.value)} />
          <Select label={t('common.state')}  options={stateOptions}        value={fState}  onChange={(e) => { setFState(e.target.value); setFPld(''); setFSchool('') }} />
          <Select label={t('common.pld')}    options={pldOptions}          value={fPld}    onChange={(e) => { setFPld(e.target.value); setFSchool('') }} />
          <Select label={t('common.school')} options={schoolOptions}       value={fSchool} onChange={(e) => setFSchool(e.target.value)} />
          {activeFilterCount > 0 && (
            <div className="sm:col-span-2 lg:col-span-5">
              <Button variant="ghost" size="sm" onClick={resetFilters}>{t('coachAch.clearFilters')}</Button>
            </div>
          )}
        </div>
      )}

      {/* ── TABS ── */}
      <div className="flex flex-wrap gap-1 bg-section rounded-[13px] p-1 mb-5">
        {TABS.map((tabDef) => {
          const count = tabCount(tabDef.key)
          const isActive = tab === tabDef.key
          return (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-sm font-display font-semibold',
                'transition-all duration-150 whitespace-nowrap',
                isActive ? 'bg-surface text-text shadow-sm' : 'text-text-dim hover:text-text hover:bg-surface-soft',
              )}
            >
              {t(tabDef.labelKey)}
              <span className={cn(
                'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 leading-none',
                isActive ? 'bg-primary text-primary-on' : 'bg-surface-soft text-text-faint',
              )}>
                {count > 99 ? '99+' : count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Registrations-closed notice (system rule) */}
      {tab === 'pending' && !registrationsOpen && (
        <div className="mb-4 text-xs text-warning bg-warning-soft rounded-[var(--r-sm)] px-3 py-2">
          {t('approvals.registrationsClosed')}
        </div>
      )}

      {/* ── CONTENT ── */}
      {usersQ.isLoading ? (
        <>
          <div className="hidden lg:block"><TableSkeleton rows={8} cols={7} /></div>
          <div className="lg:hidden"><ListSkeleton rows={6} /></div>
        </>
      ) : usersQ.isError ? (
        <EmptyState
          tone="danger"
          title={t('adminUsers.loadError')}
          action={<Button variant="outline" onClick={() => usersQ.refetch()}>{t('common.retry')}</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={search || activeFilterCount ? t('approvals.noMatchingUsers') : t('adminUsers.noUsers')}
          description={search || activeFilterCount ? t('common.noResultsFilters') : undefined}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden lg:block overflow-x-auto p-0">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-soft">
                  {[t('common.user'), t('common.role'), t('common.status'), t('common.archerId'), t('common.school'), t('common.pld'), t('common.state'), t('adminUsers.links'), t('common.joined'), ''].map((h, i, arr) => (
                    <th key={i} className={cn(
                      'text-left py-3 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong whitespace-nowrap',
                      i === 0 ? 'pl-4 pr-3' : 'px-3',
                      // Pin the actions column to the right edge so the ⋮ menu is
                      // always reachable without horizontal scrolling (esp. at XL font).
                      i === arr.length - 1 && 'sticky right-0 z-10 bg-surface-soft pr-4',
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="group border-b border-line last:border-0 hover:bg-surface-soft transition-colors">
                    <td className="pl-4 pr-3 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar name={u.name || u.email} size="sm" />
                        <div className="min-w-0">
                          <div className="font-semibold text-sm truncate max-w-[180px]">{u.name || '—'}</div>
                          <div className="text-xs text-text-dim truncate max-w-[180px]">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><RoleBadge role={u.role} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><AccountStatusBadge status={u.status} /></td>
                    <td className="px-3 py-2.5 text-xs text-text-dim font-mono tabular-nums whitespace-nowrap">{u.archer_id ?? '—'}</td>
                    <td className="px-3 py-2.5 text-sm text-text-dim"><span className="block truncate max-w-[140px]" title={schoolName(u)}>{schoolName(u)}</span></td>
                    <td className="px-3 py-2.5 text-sm text-text-dim whitespace-nowrap">{pldName(u)}</td>
                    <td className="px-3 py-2.5 text-sm text-text-dim whitespace-nowrap">{stateName(u)}</td>
                    <td className="px-3 py-2.5 text-sm text-text-dim tabular-nums whitespace-nowrap text-center">
                      {linkedCount(u) === null ? '—' : linkedCount(u)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-text-dim tabular-nums whitespace-nowrap">{formatDate(u.created_at)}</td>
                    <td className="px-3 py-2.5 pr-4 sticky right-0 bg-surface group-hover:bg-surface-soft
                                   shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.15)] transition-colors">
                      <UserActions
                        user={u} actorRole={role} admin2ApprovesAll={admin2ApprovesAll}
                        onView={() => setDetailUser(u)} onEdit={() => setEditUser(u)}
                        onLinks={() => setLinkUser(u)} onAction={(type) => setAction({ user: u, type })}
                        onHistory={() => setHistoryUser(u)} onResetPassword={() => setPasswordResetUser(u)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile / tablet cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map((u) => (
              <UserCard
                key={u.id} user={u} actorRole={role} admin2ApprovesAll={admin2ApprovesAll} linked={linkedCount(u)}
                onView={() => setDetailUser(u)} onEdit={() => setEditUser(u)}
                onLinks={() => setLinkUser(u)} onAction={(type) => setAction({ user: u, type })}
                onHistory={() => setHistoryUser(u)} onResetPassword={() => setPasswordResetUser(u)}
              />
            ))}
          </div>
        </>
      )}

      {filtered.length > 0 && (
        <div className="mt-4 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={pageIndex === 0 || usersQ.isFetching}
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
          >
            {t('common.previous')}
          </Button>
          <span className="text-xs text-text-faint">
            {t('adminUsers.page', { page: pageIndex + 1 })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!usersQ.data?.hasMore || usersQ.isFetching}
            onClick={nextPage}
          >
            {t('common.next')}
          </Button>
        </div>
      )}

      {/* ── MODALS ── */}
      {detailUser && (
        <DetailModal
          user={detailUser}
          onClose={() => setDetailUser(null)}
          onDelete={isSuperAdmin(role) ? (u) => { setDetailUser(null); setDeleteTarget(u) } : undefined}
        />
      )}
      <ArcherHistoryModal
        open={!!historyUser}
        archerId={historyUser?.id ?? null}
        archerName={historyUser?.name}
        archerCode={historyUser?.archer_id}
        onClose={() => setHistoryUser(null)}
      />
      {deleteTarget && (
        <DeleteUserModal user={deleteTarget} actorId={actor?.id} onClose={() => setDeleteTarget(null)} />
      )}
      {editUser && org && (
        <EditUserModal user={editUser} org={org} actorRole={role} onClose={() => setEditUser(null)} />
      )}
      {action && (
        <ActionModal user={action.user} type={action.type} onClose={() => setAction(null)} />
      )}
      {linkUser && (
        <CoachLinkModal user={linkUser} onClose={() => setLinkUser(null)} />
      )}
      {passwordResetUser && (
        <PasswordChangeModal
          open
          onClose={() => setPasswordResetUser(null)}
          isAdmin
          userName={passwordResetUser.name || passwordResetUser.email}
          userEmail={passwordResetUser.email}
          onSubmit={(password) => adminResetUserPassword(passwordResetUser.id, password)}
        />
      )}

      {/* Footer hint */}
      <p className="text-[11px] text-text-faint mt-6">
        {t('adminUsers.footerHint', { shown: filtered.length, total: stats.total })}
      </p>
    </PageWrapper>
  )
}

// ─── ROW ACTIONS (shared by table + cards) ───────────────────────────────────

function UserActions({
  user, actorRole, admin2ApprovesAll, onView, onEdit, onLinks, onAction, onHistory, onResetPassword,
}: {
  user: Profile
  actorRole: Role | null
  admin2ApprovesAll: boolean
  onView: () => void
  onEdit: () => void
  onLinks: () => void
  onAction: (type: ActionType) => void
  onHistory: () => void
  onResetPassword: () => void
}) {
  const { t } = useLanguage()
  const canAct = canManageUserWithRole(actorRole, user.role)
  const canApprove =
    canApproveRegistrations(actorRole) && canAct &&
    (isSuperAdmin(actorRole) || admin2ApprovesAll || !(user.role === 'admin1' || user.role === 'admin2'))
  const showLinks = canAct && (user.role === 'archer' || user.role === 'coach')

  // All actions collapse into one ⋮ menu so the row never overflows — critical
  // at large / XL font sizes where a row of buttons is clipped off-screen.
  const items: ActionItem[] = [
    { label: t('common.view'), onClick: onView },
    { label: t('adminUsers.history'), onClick: onHistory, show: user.role === 'archer' },
    { label: t('common.edit'), onClick: onEdit, show: canAct },
    { label: t('adminUsers.links'), onClick: onLinks, show: showLinks },
    { label: 'Reset Password', onClick: onResetPassword, tone: 'warning', show: canAct },
    { label: t('common.approve'), onClick: () => onAction('approve'), tone: 'success', show: user.status === 'pending' && canApprove },
    { label: t('common.reject'), onClick: () => onAction('reject'), tone: 'danger', show: user.status === 'pending' && canAct },
    { label: t('common.suspend'), onClick: () => onAction('suspend'), tone: 'warning', show: user.status === 'approved' && canAct },
    { label: t('common.reactivate'), onClick: () => onAction('reactivate'), tone: 'success', show: user.status === 'suspended' && canAct },
    { label: t('adminUsers.reapprove'), onClick: () => onAction('approve'), tone: 'success', show: user.status === 'rejected' && canApprove },
  ]

  return (
    <div className="flex justify-end">
      <ActionMenu
        label={t('adminUsers.actionsFor', { name: user.name || user.email })}
        items={items}
        note={!canAct ? t('adminUsers.superAdminOnly') : undefined}
      />
    </div>
  )
}

// ─── MOBILE CARD ─────────────────────────────────────────────────────────────

function UserCard({
  user, actorRole, admin2ApprovesAll, linked, onView, onEdit, onLinks, onAction, onHistory, onResetPassword,
}: {
  user: Profile
  actorRole: Role | null
  admin2ApprovesAll: boolean
  linked: number | null
  onView: () => void
  onEdit: () => void
  onLinks: () => void
  onAction: (type: ActionType) => void
  onHistory: () => void
  onResetPassword: () => void
}) {
  const { t } = useLanguage()
  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-3">
        <Avatar name={user.name || user.email} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{user.name || '—'}</div>
              <div className="text-xs text-text-dim truncate mt-0.5">{user.email}</div>
            </div>
            <AccountStatusBadge status={user.status} />
          </div>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <RoleBadge role={user.role} />
            {user.archer_id && (
              <span className="text-[10px] font-mono text-text-faint bg-surface-soft px-1.5 py-0.5 rounded">{user.archer_id}</span>
            )}
            {linked !== null && (
              <span className="text-[10px] text-text-faint">{t('adminUsers.linkedCount', { count: linked })}</span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-text-faint mb-0.5">{t('common.school')}</p>
          <p className="text-text-dim font-medium truncate" title={schoolName(user)}>{schoolName(user)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.pld')}</p>
          <p className="text-text-dim font-medium truncate">{pldName(user)}</p>
        </div>
        <div>
          <p className="text-text-faint mb-0.5">{t('common.state')}</p>
          <p className="text-text-dim font-medium truncate">{stateName(user)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
        <span className="text-xs text-text-faint">{t('common.joined')} {formatDate(user.created_at)}</span>
        <UserActions
          user={user} actorRole={actorRole} admin2ApprovesAll={admin2ApprovesAll}
          onView={onView} onEdit={onEdit} onLinks={onLinks} onAction={onAction} onHistory={onHistory} onResetPassword={onResetPassword}
        />
      </div>
    </div>
  )
}

// ─── DETAIL MODAL ────────────────────────────────────────────────────────────

function DetailModal({
  user, onClose, onDelete,
}: {
  user: Profile
  onClose: () => void
  onDelete?: (user: Profile) => void
}) {
  const { t } = useLanguage()
  const detailQ = useQuery({
    queryKey: ['user-detail', user.id],
    queryFn: () => getUserByIdAdmin(user.id),
    staleTime: 15_000,
  })
  const linksQ = useQuery({
    queryKey: ['coach-archer-links', user.id],
    queryFn: () => getCoachArcherLinksForUser(user.id),
    staleTime: 30_000,
  })
  const links = linksQ.data ?? []

  const linkedCoaches = user.role === 'archer'
    ? links.filter((l) => l.archer_id === user.id).map((l) => l.other_name)
    : []
  const linkedArchers = user.role === 'coach'
    ? links.filter((l) => l.coach_id === user.id).map((l) => l.other_name)
    : []

  const d = detailQ.data
  const p = d?.profile ?? user

  return (
    <Modal open onClose={onClose} title={t('adminUsers.userDetails')} width="min(560px,100%)">
      <div className="space-y-4">
        {/* Identity */}
        <div className="flex items-center gap-3">
          <Avatar name={p.name || p.email} size="lg" />
          <div className="min-w-0">
            <div className="font-semibold text-base truncate">{p.name || '—'}</div>
            <div className="text-xs text-text-dim truncate">{p.email}</div>
            <div className="flex items-center gap-2 mt-1.5">
              <RoleBadge role={p.role} />
              <AccountStatusBadge status={p.status} />
            </div>
          </div>
        </div>

        {/* Core fields */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label={t('common.archerId')} value={p.archer_id ?? '—'} mono />
          <Field label={t('common.phone')} value={p.phone ?? '—'} />
          <Field label={t('common.school')} value={schoolName(p)} />
          <Field label={t('common.pld')} value={pldName(p)} />
          <Field label={t('common.state')} value={stateName(p)} />
          <Field label={t('common.joined')} value={formatDate(p.created_at)} />
          {p.approved_at && <Field label={t('status.approved')} value={formatDate(p.approved_at)} />}
          {p.rejected_at && <Field label={t('status.rejected')} value={formatDate(p.rejected_at)} />}
          {p.suspended_at && <Field label={t('status.suspended')} value={formatDate(p.suspended_at)} />}
        </div>

        {/* School claimed via registration code — shown until an official school
            is assigned, so the approver knows which school the applicant claims. */}
        {p.requested_school && !p.school_id && (
          <Banner tone="neutral" label={t('adminUsers.registeredWithCode')}>
            {t('adminUsers.registeredWithCodeBody', { school: p.requested_school.name })}
          </Banner>
        )}

        {/* Reason banners */}
        {p.status === 'rejected' && p.rejection_reason && (
          <Banner tone="danger" label={t('adminScores.rejectionReasonLabel')}>{p.rejection_reason}</Banner>
        )}
        {p.status === 'suspended' && p.suspension_reason && (
          <Banner tone="warning" label={t('adminUsers.suspensionReason')}>{p.suspension_reason}</Banner>
        )}
        {p.admin_notes && <Banner tone="neutral" label={t('adminUsers.adminNotes')}>{p.admin_notes}</Banner>}

        {/* Archer extension */}
        {d?.archer && (
          <Section title={t('adminUsers.archerProfile')}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label={t('adminUsers.ageGroup')} value={d.archer.age_group ?? '—'} />
              <Field label={t('common.bowCategory')} value={d.archer.bow_category ?? p.bow_category ?? '—'} />
              <Field label={t('adminUsers.dominantHand')} value={d.archer.dominant_hand ?? '—'} />
              <Field label={t('adminUsers.drawLength')} value={d.archer.draw_length_in ? `${d.archer.draw_length_in} in` : '—'} />
            </div>
          </Section>
        )}

        {/* Coach extension */}
        {d?.coach && (
          <Section title={t('adminUsers.coachProfile')}>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Field label={t('adminUsers.coachCode')} value={d.coach.coach_code ?? '—'} mono />
              <Field label={t('adminUsers.experience')} value={d.coach.experience_years != null ? t('adminUsers.years', { count: d.coach.experience_years }) : '—'} />
              <Field label={t('adminUsers.certified')} value={d.coach.is_certified ? t('common.yes') : t('common.no')} />
              <Field label={t('certPage.level')} value={d.coach.certification_level ?? '—'} />
            </div>
          </Section>
        )}

        {/* Relationships */}
        {p.role === 'archer' && (
          <Section title={t('adminUsers.linkedCoaches', { count: linkedCoaches.length })}>
            {linkedCoaches.length ? (
              <div className="flex flex-wrap gap-1.5">
                {linkedCoaches.map((n, i) => <Badge key={i} variant="neutral">{n}</Badge>)}
              </div>
            ) : <p className="text-xs text-text-faint">{t('adminUsers.noLinkedCoaches')}</p>}
          </Section>
        )}
        {p.role === 'coach' && (
          <Section title={t('adminUsers.linkedArchers', { count: linkedArchers.length })}>
            {linkedArchers.length ? (
              <div className="flex flex-wrap gap-1.5">
                {linkedArchers.map((n, i) => <Badge key={i} variant="neutral">{n}</Badge>)}
              </div>
            ) : <p className="text-xs text-text-faint">{t('adminUsers.noLinkedArchers')}</p>}
          </Section>
        )}

        {/* Recent scores (archers) */}
        {p.role === 'archer' && d && d.recentScores.length > 0 && (
          <Section title={t('adminUsers.recentScores')}>
            <ul className="space-y-1.5">
              {d.recentScores.map((s) => (
                <li key={s.id} className="flex items-center justify-between text-xs">
                  <span className="text-text-dim">{formatDate(s.date)}</span>
                  <span className="font-semibold">{s.total_score}/{s.max_score}</span>
                  <Badge variant={s.status === 'admin_approved' ? 'success' : s.status === 'rejected' ? 'danger' : 'warning'}>
                    {t(SUBMISSION_STATUS_KEYS[s.status] ?? 'common.unknown')}
                  </Badge>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Achievements + audit */}
        {d && (
          <div className="flex items-center gap-4 text-xs text-text-dim">
            <span>🏅 {t('adminUsers.achievementCount', { count: d.achievementCount })}</span>
          </div>
        )}
        {d && d.auditLogs.length > 0 && (
          <Section title={t('adminUsers.recentActivity')}>
            <ul className="space-y-1.5">
              {d.auditLogs.map((l) => (
                <li key={l.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-text-dim">{l.action}</span>
                  <span className="text-text-faint">{formatDate(l.created_at)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {detailQ.isLoading && <p className="text-xs text-text-faint">{t('adminUsers.loadingDetails')}</p>}

        <div className="flex justify-between items-center pt-1">
          {onDelete
            ? <Button variant="danger" size="sm" onClick={() => onDelete(p)}>{t('adminUsers.deletePermanently')}</Button>
            : <span />}
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── DELETE USER MODAL (Super Admin only — permanent, type-to-confirm) ────────

function DeleteUserModal({
  user, actorId, onClose,
}: {
  user: Profile
  actorId?: string
  onClose: () => void
}) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()
  const [confirmText, setConfirmText] = useState('')
  const isSelf = user.id === actorId
  // Forgiving match: case-insensitive and collapses internal whitespace, so a
  // name that renders as "Jonathan arc 3" still matches even when it's stored
  // with odd spacing/casing (HTML collapses double spaces, hiding the mismatch).
  const normalize = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const matches = !!user.name && normalize(confirmText) === normalize(user.name)

  const delMut = useMutation({
    mutationFn: () => deleteUserCompletely(user.id),
    onSuccess: () => {
      ok(t('adminUsers.deletedToast', { name: user.name ?? '' }))
      qc.invalidateQueries({ queryKey: ['admin2-users'] })
      qc.invalidateQueries({ queryKey: ['admin2-user-summary'] })
      qc.invalidateQueries({ queryKey: ['coach-archer-links'] })
      onClose()
    },
    onError: (e: Error) => err(e.message),
  })

  return (
    <Modal open onClose={onClose} title={t('adminUsers.deleteTitle')} width="min(480px,100%)">
      <div className="space-y-4">
        <div className="bg-danger-soft text-danger rounded-[var(--r-md)] p-3 text-sm">
          <p className="font-semibold">{t('adminUsers.cannotUndo')}</p>
          <p className="mt-1 text-danger/90">
            {t('adminUsers.deleteWarning', { name: user.name ?? '', email: user.email ?? '' })}
          </p>
        </div>

        {isSelf ? (
          <p className="text-sm text-text-dim">{t('adminUsers.cannotDeleteSelf')}</p>
        ) : (
          <>
            <Input
              label={t('adminUsers.typeNameToConfirm')}
              placeholder={user.name}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={delMut.isPending}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={() => delMut.mutate()}
                disabled={!matches || delMut.isPending}
                loading={delMut.isPending}
              >
                {t('adminUsers.deletePermanently')}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ─── EDIT MODAL (name / status / role / org / notes) ─────────────────────────

function EditUserModal({
  user, org, actorRole, onClose,
}: {
  user: Profile
  org: OrganizationOptions
  actorRole: Role | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()

  const [name, setName]       = useState(user.name ?? '')
  const [status, setStatus]   = useState<AccountStatus>(user.status)
  const [newRole, setNewRole] = useState<Role>(user.role)
  const [stateId, setStateId] = useState(user.state_id ?? '')
  const [pldId, setPldId]     = useState(user.pld_id ?? '')
  const [schoolId, setSchoolId] = useState(user.school_id ?? '')
  const [notes, setNotes]     = useState(user.admin_notes ?? '')
  const [isPldCoach, setIsPldCoach] = useState(!!user.is_pld_coach)
  const [confirmRole, setConfirmRole] = useState(false)
  const { profile: actorProfile } = useAuth()

  // ── Admin 1 multi-scope (checkbox tree) ──
  const isAdmin1Target = user.role === 'admin1'
  const [scopeTicks, setScopeTicks] = useState<Set<string>>(new Set()) // "level:id"
  const [scopeLoaded, setScopeLoaded] = useState(false)
  const [expandedStates, setExpandedStates] = useState<Set<string>>(new Set())
  const [scopeFilterState, setScopeFilterState] = useState('')
  const [scopeSearch, setScopeSearch] = useState('')
  useQuery({
    queryKey: ['admin1-scopes', user.id],
    enabled: isAdmin1Target,
    queryFn: async () => {
      const rows = await getAdmin1Scopes(user.id)
      setScopeTicks(new Set(rows.map(r => `${r.level}:${r.ref_id}`)))
      setScopeLoaded(true)
      return rows
    },
  })
  const toggleTick = (level: string, id: string) => {
    const key = `${level}:${id}`
    setScopeTicks(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const ticked = (level: string, id: string) => scopeTicks.has(`${level}:${id}`)

  const roleOptions = useMemo(() => {
    const base: Role[] = ['archer', 'coach', 'admin1', 'admin2']
    if (isSuperAdmin(actorRole)) base.push('super_admin')
    if (!base.includes(user.role)) base.push(user.role) // keep current role visible
    return base.map((r) => ({ value: r, label: t(ROLE_LABEL_KEYS[r]) }))
  }, [actorRole, user.role, t])

  const statusOptions = (['pending', 'approved', 'rejected', 'suspended', 'inactive'] as AccountStatus[])
    .map((s) => ({ value: s, label: t(`status.${s}`) }))

  const noneLabel = `— ${t('common.none')} —`
  const stateSel  = [{ value: '', label: noneLabel }, ...org.states.map((s) => ({ value: s.id, label: s.name }))]
  const pldSel    = [{ value: '', label: noneLabel }, ...org.plds.filter((p) => !stateId || p.state_id === stateId).map((p) => ({ value: p.id, label: p.name }))]
  const schoolSel = [{ value: '', label: noneLabel }, ...org.schools.filter((s) => (!stateId || s.state_id === stateId) && (!pldId || s.pld_id === pldId)).map((s) => ({ value: s.id, label: s.name }))]

  const roleChanged = newRole !== user.role

  const saveMut = useMutation({
    mutationFn: async () => {
      await updateUserAdmin(user.id, {
        name: name.trim() !== user.name ? name.trim() : undefined,
        status: status !== user.status ? status : undefined,
        state_id: stateId !== (user.state_id ?? '') ? (stateId || null) : undefined,
        pld_id: pldId !== (user.pld_id ?? '') ? (pldId || null) : undefined,
        school_id: schoolId !== (user.school_id ?? '') ? (schoolId || null) : undefined,
        admin_notes: notes !== (user.admin_notes ?? '') ? (notes.trim() || null) : undefined,
        is_pld_coach: user.role === 'coach' && isPldCoach !== !!user.is_pld_coach ? isPldCoach : undefined,
      })
      if (roleChanged) await changeUserRole(user.id, newRole)
      // Persist Admin 1 scope assignments (only once loaded, so we never wipe
      // existing assignments with an empty unloaded set).
      if (isAdmin1Target && scopeLoaded && actorProfile?.id) {
        const rows = [...scopeTicks].map(k => {
          const [level, ref_id] = k.split(':')
          return { level: level as 'state' | 'pld' | 'school', ref_id }
        })
        await saveAdmin1Scopes(actorProfile.id, user.id, rows)
      }
    },
    onSuccess: () => {
      ok(t('adminUsers.userUpdated'))
      qc.invalidateQueries({ queryKey: ['admin2-users'] })
      qc.invalidateQueries({ queryKey: ['admin2-user-summary'] })
      qc.invalidateQueries({ queryKey: ['user-detail', user.id] })
      onClose()
    },
    onError: (e) => err(t('common.actionFailed'), (e as Error).message),
  })

  const submit = () => {
    if (!name.trim()) { err(t('adminUsers.nameRequired')); return }
    if (roleChanged) { setConfirmRole(true); return }
    saveMut.mutate()
  }

  return (
    <>
      <Modal open onClose={onClose} title={t('adminUsers.editUser', { name: user.name || t('common.user') })} width="min(560px,100%)">
        <div className="space-y-4">
          <div className="text-xs text-text-dim bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">
            {user.email} · <span className="font-mono">{user.archer_id ?? t('adminUsers.noArcherId')}</span>
          </div>

          <Input label={t('common.name')} value={name} onChange={(e) => setName(e.target.value)} />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-text-dim">
                {t('common.role')}
                <HelpTip
                  title={t('helpTips.userRole.title')}
                  what={t('helpTips.userRole.what')}
                  who={t('helpTips.userRole.who')}
                  reversible={t('helpTips.userRole.reversible')}
                  warning={t('helpTips.userRole.warning')}
                />
              </span>
              <Select options={roleOptions} value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-1.5 text-[12px] font-semibold text-text-dim">
                {t('common.status')}
                <HelpTip
                  title={t('helpTips.userStatus.title')}
                  what={t('helpTips.userStatus.what')}
                  who={t('helpTips.userStatus.who')}
                  reversible={t('helpTips.userStatus.reversible')}
                  warning={t('helpTips.userStatus.warning')}
                  align="right"
                />
              </span>
              <Select options={statusOptions} value={status} onChange={(e) => setStatus(e.target.value as AccountStatus)} />
            </div>
          </div>

          {roleChanged && (
            <div className="text-xs text-warning bg-warning-soft rounded-[var(--r-sm)] px-3 py-2">
              {t('adminUsers.roleChangeNotice', { from: t(ROLE_LABEL_KEYS[user.role]), to: t(ROLE_LABEL_KEYS[newRole]) })}
            </div>
          )}

          {/* Personal organisation — hidden for Admin 1, whose remit is defined
              by the scope checkboxes below instead of a single location. */}
          {!isAdmin1Target && (
            <div>
              <p className="text-[12px] font-semibold text-text-dim mb-1.5">{t('adminUsers.organisation')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select label={t('common.state')} options={stateSel} value={stateId}
                  onChange={(e) => { setStateId(e.target.value); setPldId(''); setSchoolId('') }} />
                <Select label={t('common.pld')} options={pldSel} value={pldId}
                  onChange={(e) => { setPldId(e.target.value); setSchoolId('') }} />
                <Select label={t('common.school')} options={schoolSel} value={schoolId}
                  onChange={(e) => setSchoolId(e.target.value)} />
              </div>
              {org.schools.length === 0 && (
                <p className="text-[11px] text-text-faint mt-1.5">{t('adminUsers.noSchoolsYet')}</p>
              )}
            </div>
          )}

          {isAdmin1Target && (
            <div>
              <p className="text-[12px] font-semibold text-text-dim mb-1 flex items-center gap-1.5">
                {t('adminUsers.approvalScope')}
                <HelpTip
                  title={t('helpTips.admin1Scope.title')}
                  what={t('helpTips.admin1Scope.what')}
                  who={t('helpTips.admin1Scope.who')}
                  reversible={t('helpTips.admin1Scope.reversible')}
                />
              </p>
              <p className="text-[11px] text-text-faint mb-2">
                {t('adminUsers.scopeHint')}
                {scopeTicks.size === 0 && ` ${t('adminUsers.scopeNoTicks')}`}
              </p>

              {/* Filter the tree — narrows what is shown, never what is ticked */}
              <div className="flex gap-2 mb-2">
                <div className="w-[150px] shrink-0">
                  <select
                    value={scopeFilterState}
                    onChange={(e) => setScopeFilterState(e.target.value)}
                    className="field text-xs py-1.5"
                  >
                    <option value="">{t('common.allStates')}</option>
                    {org.states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <Input
                  placeholder={t('adminUsers.scopeSearchPlaceholder')}
                  value={scopeSearch}
                  onChange={(e) => setScopeSearch(e.target.value)}
                  wrapperClassName="flex-1 min-w-[160px]"
                />
              </div>

              <div className="border border-line rounded-[var(--r-sm)] max-h-[260px] overflow-y-auto divide-y divide-line">
                {org.states.filter(st => {
                  if (scopeFilterState && st.id !== scopeFilterState) return false
                  const q = scopeSearch.trim().toLowerCase()
                  if (!q) return true
                  return st.name.toLowerCase().includes(q)
                    || org.plds.some(p => p.state_id === st.id && p.name.toLowerCase().includes(q))
                    || org.schools.some(s => s.state_id === st.id && s.name.toLowerCase().includes(q))
                }).map(st => {
                  const q = scopeSearch.trim().toLowerCase()
                  // Auto-expand while filtering/searching so matches are visible.
                  const expanded = expandedStates.has(st.id) || !!q || !!scopeFilterState
                  const matches = (name: string) => !q || name.toLowerCase().includes(q)
                  const statePlds = org.plds.filter(p => p.state_id === st.id
                    && (matches(p.name) || org.schools.some(s => s.pld_id === p.id && matches(s.name))))
                  const looseSchools = org.schools.filter(s => s.state_id === st.id && !s.pld_id && matches(s.name))
                  return (
                    <div key={st.id} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <input type="checkbox" className="w-4 h-4 accent-primary"
                          checked={ticked('state', st.id)}
                          onChange={() => toggleTick('state', st.id)} />
                        <button type="button"
                          className="flex-1 text-left text-sm font-semibold text-text hover:text-primary"
                          onClick={() => setExpandedStates(prev => {
                            const next = new Set(prev)
                            if (next.has(st.id)) next.delete(st.id); else next.add(st.id)
                            return next
                          })}>
                          {st.name} <span className="text-text-faint font-normal">{expanded ? '▾' : '▸'}</span>
                        </button>
                        {ticked('state', st.id) && (
                          <span className="text-[10px] font-semibold text-success">{t('adminUsers.wholeState')}</span>
                        )}
                      </div>
                      {expanded && (
                        <div className="mt-1.5 ml-6 space-y-1.5">
                          {statePlds.map(pl => (
                            <div key={pl.id}>
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input type="checkbox" className="w-3.5 h-3.5 accent-primary"
                                  checked={ticked('pld', pl.id)}
                                  onChange={() => toggleTick('pld', pl.id)} />
                                <span className="text-xs font-medium text-text">{pl.name}</span>
                                {ticked('pld', pl.id) && <span className="text-[10px] text-success">{t('adminUsers.wholePld')}</span>}
                              </label>
                              <div className="ml-6 mt-1 space-y-1">
                                {org.schools.filter(s => s.pld_id === pl.id && (matches(pl.name) || matches(s.name))).map(sc => (
                                  <label key={sc.id} className="flex items-center gap-2 cursor-pointer">
                                    <input type="checkbox" className="w-3.5 h-3.5 accent-primary"
                                      checked={ticked('school', sc.id)}
                                      onChange={() => toggleTick('school', sc.id)} />
                                    <span className="text-xs text-text-dim">{sc.name}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ))}
                          {looseSchools.map(sc => (
                            <label key={sc.id} className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" className="w-3.5 h-3.5 accent-primary"
                                checked={ticked('school', sc.id)}
                                onChange={() => toggleTick('school', sc.id)} />
                              <span className="text-xs text-text-dim">{sc.name}</span>
                            </label>
                          ))}
                          {statePlds.length === 0 && looseSchools.length === 0 && (
                            <p className="text-[11px] text-text-faint">{t('adminUsers.noPldsOrSchools')}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {scopeTicks.size > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {[...scopeTicks].map(k => {
                    const [level, id] = k.split(':')
                    const name =
                      level === 'state' ? org.states.find(s => s.id === id)?.name
                      : level === 'pld' ? org.plds.find(p => p.id === id)?.name
                      : org.schools.find(s => s.id === id)?.name
                    return (
                      <span key={k} className="inline-flex items-center gap-1 text-[11px] bg-primary-soft text-primary font-semibold rounded-full px-2 py-0.5">
                        {level === 'state' ? '🗺' : level === 'pld' ? '🏛' : '🏫'} {name ?? id}
                        <button type="button" className="font-bold hover:opacity-70"
                          onClick={() => toggleTick(level, id)} aria-label={t('adminUsers.removeScope', { name: name ?? id })}>
                          ✕
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {user.role === 'coach' && (
            <label className="flex items-start gap-3 cursor-pointer select-none bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5">
              <input
                type="checkbox"
                checked={isPldCoach}
                onChange={(e) => setIsPldCoach(e.target.checked)}
                className="w-4 h-4 accent-primary mt-0.5"
              />
              <span>
                <span className="text-sm font-medium block">{t('adminUsers.pldCoach')}</span>
                <span className="text-[11px] text-text-dim">
                  {t('adminUsers.pldCoachHint', { pld: pldId ? org.plds.find((p) => p.id === pldId)?.name ?? t('adminUsers.setPldAbove') : t('adminUsers.setPldAbove') })}
                </span>
              </span>
            </label>
          )}

          <Textarea label={t('adminUsers.adminNotesOptional')} value={notes} onChange={(e) => setNotes(e.target.value)} minRows={2}
            placeholder={t('adminUsers.adminNotesPlaceholder')} />

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={saveMut.isPending}>{t('common.cancel')}</Button>
            <Button variant="primary" size="sm" loading={saveMut.isPending} onClick={submit}>{t('common.saveChanges')}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmRole}
        onClose={() => setConfirmRole(false)}
        onConfirm={() => { setConfirmRole(false); saveMut.mutate() }}
        title={t('adminUsers.confirmRoleChange')}
        message={t('adminUsers.roleChangeConfirm', { name: user.name || t('adminUsers.thisUser'), from: t(ROLE_LABEL_KEYS[user.role]), to: t(ROLE_LABEL_KEYS[newRole]) })}
        confirmLabel={t('adminUsers.changeRoleAndSave')}
        destructive
        loading={saveMut.isPending}
      />
    </>
  )
}

// ─── ACTION MODAL (approve / reject / suspend / reactivate) ───────────────────

function ActionModal({
  user, type, onClose,
}: {
  user: Profile
  type: ActionType
  onClose: () => void
}) {
  const { t } = useLanguage()
  const meta = ACTION_META[type]
  const { ok, err } = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState(false)

  const mut = useMutation({
    mutationFn: () => {
      if (type === 'approve')    return approveUser(user.id)
      if (type === 'reject')     return rejectUser(user.id, reason)
      if (type === 'suspend')    return suspendUser(user.id, reason)
      return reactivateUser(user.id)
    },
    onSuccess: () => {
      ok(t(meta.doneKey, { name: user.name || t('common.user') }))
      qc.invalidateQueries({ queryKey: ['admin2-users'] })
      qc.invalidateQueries({ queryKey: ['admin2-user-summary'] })
      qc.invalidateQueries({ queryKey: ['coach-archer-links'] })
      qc.invalidateQueries({ queryKey: ['user-detail', user.id] })
      onClose()
    },
    onError: (e) => err(t('common.actionFailed'), (e as Error).message),
  })

  const go = () => {
    if (meta.needsReason && !reason.trim()) { setReasonErr(true); return }
    mut.mutate()
  }

  return (
    <Modal open onClose={onClose} title={t(meta.titleKey)} width="min(440px,100%)">
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-[var(--r)] bg-surface-soft border border-line">
          <Avatar name={user.name || user.email} size="md" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{user.name || '—'}</div>
            <div className="text-xs text-text-dim truncate mb-1">{user.email}</div>
            <RoleBadge role={user.role} />
          </div>
        </div>

        {meta.needsReason ? (
          <Textarea
            label={t(meta.reasonLabelKey)}
            placeholder={t(meta.reasonPlaceholderKey)}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setReasonErr(false) }}
            minRows={3}
            error={reasonErr ? t('adminCerts.reasonRequired') : undefined}
          />
        ) : type === 'approve' ? (
          <p className="text-sm text-text-dim leading-relaxed">
            {t('adminUsers.approveExplain')}
          </p>
        ) : (
          <p className="text-sm text-text-dim leading-relaxed">
            {t('adminUsers.reactivateExplain')}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={mut.isPending}>{t('common.cancel')}</Button>
          <Button variant={meta.variant} size="sm" loading={mut.isPending} onClick={go}>{t(meta.verbKey)}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── COACH-ARCHER LINK MODAL ─────────────────────────────────────────────────

function CoachLinkModal({
  user, onClose,
}: {
  user: Profile
  onClose: () => void
}) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()
  const isCoach = user.role === 'coach'
  const [pick, setPick] = useState('')
  const [candidateSearch, setCandidateSearch] = useState('')
  const [debouncedCandidateSearch, setDebouncedCandidateSearch] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCandidateSearch(candidateSearch.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [candidateSearch])

  const linksQ = useQuery({
    queryKey: ['coach-archer-links', user.id],
    queryFn: () => getCoachArcherLinksForUser(user.id),
    staleTime: 30_000,
  })
  const links = linksQ.data ?? []
  const candidatesQ = useQuery({
    queryKey: ['admin2-link-candidates', user.id, isCoach, debouncedCandidateSearch],
    queryFn: () => getUsersAdminPage({
      role: isCoach ? 'archer' : 'coach',
      status: 'approved',
      search: debouncedCandidateSearch,
      limit: 50,
    }),
    staleTime: 30_000,
  })

  const current = links.filter((l) => (isCoach ? l.coach_id === user.id : l.archer_id === user.id))
  const linkedIds = new Set(current.map((l) => (isCoach ? l.archer_id : l.coach_id)))

  const candidates = (candidatesQ.data?.items ?? []).filter(
    (candidate) => candidate.id !== user.id && !linkedIds.has(candidate.id),
  )
  const candidateOptions = [
    { value: '', label: candidates.length
        ? (isCoach ? t('adminUsers.selectArcher') : t('adminUsers.selectCoach'))
        : (isCoach ? t('adminUsers.noAvailableArchers') : t('adminUsers.noAvailableCoaches')) },
    ...candidates.map((u) => ({ value: u.id, label: `${u.name}${u.archer_id ? ` · ${u.archer_id}` : ''}` })),
  ]

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['coach-archer-links', user.id] })
    qc.invalidateQueries({ queryKey: ['admin2-users'] })
    qc.invalidateQueries({ queryKey: ['admin2-user-summary'] })
  }

  const linkMut = useMutation({
    mutationFn: () => (isCoach ? linkCoachToArcher(user.id, pick) : linkCoachToArcher(pick, user.id)),
    onSuccess: () => { ok(t('adminUsers.linkCreated')); setPick(''); invalidate() },
    onError: (e) => err(t('common.actionFailed'), (e as Error).message),
  })

  const unlinkMut = useMutation({
    mutationFn: (linkId: string) => unlinkCoachFromArcher(linkId),
    onSuccess: () => { ok(t('adminUsers.linkRemoved')); invalidate() },
    onError: (e) => err(t('common.actionFailed'), (e as Error).message),
  })

  return (
    <Modal open onClose={onClose} title={isCoach ? t('adminUsers.manageLinkedArchers') : t('adminUsers.manageLinkedCoaches')} width="min(520px,100%)">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={user.name || user.email} size="md" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{user.name || '—'}</div>
            <div className="text-xs text-text-dim truncate">{isCoach ? t('roles.coach') : t('roles.archer')} · {user.email}</div>
          </div>
        </div>

        {/* Add link */}
        <div className="space-y-2">
          <Input
            label={t('common.search')}
            placeholder={t('approvals.searchPlaceholder')}
            value={candidateSearch}
            onChange={(e) => setCandidateSearch(e.target.value)}
          />
          <div className="flex items-end gap-2">
            <Select
              wrapperClassName="flex-1"
              label={isCoach ? t('adminUsers.linkAnArcher') : t('adminUsers.linkACoach')}
              options={candidateOptions}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            />
            <Button
              variant="primary" size="sm"
              disabled={!pick || linkMut.isPending}
              loading={linkMut.isPending}
              onClick={() => linkMut.mutate()}
            >
              {t('adminUsers.link')}
            </Button>
          </div>
        </div>

        {/* Current links */}
        <div>
          <p className="text-[12px] font-semibold text-text-dim mb-2">
            {t('adminUsers.currentLinks', { count: current.length })}
          </p>
          {current.length === 0 ? (
            <p className="text-xs text-text-faint">{t('adminUsers.noActiveLinks')}</p>
          ) : (
            <ul className="space-y-2">
              {current.map((l) => {
                return (
                  <li key={l.id} className="flex items-center justify-between gap-2 bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Avatar name={l.other_name} size="sm" />
                      <span className="text-sm truncate">{l.other_name}</span>
                    </div>
                    <Button
                      variant="danger" size="sm"
                      loading={unlinkMut.isPending && unlinkMut.variables === l.id}
                      onClick={() => unlinkMut.mutate(l.id)}
                    >
                      {t('adminUsers.unlink')}
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.done')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── SMALL PRESENTATION HELPERS ──────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-faint mb-0.5">{label}</p>
      <p className={cn('text-text-dim font-medium truncate', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <p className="text-[12px] font-semibold text-text-dim mb-2">{title}</p>
      {children}
    </div>
  )
}

function Banner({ tone, label, children }: { tone: 'danger' | 'warning' | 'neutral'; label: string; children: React.ReactNode }) {
  const toneCls = tone === 'danger'
    ? 'text-danger bg-danger-soft'
    : tone === 'warning'
    ? 'text-warning bg-warning-soft'
    : 'text-text-dim bg-surface-soft'
  return (
    <div className={cn('text-xs rounded-[var(--r-sm)] px-3 py-2 leading-relaxed', toneCls)}>
      <span className="font-semibold">{label}: </span>{children}
    </div>
  )
}

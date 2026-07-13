import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import {
  Button, Badge, StatCard, Modal, Input, Textarea, Select, Avatar, EmptyState, useToast,
  AccountStatusBadge, RoleBadge, HelpTip, TableSkeleton, ListSkeleton,
} from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import { useHasPermission } from '@/hooks/useRolePermissions'
import { cn } from '@/utils/cn'
import { formatDate } from '@/utils/dates'
import { canApproveRegistrations, canAccessAdmin1, isSuperAdmin } from '@/lib/permissions'
import {
  getAdminScope, isUserWithinAdminScope, getScopeMismatchReason, getScopeLabel,
  matchesAssignments, assignmentsSummary, getUserScope,
  type ScopeNames,
} from '@/lib/scope'
import {
  getPendingApprovalsForAdmin1, getApprovalHistoryForAdmin1, getAdmin1ScopeOptions,
  approveUserByAdmin1, rejectUserByAdmin1, logApprovalDetailView,
} from '@/services/approvals'
import { getAdmin1Scopes } from '@/services/adminScopes'
import type { Profile } from '@/types'

// ─── CONSTANTS / HELPERS ─────────────────────────────────────────────────────

type TabKey = 'pending' | 'approved' | 'rejected' | 'inscope' | 'outside'
const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'pending',  labelKey: 'status.pending' },
  { key: 'approved', labelKey: 'status.approved' },
  { key: 'rejected', labelKey: 'status.rejected' },
  { key: 'inscope',  labelKey: 'approvals.allInScope' },
  { key: 'outside',  labelKey: 'approvals.outsideScope' },
]

type ActionType = 'approve' | 'reject'

function schoolName(u: Profile) { return u.school?.name ?? '—' }
function pldName(u: Profile)    { return u.pld?.name ?? '—' }
function stateName(u: Profile)  { return u.state?.name ?? '—' }

function isSameMonth(dateStr?: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  const n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth()
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function Admin1Approvals() {
  const { profile: actor } = useAuth()
  const { t } = useLanguage()
  const role = actor?.role ?? null
  const qc = useQueryClient()

  const allowed = canApproveRegistrations(role) && canAccessAdmin1(role)
  const superOverride = isSuperAdmin(role)

  // System-rule flags (safe fallbacks keep behaviour unchanged if 015 isn't run).
  const registrationsOpen     = useRuleValue<boolean>('allow_new_registrations', true)
  const archerApprovalEnabled = useRuleValue<boolean>('admin1_can_approve_archers', true)
  const coachApprovalEnabled  = useRuleValue<boolean>('admin1_can_approve_coaches', true)
  const strict                = useRuleValue<boolean>('strict_role_permissions_enabled', false)

  // Dynamic permission gate — single hook, falls back to the static capability.
  const dynApprove = useHasPermission(role, 'approve_user_registration', canApproveRegistrations(role))
  const approveBaseAllowed = strict ? dynApprove : canApproveRegistrations(role)

  const [tab, setTab]         = useState<TabKey>('pending')
  const [search, setSearch]   = useState('')
  const [fRole, setFRole]     = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fState, setFState]   = useState('')
  const [fPld, setFPld]       = useState('')
  const [fSchool, setFSchool] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [detailUser, setDetailUser]   = useState<Profile | null>(null)
  const [action, setAction]           = useState<{ user: Profile; type: ActionType } | null>(null)

  const pendingQ = useQuery({ queryKey: ['admin1-pending'], queryFn: () => getPendingApprovalsForAdmin1(actor), enabled: allowed, staleTime: 30_000 })
  const historyQ = useQuery({ queryKey: ['admin1-history'], queryFn: () => getApprovalHistoryForAdmin1(actor), enabled: allowed, staleTime: 60_000 })
  const orgQ     = useQuery({ queryKey: ['org-options'], queryFn: getAdmin1ScopeOptions, enabled: allowed, staleTime: 5 * 60_000 })

  const pending = useMemo(() => pendingQ.data ?? [], [pendingQ.data])
  const history = useMemo(() => historyQ.data ?? [], [historyQ.data])
  const org = orgQ.data

  // Multi-scope assignments (migration 052) — when any exist they define scope.
  const { data: assignments = [] } = useQuery({
    queryKey: ['my-admin1-scopes', actor?.id],
    queryFn: () => getAdmin1Scopes(actor!.id),
    enabled: !!actor?.id && !superOverride,
    staleTime: 60_000,
  })

  const inScope = (u: Profile) =>
    superOverride ||
    (assignments.length > 0
      ? matchesAssignments(assignments, getUserScope(u))
      : isUserWithinAdminScope(actor, u))

  // Scope resolution (legacy label, or multi-scope summary)
  const scope = getAdminScope(actor)
  const scopeNames: ScopeNames = useMemo(() => ({
    state:  scope.stateId  ? org?.states.find((s) => s.id === scope.stateId)?.name   : undefined,
    pld:    scope.pldId    ? org?.plds.find((p) => p.id === scope.pldId)?.name       : undefined,
    school: scope.schoolId ? org?.schools.find((s) => s.id === scope.schoolId)?.name : undefined,
  }), [scope.stateId, scope.pldId, scope.schoolId, org])
  const scopeLabel = superOverride
    ? t('approvals.superOverride')
    : assignments.length > 0
      ? `${t('approvals.assignedScope')} — ${assignmentsSummary(t, assignments)}`
      : getScopeLabel(t, actor, scopeNames)
  const noScope = !superOverride && assignments.length === 0 && scope.type === 'none'

  const stats = useMemo(() => {
    const inPending = pending.filter(inScope)
    return {
      pending: inPending.length,
      approvedThisMonth: history.filter((u) => u.status === 'approved' && inScope(u) && isSameMonth(u.approved_at)).length,
      rejectedThisMonth: history.filter((u) => u.status === 'rejected' && inScope(u) && isSameMonth(u.rejected_at ?? u.updated_at)).length,
      pendingArchers: inPending.filter((u) => u.role === 'archer').length,
      pendingCoaches: inPending.filter((u) => u.role === 'coach').length,
      outside: pending.filter((u) => !inScope(u)).length,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, history, actor, superOverride])

  const baseList = useMemo(() => {
    switch (tab) {
      case 'pending':  return pending.filter(inScope)
      case 'approved': return history.filter((u) => u.status === 'approved' && inScope(u))
      case 'rejected': return history.filter((u) => u.status === 'rejected' && inScope(u))
      case 'inscope':  return [...pending, ...history].filter(inScope)
      case 'outside':  return pending.filter((u) => !inScope(u))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pending, history, actor, superOverride])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (baseList ?? []).filter((u) => {
      if (fRole && u.role !== fRole) return false
      if (fStatus && u.status !== fStatus) return false
      if (fState && u.state_id !== fState) return false
      if (fPld && u.pld_id !== fPld) return false
      if (fSchool && u.school_id !== fSchool) return false
      if (q) {
        const hay = `${u.name ?? ''} ${u.email ?? ''} ${u.archer_id ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [baseList, search, fRole, fStatus, fState, fPld, fSchool])

  const tabCount = (t: TabKey): number => {
    switch (t) {
      case 'pending':  return pending.filter(inScope).length
      case 'approved': return history.filter((u) => u.status === 'approved' && inScope(u)).length
      case 'rejected': return history.filter((u) => u.status === 'rejected' && inScope(u)).length
      case 'inscope':  return pending.filter(inScope).length + history.filter(inScope).length
      case 'outside':  return pending.filter((u) => !inScope(u)).length
    }
  }

  // Per-target action capability
  const roleApprovalEnabled = (u: Profile) =>
    u.role === 'archer' ? archerApprovalEnabled : u.role === 'coach' ? coachApprovalEnabled : false
  const canActOn = (u: Profile) =>
    approveBaseAllowed && inScope(u) && roleApprovalEnabled(u) && (u.role === 'archer' || u.role === 'coach')

  // Filter options (cascading state → PLD → school)
  const stateOptions = [{ value: '', label: t('common.allStates') }, ...(org?.states ?? []).map((s) => ({ value: s.id, label: s.name }))]
  const pldOptions = [{ value: '', label: t('common.allPlds') }, ...(org?.plds ?? []).filter((p) => !fState || p.state_id === fState).map((p) => ({ value: p.id, label: p.name }))]
  const schoolOptions = [{ value: '', label: t('common.allSchools') }, ...(org?.schools ?? []).filter((s) => (!fState || s.state_id === fState) && (!fPld || s.pld_id === fPld)).map((s) => ({ value: s.id, label: s.name }))]
  const roleFilterOptions = [
    { value: '', label: t('common.allRoles') },
    { value: 'archer', label: t('roles.archer') },
    { value: 'coach', label: t('roles.coach') },
  ]
  const statusFilterOptions = [
    { value: '', label: t('common.allStatuses') },
    { value: 'pending', label: t('status.pending') },
    { value: 'approved', label: t('status.approved') },
    { value: 'rejected', label: t('status.rejected') },
  ]
  const activeFilterCount = [fRole, fStatus, fState, fPld, fSchool].filter(Boolean).length
  const resetFilters = () => { setFRole(''); setFStatus(''); setFState(''); setFPld(''); setFSchool('') }

  // ── Guards (after all hooks) ──
  if (!actor) return null
  if (!allowed) {
    return (
      <AccessDenied message={t('approvals.accessDenied')} />
    )
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('approvals.title')}
        description={t('approvals.description')}
      />

      {/* ── SCOPE BANNER ── */}
      <div className={cn(
        'rounded-[var(--r-lg)] border p-4 mb-5 flex items-start gap-3',
        noScope ? 'border-warning bg-warning-soft' : 'border-line bg-surface shadow-card',
      )}>
        <div className={cn('w-10 h-10 rounded-[12px] flex items-center justify-center flex-shrink-0',
          noScope ? 'bg-warning/15 text-warning' : 'bg-primary-soft text-primary')}>
          <PinIcon />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-text-faint font-semibold flex items-center gap-1.5">
            {t('approvals.yourScope')}
            <HelpTip
              title={t('helpTips.approvalQueue.title')}
              what={t('helpTips.approvalQueue.what')}
              who={t('helpTips.approvalQueue.who')}
              reversible={t('helpTips.approvalQueue.reversible')}
              warning={t('helpTips.approvalQueue.warning')}
            />
          </p>
          <p className="font-display font-semibold text-[15px] mt-0.5">{scopeLabel}</p>
          {noScope ? (
            <p className="text-xs text-warning mt-1 leading-relaxed">
              {t('approvals.noScopeYet')}
            </p>
          ) : superOverride ? (
            <p className="text-[11px] text-text-faint mt-1">{t('approvals.superViewing')}</p>
          ) : scope.source === 'derived' ? (
            <p className="text-[11px] text-text-faint mt-1">{t('approvals.derivedScope')}</p>
          ) : null}
        </div>
      </div>

      {/* ── STAT CARDS ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard label={t('status.pending')} value={stats.pending} onClick={() => setTab('pending')} active={tab === 'pending'} badge={stats.pending} />
        <StatCard label={t('approvals.approvedThisMonth')} value={stats.approvedThisMonth} onClick={() => setTab('approved')} active={tab === 'approved'} />
        <StatCard label={t('approvals.rejectedThisMonth')} value={stats.rejectedThisMonth} onClick={() => setTab('rejected')} active={tab === 'rejected'} />
        <StatCard label={t('approvals.pendingArchers')} value={stats.pendingArchers} onClick={() => { setTab('pending'); setFRole('archer') }} />
        <StatCard label={t('approvals.pendingCoaches')} value={stats.pendingCoaches} onClick={() => { setTab('pending'); setFRole('coach') }} />
        <StatCard label={t('approvals.outsideScope')} value={stats.outside} onClick={() => setTab('outside')} active={tab === 'outside'} />
      </div>

      {/* ── SYSTEM-RULE NOTICES ── */}
      {(!registrationsOpen || !archerApprovalEnabled || !coachApprovalEnabled) && (
        <div className="mb-4 space-y-1.5">
          {!registrationsOpen && (
            <p className="text-xs text-warning bg-warning-soft rounded-[var(--r-sm)] px-3 py-2">
              {t('approvals.registrationsClosed')}
            </p>
          )}
          {!archerApprovalEnabled && (
            <p className="text-xs text-text-dim bg-section rounded-[var(--r-sm)] px-3 py-2">{t('approvals.archerApprovalsOff')}</p>
          )}
          {!coachApprovalEnabled && (
            <p className="text-xs text-text-dim bg-section rounded-[var(--r-sm)] px-3 py-2">{t('approvals.coachApprovalsOff')}</p>
          )}
        </div>
      )}

      {/* ── SEARCH + FILTERS ── */}
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
                'flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-sm font-display font-semibold transition-all duration-150 whitespace-nowrap',
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

      {tab === 'outside' && (
        <p className="mb-4 text-xs text-text-dim bg-section rounded-[var(--r-sm)] px-3 py-2">
          {t('approvals.outsideNotice')}
        </p>
      )}

      {/* ── CONTENT ── */}
      {(pendingQ.isLoading || historyQ.isLoading) ? (
        <>
          <div className="hidden lg:block"><TableSkeleton rows={7} cols={7} /></div>
          <div className="lg:hidden"><ListSkeleton rows={6} /></div>
        </>
      ) : (pendingQ.isError || historyQ.isError) ? (
        <EmptyState
          tone="danger"
          title={t('approvals.loadError')}
          action={<Button variant="outline" onClick={() => { pendingQ.refetch(); historyQ.refetch() }}>{t('common.retry')}</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={noScope ? t('approvals.noScopeTitle') : search || activeFilterCount ? t('approvals.noMatchingUsers') : t('approvals.nothingHere')}
          description={noScope ? t('approvals.noScopeDesc') : search || activeFilterCount ? t('common.noResultsFilters') : t('approvals.noRegistrations')}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="card hidden lg:block overflow-x-auto p-0">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-surface-soft">
                  {[t('common.user'), t('common.role'), t('common.status'), t('common.archerId'), t('common.school'), t('common.pld'), t('common.state'), t('approvals.created'), t('approvals.scope'), ''].map((h, i) => (
                    <th key={i} className={cn(
                      'text-left py-3 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong whitespace-nowrap',
                      i === 0 ? 'pl-4 pr-3' : 'px-3',
                    )}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const ok = inScope(u)
                  return (
                    <tr key={u.id} className="border-b border-line last:border-0 hover:bg-surface-soft transition-colors">
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
                      <td className="px-3 py-2.5 text-xs text-text-dim tabular-nums whitespace-nowrap">{formatDate(u.created_at)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><ScopeBadge inScope={ok} /></td>
                      <td className="px-3 py-2.5 pr-4">
                        <ApprovalActions user={u} canAct={canActOn(u)} onView={() => setDetailUser(u)} onAction={(type) => setAction({ user: u, type })} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map((u) => (
              <ApprovalCard
                key={u.id} user={u} inScope={inScope(u)} canAct={canActOn(u)}
                onView={() => setDetailUser(u)} onAction={(type) => setAction({ user: u, type })}
              />
            ))}
          </div>
        </>
      )}

      {/* ── MODALS ── */}
      {detailUser && (
        <DetailModal
          user={detailUser}
          mismatchReason={superOverride ? null : getScopeMismatchReason(t, actor, detailUser)}
          onClose={() => setDetailUser(null)}
        />
      )}
      {action && (
        <ActionModal user={action.user} type={action.type} onClose={() => setAction(null)} onDone={() => {
          qc.invalidateQueries({ queryKey: ['admin1-pending'] })
          qc.invalidateQueries({ queryKey: ['admin1-history'] })
        }} />
      )}
    </PageWrapper>
  )
}

// ─── ROW ACTIONS ─────────────────────────────────────────────────────────────

function ApprovalActions({ user, canAct, onView, onAction }: {
  user: Profile
  canAct: boolean
  onView: () => void
  onAction: (type: ActionType) => void
}) {
  const { t } = useLanguage()
  const isPending = user.status === 'pending'
  return (
    <div className="flex flex-wrap gap-1.5 justify-end">
      <Button variant="ghost" size="sm" onClick={onView}>{t('common.view')}</Button>
      {isPending && canAct && <Button variant="success" size="sm" onClick={() => onAction('approve')}>{t('common.approve')}</Button>}
      {isPending && canAct && <Button variant="danger" size="sm" onClick={() => onAction('reject')}>{t('common.reject')}</Button>}
      {isPending && !canAct && <span className="text-[11px] text-text-faint self-center px-1">{t('approvals.viewOnly')}</span>}
    </div>
  )
}

function ScopeBadge({ inScope }: { inScope: boolean }) {
  const { t } = useLanguage()
  return inScope ? <Badge variant="success">{t('approvals.inScope')}</Badge> : <Badge variant="warning">{t('approvals.outsideScope')}</Badge>
}

// ─── MOBILE CARD ─────────────────────────────────────────────────────────────

function ApprovalCard({ user, inScope, canAct, onView, onAction }: {
  user: Profile
  inScope: boolean
  canAct: boolean
  onView: () => void
  onAction: (type: ActionType) => void
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
            {user.archer_id && <span className="text-[10px] font-mono text-text-faint bg-surface-soft px-1.5 py-0.5 rounded">{user.archer_id}</span>}
            <ScopeBadge inScope={inScope} />
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
        <ApprovalActions user={user} canAct={canAct} onView={onView} onAction={onAction} />
      </div>
    </div>
  )
}

// ─── DETAIL MODAL ────────────────────────────────────────────────────────────

function DetailModal({ user, mismatchReason, onClose }: {
  user: Profile
  mismatchReason: string | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  useEffect(() => {
    logApprovalDetailView(user.id, user.role)
  }, [user.id, user.role])

  return (
    <Modal open onClose={onClose} title={t('approvals.detailTitle')} width="min(540px,100%)">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={user.name || user.email} size="lg" />
          <div className="min-w-0">
            <div className="font-semibold text-base truncate">{user.name || '—'}</div>
            <div className="text-xs text-text-dim truncate">{user.email}</div>
            <div className="flex items-center gap-2 mt-1.5">
              <RoleBadge role={user.role} />
              <AccountStatusBadge status={user.status} />
            </div>
          </div>
        </div>

        {/* Scope match explanation */}
        <div className={cn('text-xs rounded-[var(--r-sm)] px-3 py-2 leading-relaxed',
          mismatchReason ? 'text-warning bg-warning-soft' : 'text-success bg-success-soft')}>
          <span className="font-semibold">{mismatchReason ? `${t('approvals.outsideYourScope')}: ` : `${t('approvals.inYourScope')}. `}</span>
          {mismatchReason ?? t('approvals.canApproveReject')}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <Field label={t('common.archerId')} value={user.archer_id ?? '—'} mono />
          <Field label={t('common.phone')} value={user.phone ?? '—'} />
          <Field label={t('common.school')} value={schoolName(user)} />
          <Field label={t('common.pld')} value={pldName(user)} />
          <Field label={t('common.state')} value={stateName(user)} />
          <Field label={t('approvals.created')} value={formatDate(user.created_at)} />
          {user.role === 'archer' && <Field label={t('common.bowCategory')} value={user.bow_category ?? '—'} />}
          {user.role === 'archer' && <Field label={t('common.age')} value={user.age != null ? String(user.age) : '—'} />}
        </div>

        {user.status === 'approved' && user.approved_at && (
          <Banner tone="success" label={t('status.approved')}>{formatDate(user.approved_at)}</Banner>
        )}
        {user.status === 'rejected' && (
          <Banner tone="danger" label={t('status.rejected')}>
            {user.rejection_reason || t('approvals.noReasonRecorded')}
            {user.rejected_at ? ` · ${formatDate(user.rejected_at)}` : ''}
          </Banner>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── ACTION MODAL ────────────────────────────────────────────────────────────

function ActionModal({ user, type, onClose, onDone }: {
  user: Profile
  type: ActionType
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState(false)

  const mut = useMutation({
    mutationFn: () => (type === 'approve' ? approveUserByAdmin1(user.id) : rejectUserByAdmin1(user.id, reason)),
    onSuccess: () => {
      ok(type === 'approve'
        ? t('approvals.userApproved', { name: user.name || t('common.user') })
        : t('approvals.userRejected', { name: user.name || t('common.user') }))
      onDone()
      onClose()
    },
    onError: (e) => err(t('common.actionFailed'), (e as Error).message),
  })

  const go = () => {
    if (type === 'reject' && !reason.trim()) { setReasonErr(true); return }
    mut.mutate()
  }

  return (
    <Modal open onClose={onClose} title={type === 'approve' ? t('approvals.approveTitle') : t('approvals.rejectTitle')} width="min(440px,100%)">
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-3 rounded-[var(--r)] bg-surface-soft border border-line">
          <Avatar name={user.name || user.email} size="md" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{user.name || '—'}</div>
            <div className="text-xs text-text-dim truncate mb-1">{user.email}</div>
            <RoleBadge role={user.role} />
          </div>
        </div>

        {type === 'reject' ? (
          <Textarea
            label={t('approvals.rejectionReasonLabel')}
            placeholder={t('approvals.rejectionReasonPlaceholder')}
            value={reason}
            onChange={(e) => { setReason(e.target.value); setReasonErr(false) }}
            minRows={3}
            error={reasonErr ? t('approvals.rejectionReasonRequired') : undefined}
          />
        ) : (
          <p className="text-sm text-text-dim leading-relaxed">
            {t('approvals.approveExplain')}
          </p>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={mut.isPending}>{t('common.cancel')}</Button>
          <Button variant={type === 'approve' ? 'success' : 'danger'} size="sm" loading={mut.isPending} onClick={go}>
            {type === 'approve' ? t('common.approve') : t('common.reject')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── SMALL HELPERS ───────────────────────────────────────────────────────────

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-text-faint mb-0.5">{label}</p>
      <p className={cn('text-text-dim font-medium truncate', mono && 'font-mono text-xs')}>{value}</p>
    </div>
  )
}

function Banner({ tone, label, children }: { tone: 'success' | 'danger'; label: string; children: React.ReactNode }) {
  return (
    <div className={cn('text-xs rounded-[var(--r-sm)] px-3 py-2 leading-relaxed',
      tone === 'success' ? 'text-success bg-success-soft' : 'text-danger bg-danger-soft')}>
      <span className="font-semibold">{label}: </span>{children}
    </div>
  )
}

function PinIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

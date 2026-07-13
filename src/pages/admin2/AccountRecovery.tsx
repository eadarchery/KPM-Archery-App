import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, Modal, StatCard, EmptyState, Textarea, useToast } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useLanguage } from '@/contexts/LanguageContext'
import { useAuth } from '@/hooks/useAuth'
import { isOperationalAdmin } from '@/lib/permissions'
import {
  getAccountRecoveryRequests,
  updateAccountRecoveryRequestStatus,
  type AccountRecoveryRequest,
  type AccountRecoveryStatus,
} from '@/services/accountRecovery'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'

const STATUS_VARIANT: Record<AccountRecoveryStatus, 'warning' | 'primary' | 'success' | 'danger'> = {
  pending: 'warning',
  reviewing: 'primary',
  resolved: 'success',
  rejected: 'danger',
}

const STATUS_TABS: (AccountRecoveryStatus | 'all')[] = ['all', 'pending', 'reviewing', 'resolved', 'rejected']

// ─── DETAIL MODAL ────────────────────────────────────────────────────────────

function RequestDetail({
  request, busy, onClose, onUpdate,
}: {
  request: AccountRecoveryRequest
  busy: boolean
  onClose: () => void
  onUpdate: (status: AccountRecoveryStatus, adminNotes: string) => void
}) {
  const { t } = useLanguage()
  const [notes, setNotes] = useState(request.admin_notes ?? '')

  const rows: { label: string; value: string | null }[] = [
    { label: t('auth.forgotEmail.role'), value: request.role ? t('roles.' + request.role) : null },
    { label: t('auth.forgotEmail.phone'), value: request.phone },
    { label: t('auth.forgotEmail.archerId'), value: request.archer_id },
    { label: t('auth.forgotEmail.school'), value: request.school_name },
    { label: t('auth.forgotEmail.state'), value: request.state_name },
    { label: t('auth.forgotEmail.pld'), value: request.pld_name },
    { label: t('auth.forgotEmail.coachName'), value: request.coach_name },
    { label: t('auth.forgotEmail.notes'), value: request.notes },
  ]

  return (
    <Modal open onClose={onClose} title={t('admin.accountRecovery.requestDetails')} width="min(560px,100%)">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display font-semibold text-text">{request.full_name}</span>
          <Badge variant={STATUS_VARIANT[request.status]}>{t('admin.accountRecovery.' + request.status)}</Badge>
        </div>

        <div className="rounded-[var(--r)] border border-line bg-section divide-y divide-line">
          {rows.filter((r) => r.value).map((r) => (
            <div key={r.label} className="flex gap-3 px-3 py-2 text-sm">
              <span className="text-text-faint w-28 flex-shrink-0">{r.label}</span>
              <span className="text-text break-words min-w-0">{r.value}</span>
            </div>
          ))}
        </div>

        <div className="text-[11px] text-text-faint">
          {t('admin.accountRecovery.submittedOn')}: {formatDate(request.created_at)}
          {request.reviewed_at && (
            <> · {t('admin.accountRecovery.reviewedBy')}: {formatDate(request.reviewed_at)}</>
          )}
        </div>

        <Textarea
          label={t('admin.accountRecovery.adminNotes')}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          minRows={2}
        />

        <div className="rounded-[var(--r)] border border-warning/40 bg-warning-soft/30 p-3 text-xs text-text-dim leading-relaxed">
          {t('admin.accountRecovery.privacyNote')}
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUpdate('reviewing', notes)}>
            {t('admin.accountRecovery.markReviewing')}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onUpdate('rejected', notes)}>
            {t('admin.accountRecovery.markRejected')}
          </Button>
          <Button variant="primary" size="sm" loading={busy} onClick={() => onUpdate('resolved', notes)}>
            {t('admin.accountRecovery.markResolved')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function Admin2AccountRecovery() {
  const { profile } = useAuth()
  const role = profile?.role
  const { t } = useLanguage()
  const qc = useQueryClient()
  const { ok, err } = useToast()

  const [activeStatus, setActiveStatus] = useState<AccountRecoveryStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AccountRecoveryRequest | null>(null)

  const { data: requests = [], isLoading, error } = useQuery({
    queryKey: ['account-recovery'],
    queryFn: () => getAccountRecoveryRequests(),
    enabled: isOperationalAdmin(role),
  })

  const updateMut = useMutation({
    mutationFn: (v: { id: string; status: AccountRecoveryStatus; adminNotes: string }) =>
      updateAccountRecoveryRequestStatus(v.id, v.status, v.adminNotes),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['account-recovery'] })
      ok(t('admin.accountRecovery.status'))
      setSelected(null)
    },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })

  const stats = useMemo(() => ({
    total: requests.length,
    pending: requests.filter((r) => r.status === 'pending').length,
    reviewing: requests.filter((r) => r.status === 'reviewing').length,
    resolved: requests.filter((r) => r.status === 'resolved').length,
  }), [requests])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return requests.filter((r) => {
      if (activeStatus !== 'all' && r.status !== activeStatus) return false
      if (q && ![r.full_name, r.archer_id, r.school_name, r.phone]
        .some((v) => (v ?? '').toLowerCase().includes(q))) return false
      return true
    })
  }, [requests, activeStatus, search])

  if (!isOperationalAdmin(role)) {
    return <AccessDenied />
  }

  return (
    <PageWrapper>
      <PageHead title={t('admin.accountRecovery.title')} description={t('admin.accountRecovery.description')} />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label={t('common.total')} value={stats.total} />
        <StatCard label={t('admin.accountRecovery.pending')} value={stats.pending} />
        <StatCard label={t('admin.accountRecovery.reviewing')} value={stats.reviewing} />
        <StatCard label={t('admin.accountRecovery.resolved')} value={stats.resolved} />
      </div>

      {/* Status tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {STATUS_TABS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setActiveStatus(s)}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border',
              activeStatus === s
                ? 'bg-primary text-primary-on border-primary'
                : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
            )}
          >
            {s === 'all' ? t('admin.accountRecovery.allStatuses') : t('admin.accountRecovery.' + s)}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('admin.accountRecovery.search')}
          className="field w-full text-sm"
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-20 text-center text-text-faint text-sm">{t('common.loading')}</div>
      ) : error ? (
        <SectionCard>
          <EmptyState
            title={t('admin.accountRecovery.loadError')}
            description={t('admin.accountRecovery.loadErrorHint')}
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title={t('admin.accountRecovery.noRequests')}
            description={t('admin.accountRecovery.noRequestsHint')}
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
          {filtered.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelected(r)}
              className="text-left rounded-[var(--r)] border border-line bg-surface p-4 hover:border-line-strong hover:shadow-card transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-display font-semibold text-sm text-text truncate">{r.full_name}</div>
                  <div className="text-xs text-text-dim mt-0.5">
                    {r.role ? t('roles.' + r.role) : '—'}
                    {r.phone && <> · {r.phone}</>}
                  </div>
                </div>
                <Badge variant={STATUS_VARIANT[r.status]} className="flex-shrink-0">
                  {t('admin.accountRecovery.' + r.status)}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-line text-[11px] text-text-faint">
                <span className="truncate">{r.school_name || r.archer_id || '—'}</span>
                <span className="flex-shrink-0">{formatDate(r.created_at)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <RequestDetail
          request={selected}
          busy={updateMut.isPending}
          onClose={() => setSelected(null)}
          onUpdate={(status, adminNotes) => updateMut.mutate({ id: selected.id, status, adminNotes })}
        />
      )}
    </PageWrapper>
  )
}

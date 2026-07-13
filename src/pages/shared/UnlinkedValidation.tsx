import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, Avatar, Modal, Textarea, EmptyState, useToast } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { ArcherHistoryModal } from '@/components/admin/ArcherHistoryModal'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { isOperationalAdmin } from '@/lib/permissions'
import {
  getUnlinkedArchers, getUnlinkedPendingScores, validateUnlinkedScore,
  type UnlinkedPendingScore,
} from '@/services/unlinkedArchers'
import { formatDate, timeAgo } from '@/utils/dates'
import { scoreDisplay } from '@/utils/format'

/**
 * Unlinked-archer validation (Tasks 8–10). Archers with no active coach still
 * submit scores (they land as `pending`); with no coach to validate them,
 * Admin 1 (within scope) and Admin 2 / Super Admin do it here. Every read/write
 * goes through the scoped SECURITY DEFINER RPCs in migration 059, so this one
 * page is safe for all three roles — the server enforces who sees what.
 */

/** Distinct error state so a failed RPC never masquerades as "no data". */
function LoadError({ msg }: { msg: string }) {
  const { t } = useLanguage()
  return (
    <div className="rounded-[var(--r-md)] border border-danger/40 bg-danger-soft/20 p-4 text-center">
      <p className="text-sm font-semibold text-danger">{t('unlinked.loadError')}</p>
      <p className="text-xs text-text-dim mt-1">{t('unlinked.loadErrorHint', { msg })}</p>
    </div>
  )
}

export default function UnlinkedValidation() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const role = profile?.role
  const canValidate = role === 'admin1' || isOperationalAdmin(role)

  const [rejecting, setRejecting] = useState<UnlinkedPendingScore | null>(null)
  const [reason, setReason] = useState('')
  const [reasonErr, setReasonErr] = useState(false)
  const [historyArcher, setHistoryArcher] = useState<{ id: string; name: string; code: string | null } | null>(null)

  const { data: scores = [], isLoading: loadingScores, error: scoresError } = useQuery({
    queryKey: ['unlinked-pending-scores'],
    queryFn: getUnlinkedPendingScores,
    enabled: canValidate,
    retry: false,
    staleTime: 30_000,
  })

  const { data: archers = [], isLoading: loadingArchers, error: archersError } = useQuery({
    queryKey: ['unlinked-archers'],
    queryFn: getUnlinkedArchers,
    enabled: canValidate,
    retry: false,
    staleTime: 30_000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['unlinked-pending-scores'] })
    queryClient.invalidateQueries({ queryKey: ['unlinked-archers'] })
  }

  const approveMut = useMutation({
    mutationFn: (id: string) => validateUnlinkedScore(id, true),
    onSuccess: () => { ok(t('unlinked.approved')); invalidate() },
    onError: (e: Error) => err(e.message),
  })

  const rejectMut = useMutation({
    mutationFn: ({ id, r }: { id: string; r: string }) => validateUnlinkedScore(id, false, r),
    onSuccess: () => { ok(t('unlinked.rejected')); setRejecting(null); setReason(''); invalidate() },
    onError: (e: Error) => err(e.message),
  })

  function confirmReject() {
    if (!rejecting) return
    if (!reason.trim()) { setReasonErr(true); return }
    rejectMut.mutate({ id: rejecting.id, r: reason.trim() })
  }

  if (!canValidate) return <AccessDenied />

  return (
    <PageWrapper>
      <PageHead title={t('unlinked.title')} description={t('unlinked.description')} />

      {/* ── NEEDS ADMIN VALIDATION (pending scores) ── */}
      <SectionCard
        title={t('unlinked.needsValidation')}
        className="mb-6"
        action={scores.length > 0 ? <Badge variant="warning">{scores.length}</Badge> : undefined}
      >
        {loadingScores ? (
          <p className="py-6 text-center text-text-faint text-sm">{t('common.loading')}</p>
        ) : scoresError ? (
          <LoadError msg={(scoresError as Error).message} />
        ) : scores.length === 0 ? (
          <EmptyState title={t('unlinked.noScores')} description={t('unlinked.noScoresHint')} />
        ) : (
          <div className="space-y-2">
            {scores.map((s) => (
              <div key={s.id} className="border border-line rounded-[var(--r-md)] p-3 flex flex-wrap items-center gap-3">
                <Avatar name={s.archer_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{s.archer_name}</span>
                    {s.archer_code && <span className="font-mono text-[11px] text-text-faint">{s.archer_code}</span>}
                    <Badge variant={s.round_category === 'tournament' ? 'warning' : 'neutral'}>
                      {t(`roundCategories.${s.round_category ?? 'training'}`)}
                    </Badge>
                    {s.age_group && <Badge variant="neutral">{s.age_group}</Badge>}
                  </div>
                  <div className="text-xs text-text-faint mt-0.5 truncate">
                    {s.round_name} · {formatDate(s.date)}
                    {s.school_name ? ` · ${s.school_name}` : ''}
                    {s.proof_url ? ` · ${t('unlinked.hasProof')}` : ''}
                  </div>
                </div>
                <span className="font-display font-semibold text-sm">{scoreDisplay(s.total_score, s.max_score)}</span>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setHistoryArcher({ id: s.archer_id, name: s.archer_name, code: s.archer_code })}>
                    {t('adminUsers.history')}
                  </Button>
                  <Button size="sm" variant="success" loading={approveMut.isPending} onClick={() => approveMut.mutate(s.id)}>
                    {t('common.approve')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => { setRejecting(s); setReason(''); setReasonErr(false) }}>
                    {t('common.reject')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ── UNLINKED ARCHERS (needing reassignment) ── */}
      <SectionCard
        title={t('unlinked.archersTitle')}
        action={archers.length > 0 ? <Badge variant="neutral">{archers.length}</Badge> : undefined}
      >
        <p className="text-sm text-text-dim mb-3">{t('unlinked.archersHint')}</p>
        {loadingArchers ? (
          <p className="py-6 text-center text-text-faint text-sm">{t('common.loading')}</p>
        ) : archersError ? (
          <LoadError msg={(archersError as Error).message} />
        ) : archers.length === 0 ? (
          <EmptyState title={t('unlinked.noArchers')} description={t('unlinked.noArchersHint')} />
        ) : (
          <div className="space-y-2">
            {archers.map((a) => (
              <div key={a.id} className="border border-line rounded-[var(--r-md)] p-3 flex flex-wrap items-center gap-3">
                <Avatar name={a.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm truncate">{a.name}</span>
                    {a.archer_id && <span className="font-mono text-[11px] text-text-faint">{a.archer_id}</span>}
                    <Badge variant="warning" dot>{t('unlinked.badge')}</Badge>
                  </div>
                  <div className="text-xs text-text-faint mt-0.5 truncate">
                    {[a.school_name, a.pld_name, a.state_name].filter(Boolean).join(' · ') || t('archerProfile.notAssigned')}
                    {a.last_coach_name ? ` · ${t('unlinked.lastCoach')}: ${a.last_coach_name}` : ''}
                    {a.last_score_date ? ` · ${t('unlinked.lastScore')}: ${timeAgo(a.last_score_date)}` : ''}
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setHistoryArcher({ id: a.id, name: a.name, code: a.archer_id })}>
                  {t('adminUsers.history')}
                </Button>
                {isOperationalAdmin(role) ? (
                  <Button size="sm" variant="outline" onClick={() => navigate('/admin2/users')}>
                    {t('unlinked.linkToCoach')}
                  </Button>
                ) : (
                  <span className="text-[11px] text-text-faint italic max-w-[180px] text-right">{t('unlinked.linkGuidance')}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Reject reason modal */}
      <Modal open={!!rejecting} onClose={() => { if (!rejectMut.isPending) setRejecting(null) }} title={t('unlinked.rejectTitle')} width="min(440px,100%)">
        {rejecting && (
          <div className="space-y-4">
            <p className="text-sm text-text-dim">{t('unlinked.rejectExplain', { name: rejecting.archer_name })}</p>
            <Textarea
              label={t('approvals.rejectionReasonLabel')}
              value={reason}
              onChange={(e) => { setReason(e.target.value); setReasonErr(false) }}
              minRows={3}
              error={reasonErr ? t('approvals.rejectionReasonRequired') : undefined}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setRejecting(null)} disabled={rejectMut.isPending}>{t('common.cancel')}</Button>
              <Button variant="danger" size="sm" loading={rejectMut.isPending} onClick={confirmReject}>{t('common.reject')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Read-only archer history (works for unlinked archers — admin RLS) */}
      <ArcherHistoryModal
        open={!!historyArcher}
        archerId={historyArcher?.id ?? null}
        archerName={historyArcher?.name}
        archerCode={historyArcher?.code}
        onClose={() => setHistoryArcher(null)}
      />
    </PageWrapper>
  )
}

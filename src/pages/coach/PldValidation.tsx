import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, EmptyState, Modal, Textarea, useToast, Avatar } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { writeAuditLog } from '@/services/auditLog'
import { formatDate } from '@/utils/dates'

interface QueueRow {
  id: string
  archer_id: string
  coach_id: string | null
  round_id: string | null
  date: string
  total_score: number
  max_score: number
  status: string
  proof_url: string | null
  notes: string | null
  created_at: string
  owner_name?: string
  owner_role?: string
  coach_name?: string | null
  round_name?: string | null
}

/**
 * PLD Coach validation queue — only for coaches flagged is_pld_coach.
 *   • pending        → a coach's OWN score awaiting validation
 *   • coach_approved → a school coach's archer submission (photo proof)
 * Approving finalises (admin_approved); rejecting requires a reason.
 * A PLD coach never sees their own submissions here (blocked by RLS).
 */
export default function PldValidationPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()
  const isPldCoach = !!(profile as { is_pld_coach?: boolean } | null)?.is_pld_coach

  const [selected, setSelected] = useState<QueueRow | null>(null)
  const [action, setAction] = useState<'approve' | 'reject' | 'proof' | null>(null)
  const [reason, setReason] = useState('')
  const [acting, setActing] = useState(false)
  const [proofUrls, setProofUrls] = useState<string[]>([])

  const { data: queue = [], isLoading } = useQuery<QueueRow[]>({
    queryKey: ['pld-validation-queue', profile?.id],
    enabled: !!profile?.id && isPldCoach,
    staleTime: 30_000,
    queryFn: async () => {
      // RLS (pld_coach_scope) narrows this to submissions in the PLD coach's
      // scope, excluding their own. Client filters to the two queue states and
      // drops rows the coach owns anyway (defence in depth).
      const { data, error } = await supabase
        .from('score_submissions')
        .select('id, archer_id, coach_id, round_id, date, total_score, max_score, status, proof_url, notes, created_at')
        .in('status', ['pending', 'coach_approved'])
        .order('created_at', { ascending: true })
      if (error) throw error
      let rows = (data ?? []) as QueueRow[]
      rows = rows.filter((r) => r.archer_id !== profile!.id && r.coach_id !== profile!.id)
      if (!rows.length) return []

      const profileIds = [...new Set(rows.flatMap((r) => [r.archer_id, r.coach_id]).filter(Boolean))] as string[]
      const roundIds = [...new Set(rows.map((r) => r.round_id).filter(Boolean))] as string[]
      const [pRes, rRes] = await Promise.all([
        supabase.from('profiles').select('id, name, role').in('id', profileIds),
        roundIds.length
          ? supabase.from('rounds').select('id, name').in('id', roundIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ])
      const pmap = new Map(((pRes.data ?? []) as { id: string; name: string; role: string }[]).map((p) => [p.id, p]))
      const rmap = new Map(((rRes.data ?? []) as { id: string; name: string }[]).map((r) => [r.id, r]))
      // Keep only rows in the PLD-coach lane: coach self-scores (owner is a
      // coach) or school-coach submissions for archers (coach_approved).
      return rows
        .map((r) => ({
          ...r,
          owner_name: pmap.get(r.archer_id)?.name,
          owner_role: pmap.get(r.archer_id)?.role,
          coach_name: r.coach_id ? pmap.get(r.coach_id)?.name ?? null : null,
          round_name: r.round_id ? rmap.get(r.round_id)?.name ?? null : null,
        }))
        .filter((r) =>
          (r.status === 'pending' && r.owner_role === 'coach') ||
          r.status === 'coach_approved')
    },
  })

  async function openProof(row: QueueRow) {
    setSelected(row); setAction('proof'); setProofUrls([])
    if (!row.proof_url) return
    // Multiple photos supported as |-joined paths.
    const paths = row.proof_url.split('|').filter(Boolean)
    const urls: string[] = []
    for (const p of paths) {
      const { data } = await supabase.storage.from('proof-photos').createSignedUrl(p, 3600)
      if (data?.signedUrl) urls.push(data.signedUrl)
    }
    setProofUrls(urls)
  }

  async function decide(approve: boolean) {
    if (!selected || !profile) return
    if (!approve && !reason.trim()) return
    setActing(true)
    try {
      const { error } = await supabase
        .from('score_submissions')
        .update(approve
          ? { status: 'admin_approved' }
          : { status: 'rejected', rejection_reason: reason.trim() })
        .eq('id', selected.id)
        .in('status', ['pending', 'coach_approved'])
      if (error) throw error
      writeAuditLog(profile.id, approve ? 'pld_coach.score_approved' : 'pld_coach.score_rejected',
        'score_submission', selected.id, {
          owner: selected.owner_name, score: `${selected.total_score}/${selected.max_score}`,
          ...(approve ? {} : { reason: reason.trim() }),
        })
      ok(approve ? t('pldVal.validated') : t('pldVal.rejected'))
      qc.invalidateQueries({ queryKey: ['pld-validation-queue'] })
      setSelected(null); setAction(null); setReason('')
    } catch (e: unknown) {
      err((e as Error).message)
    } finally {
      setActing(false)
    }
  }

  if (!isPldCoach) {
    return (
      <PageWrapper>
        <PageHead title={t('pldVal.title')} description="" />
        <SectionCard>
          <EmptyState
            title={t('pldVal.accessOnly')}
            description={t('pldVal.accessOnlyHint')}
          />
        </SectionCard>
      </PageWrapper>
    )
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('pldVal.title')}
        description={t('pldVal.description')}
        pill={queue.length > 0 ? (
          <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] bg-danger text-white text-[11px] font-bold rounded-full px-1.5">
            {queue.length}
          </span>
        ) : undefined}
      />

      <SectionCard>
        {isLoading ? (
          <p className="py-8 text-center text-text-faint text-sm">{t('common.loading')}</p>
        ) : queue.length === 0 ? (
          <EmptyState title={t('pldVal.queueClear')} description={t('pldVal.queueClearHint')} />
        ) : (
          <div className="space-y-2">
            {queue.map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-3 p-3 rounded-[var(--r)] border border-line bg-surface">
                <Avatar name={row.owner_name ?? '?'} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{row.owner_name ?? '—'}</span>
                    <Badge variant={row.status === 'pending' ? 'primary' : 'warning'} dot>
                      {row.status === 'pending' ? t('pldVal.coachOwnScore') : t('pldVal.schoolCoachSubmission')}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-dim mt-0.5">
                    {row.round_name ?? t('common.round')} · {formatDate(row.date)}
                    {row.status === 'coach_approved' && row.coach_name ? ` · ${t('pldVal.submittedBy')} ${row.coach_name}` : ''}
                  </p>
                </div>
                <span className="font-display font-bold text-lg">{row.total_score}/{row.max_score}</span>
                <div className="flex gap-1.5">
                  {row.proof_url && <Button variant="ghost" size="sm" onClick={() => openProof(row)}>{t('pldVal.proof')}</Button>}
                  <Button variant="success" size="sm" onClick={() => { setSelected(row); setAction('approve') }}>{t('common.approve')}</Button>
                  <Button variant="danger" size="sm" onClick={() => { setSelected(row); setAction('reject'); setReason('') }}>{t('common.reject')}</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Approve */}
      <Modal open={action === 'approve' && !!selected} onClose={() => !acting && setAction(null)} title={t('pldVal.validateScore')} width="min(420px,100%)">
        {selected && (
          <div className="space-y-4">
            <p className="text-sm text-text-dim">
              {t('pldVal.approveConfirm', { name: selected.owner_name ?? '—', score: `${selected.total_score}/${selected.max_score}` })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAction(null)} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="success" size="sm" loading={acting} onClick={() => decide(true)}>{t('common.approve')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Reject */}
      <Modal open={action === 'reject' && !!selected} onClose={() => !acting && setAction(null)} title={t('scores.rejectScore')} width="min(420px,100%)">
        {selected && (
          <div className="space-y-4">
            <Textarea
              label={t('pldVal.rejectReason')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minRows={3}
              placeholder={t('pldVal.rejectPlaceholder')}
            />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setAction(null)} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="danger" size="sm" loading={acting} disabled={!reason.trim()} onClick={() => decide(false)}>{t('common.reject')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Proof (multi-photo) */}
      <Modal open={action === 'proof' && !!selected} onClose={() => setAction(null)} title={t('pldVal.proof')} width="min(760px,100%)">
        {proofUrls.length === 0 ? (
          <p className="text-sm text-text-faint text-center py-8">{t('common.loading')}</p>
        ) : (
          <div className="space-y-3">
            {proofUrls.map((u, i) => (
              <img key={i} src={u} alt={`Proof ${i + 1}`} className="w-full max-h-[60vh] object-contain rounded-[var(--r-md)]" />
            ))}
          </div>
        )}
      </Modal>
    </PageWrapper>
  )
}

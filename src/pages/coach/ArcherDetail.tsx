import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button,
  AccountStatusBadge,
  SubmissionStatusBadge,
  Avatar,
  StatCard,
  Modal,
  EmptyState,
  useToast,
  Badge,
  Input,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { writeAuditLog } from '@/services/auditLog'
import { fetchOrgMaps } from '@/services/orgLookup'
import { ScoreTrendChart, DistanceSeriesChart, type DistancePoint } from '@/components/charts/TrendChart'
import { SessionDetailContent } from '@/components/charts/SessionDetail'
import { computeGroupSpreadCm, type PlotData } from '@/utils/archery'
import { formatDate, timeAgo } from '@/utils/dates'
import { scoreDisplay, scorePct, trendLabel } from '@/utils/format'
import { cn } from '@/utils/cn'
import type { AccountStatus, Role, SubmissionStatus, TrainingLog } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface ArcherProfile {
  id: string
  name: string
  email: string
  archer_id?: string
  age?: number
  status: AccountStatus
  role: Role
  created_at: string
  school?: { id: string; name: string }
  pld?:   { id: string; name: string }
  state?: { id: string; name: string; code: string }
}

interface ScoreRow {
  id: string
  date: string
  total_score: number
  max_score: number
  bow_category?: string
  status: SubmissionStatus
  proof_url?: string
  notes?: string
  created_at: string
  round: { id: string; name: string; category: string } | null
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function computeStats(scores: ScoreRow[]) {
  if (scores.length === 0) return null
  const pcts    = scores.map(s => scorePct(s.total_score, s.max_score))
  const best    = Math.max(...pcts)
  const avg     = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
  const latest  = pcts[0] ?? 0

  // Improvement: compare first-3 avg vs last-3 avg (oldest→newest sorted)
  const sorted  = [...scores].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  const sPcts   = sorted.map(s => scorePct(s.total_score, s.max_score))
  const early   = sPcts.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, sPcts.length)
  const recent  = sPcts.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, sPcts.length)
  const improvement = Math.round(recent - early)

  return { best, avg, latest, improvement, total: scores.length }
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function CoachArcherDetail() {
  const { archerId }   = useParams<{ archerId: string }>()
  const { profile }    = useAuth()
  const { t }          = useLanguage()
  const navigate       = useNavigate()
  const queryClient    = useQueryClient()
  const { ok, err }    = useToast()
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const [unlinking, setUnlinking]   = useState(false)
  const [unlinkConfirm, setUnlinkConfirm] = useState('')
  const [plotSessionId, setPlotSessionId] = useState<string | null>(null)

  // ── Fetch archer + access check ──────────────────────────────────────────
  const { data: archer, isLoading, isError } = useQuery<ArcherProfile | null>({
    queryKey: ['coach-archer-detail', archerId, profile?.id],
    queryFn: async () => {
      if (!profile?.id || !archerId) throw new Error('Not authenticated')

      // Verify access: must have an active link (skip for super_admin)
      if (profile.role !== 'super_admin') {
        const { data: link } = await supabase
          .from('coach_archer_links')
          .select('id')
          .eq('coach_id', profile.id)
          .eq('archer_id', archerId)
          .eq('status', 'active')
          .maybeSingle()
        if (!link) throw new Error('Access denied or archer not linked.')
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, email, archer_id, age, status, role, created_at, school_id, pld_id, state_id')
        .eq('id', archerId)
        .single()
      if (error) throw error
      const maps = await fetchOrgMaps()
      const p = data as unknown as { school_id: string | null; pld_id: string | null; state_id: string | null } & Record<string, unknown>
      return {
        ...p,
        school: p.school_id ? maps.schools.get(p.school_id) ?? null : null,
        pld:    p.pld_id    ? maps.plds.get(p.pld_id)       ?? null : null,
        state:  p.state_id  ? maps.states.get(p.state_id)   ?? null : null,
      } as unknown as ArcherProfile
    },
    enabled: !!profile?.id && !!archerId,
    staleTime: 60_000,
  })

  // ── Fetch score submissions ───────────────────────────────────────────────
  const { data: scores = [] } = useQuery<ScoreRow[]>({
    queryKey: ['coach-archer-scores', archerId],
    queryFn: async () => {
      // No embedding — resolve rounds separately (embeds fail via the views).
      // select('*') so optional columns (session_time, plot_data) never 42703.
      const { data, error } = await supabase
        .from('score_submissions')
        .select('*')
        .eq('archer_id', archerId!)
        .order('date', { ascending: false })
        .limit(50)
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      if (!rows.length) return []
      const roundIds = [...new Set(rows.map((r) => r.round_id as string).filter(Boolean))]
      const { data: rounds } = roundIds.length
        ? await supabase.from('rounds').select('id, name, category, distance_m, arrows_per_end').in('id', roundIds)
        : { data: [] }
      const rmap = new Map(((rounds ?? []) as { id: string }[]).map((r) => [r.id, r]))
      return rows.map((r) => ({
        ...r,
        round: r.round_id ? rmap.get(r.round_id as string) ?? null : null,
      })) as unknown as ScoreRow[]
    },
    enabled: !!archerId && !!archer,
    staleTime: 30_000,
  })

  // ── Fetch training logs ───────────────────────────────────────────────────
  const { data: trainLogs = [] } = useQuery<TrainingLog[]>({
    queryKey: ['coach-archer-training', archerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_logs')
        .select('id, date, arrows_shot, session_type, notes, created_at')
        .eq('archer_id', archerId!)
        .order('date', { ascending: false })
        .limit(20)
      if (error) return []   // table might not exist yet
      return (data ?? []) as TrainingLog[]
    },
    enabled: !!archerId && !!archer,
    staleTime: 60_000,
  })

  // ── Unlink handler ────────────────────────────────────────────────────────
  async function handleUnlink() {
    if (!profile?.id || !archerId) return
    setUnlinking(true)
    try {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('coach_archer_links')
        .update({ status: 'inactive', unlinked_at: now })
        .eq('coach_id', profile.id)
        .eq('archer_id', archerId)

      if (error) throw error

      await supabase
        .from('profiles')
        .update({ coach_id: null })
        .eq('id', archerId)
        .eq('coach_id', profile.id)

      writeAuditLog(profile.id, 'coach.archer_unlinked', 'coach_archer_link', undefined, {
        archer_name: archer?.name, archer_profile_id: archerId,
      })

      ok(t('coachArchers.unlinkedToast', { name: archer?.name ?? t('roles.archer') }))
      queryClient.invalidateQueries({ queryKey: ['coach-archers-list'] })
      queryClient.invalidateQueries({ queryKey: ['coach-archers-counts'] })
      navigate('/coach/archers')
    } catch (e: unknown) {
      err((e as Error).message ?? t('common.actionFailed'))
    } finally {
      setUnlinking(false)
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = computeStats(scores)

  // ─── RENDER: loading / error / not found ─────────────────────────────────

  if (isLoading) {
    return (
      <PageWrapper>
        <div className="space-y-4">
          <div className="h-8 w-48 rounded bg-surface-raised animate-pulse" />
          <div className="h-24 rounded-[var(--r-lg)] bg-surface-raised animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            {[1,2,3].map(i => <div key={i} className="h-20 rounded-[var(--r-lg)] bg-surface-raised animate-pulse" />)}
          </div>
        </div>
      </PageWrapper>
    )
  }

  if (isError || !archer) {
    return (
      <PageWrapper>
        <Button variant="ghost" size="sm" onClick={() => navigate('/coach/archers')} className="mb-4">
          ← {t('archerDetail.backToArchers')}
        </Button>
        <div className="card p-8 text-center">
          <p className="text-danger font-semibold mb-2">{t('access.title')}</p>
          <p className="text-sm text-text-dim">
            {t('archerDetail.notLinked')}
          </p>
        </div>
      </PageWrapper>
    )
  }

  const trend = stats ? trendLabel(stats.improvement) : null

  // ─── RENDER: main ─────────────────────────────────────────────────────────

  return (
    <PageWrapper>
      {/* Back + actions */}
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate('/coach/archers')}>
          ← {t('archerDetail.backToArchers')}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate(`/coach/scores?archerId=${archerId}`)}>
            {t('scoreEntry.submitScore')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate(`/coach/achievements?archerId=${archerId}`)}>
            {t('achievements.title')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setUnlinkOpen(true)}>
            {t('coachArchers.unlink')}
          </Button>
        </div>
      </div>

      {/* Profile header */}
      <div className="card p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-6">
        <Avatar name={archer.name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-display font-semibold">{archer.name}</h2>
            <AccountStatusBadge status={archer.status} />
          </div>
          <p className="text-sm text-text-dim mt-0.5">{archer.archer_id ?? t('archerDetail.noArcherId')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dim mt-1">
            {archer.school && <span>{archer.school.name}</span>}
            {archer.pld    && <span>{archer.pld.name}</span>}
            {archer.state  && <span>{archer.state.name}</span>}
            {archer.age    && <span>{t('common.age')} {archer.age}</span>}
          </div>
        </div>
        <p className="text-xs text-text-faint whitespace-nowrap">
          {archer.email}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('archerDetail.bestPct')}    value={stats ? `${stats.best}%`    : '—'} accent={!!stats} />
        <StatCard label={t('archerDetail.latestPct')}  value={stats ? `${stats.latest}%`  : '—'} />
        <StatCard label={t('archerDetail.avgPct')}  value={stats ? `${stats.avg}%`    : '—'} />
        <StatCard label={t('archerDetail.totalScores')}    value={stats?.total ?? 0} />
        {stats && (
          <>
            <StatCard
              label={t('archerDetail.improvement')}
              value={trend?.label ?? '—'}
              sub={scores.length >= 6 ? t('archerDetail.first3vsLast3') : t('archerDetail.needMoreData')}
              className={cn(
                trend?.direction === 'up'   && 'border-success/40',
                trend?.direction === 'down' && 'border-danger/40',
              )}
            />
            <StatCard
              label={t('archerDetail.trainingSessions')}
              value={trainLogs.length}
              sub={trainLogs.length === 0 ? t('archerDetail.noneLogged') : undefined}
            />
          </>
        )}
        {scores.length > 0 && (
          <StatCard
            label={t('archerDetail.lastActivity')}
            value={timeAgo(scores[0].date)}
            className="col-span-2 sm:col-span-1"
          />
        )}
      </div>

      {/* Recent Scores */}
      <SectionCard
        title={`${t('archerDetail.recentScores')} (${scores.length})`}
        className="mb-5"
        action={
          <Button variant="ghost" size="sm" onClick={() => navigate(`/coach/scores?archerId=${archerId}`)}>
            {t('scoreEntry.submitScore')}
          </Button>
        }
      >
        {scores.length === 0 ? (
          <EmptyState title={t('archerDash.noScoresYet')} description={t('archerDetail.noScoresHint')} />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {[t('common.date'), t('common.round'), t('common.score'), '%', t('leaderboardPage.bow'), t('common.status'), t('common.notes')].map(h => (
                      <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint pb-2 pr-3 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {scores.slice(0, 20).map(s => (
                    <tr key={s.id} className="hover:bg-surface-raised/40">
                      <td className="py-2.5 pr-3 text-sm whitespace-nowrap">{formatDate(s.date)}</td>
                      <td className="py-2.5 pr-3 text-sm text-text-dim whitespace-nowrap">{s.round?.name ?? '—'}</td>
                      <td className="py-2.5 pr-3 font-semibold whitespace-nowrap">{scoreDisplay(s.total_score, s.max_score)}</td>
                      <td className="py-2.5 pr-3 text-sm whitespace-nowrap">
                        <span className={cn(
                          scorePct(s.total_score, s.max_score) >= 90 && 'text-success font-semibold',
                          scorePct(s.total_score, s.max_score) < 70  && 'text-text-dim',
                        )}>
                          {scorePct(s.total_score, s.max_score)}%
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-text-dim whitespace-nowrap">{s.bow_category ?? '—'}</td>
                      <td className="py-2.5 pr-3 whitespace-nowrap">
                        <SubmissionStatusBadge status={s.status} />
                      </td>
                      <td className="py-2.5 text-xs text-text-dim max-w-[140px] truncate">
                        {s.notes ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden space-y-2">
              {scores.slice(0, 10).map(s => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-[var(--r)] bg-surface-soft">
                  <div>
                    <p className="text-sm font-medium">{s.round?.name ?? t('common.unknown')}</p>
                    <p className="text-xs text-text-dim">{formatDate(s.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display font-semibold">{scoreDisplay(s.total_score, s.max_score)}</p>
                    <p className="text-xs text-text-dim">{scorePct(s.total_score, s.max_score)}%</p>
                    <SubmissionStatusBadge status={s.status} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </SectionCard>

      {/* Score Trend — same colored-dot session chart the archer sees */}
      {scores.length >= 2 && (
        <SectionCard title={t('archerDash.scoreTrend')} className="mb-5">
          {(() => {
            const sorted = [...scores]
              .sort((a, b) => (a.date + ((a as { session_time?: string }).session_time ?? ''))
                .localeCompare(b.date + ((b as { session_time?: string }).session_time ?? '')))
              .slice(-30)
            return (
              <ScoreTrendChart
                data={sorted.map((s) => ({
                  date: s.date,
                  time: (s as { session_time?: string }).session_time ?? null,
                  score: s.total_score,
                  maxScore: s.max_score,
                  status: s.status,
                  label: (s.round as { name?: string } | null)?.name,
                }))}
                onPointClick={(i) => setPlotSessionId(sorted[i]?.id ?? null)}
              />
            )
          })()}
          {trend && (
            <p className={cn(
              'text-sm font-semibold mt-2',
              trend.direction === 'up'     && 'text-success',
              trend.direction === 'down'   && 'text-danger',
              trend.direction === 'steady' && 'text-text-dim',
            )}>
              {trend.label} {t('archerDetail.overallImprovement')}
            </p>
          )}
        </SectionCard>
      )}

      {/* Score by distance — % of max, split per shooting distance */}
      {scores.length >= 2 && (
        <SectionCard title={t('archerDash.scoreByDistance')} className="mb-5">
          <DistanceSeriesChart
            points={scores.map((s) => ({
              id: s.id,
              date: s.date,
              time: (s as { session_time?: string }).session_time ?? null,
              value: scorePct(s.total_score, s.max_score),
              distance: (s.round as { distance_m?: number | null } | null)?.distance_m ?? null,
            }))}
            onPointClick={setPlotSessionId}
          />
          <p className="text-xs text-text-faint mt-2">{t('archerDetail.tapDotHint')}</p>
        </SectionCard>
      )}

      {/* Group spread — plotted sessions only */}
      {(() => {
        const spreadPoints: DistancePoint[] = scores.flatMap((s) => {
          const spread = computeGroupSpreadCm((s as { plot_data?: PlotData }).plot_data)
          if (spread == null) return []
          return [{
            id: s.id,
            date: s.date,
            time: (s as { session_time?: string }).session_time ?? null,
            value: spread,
            distance: (s.round as { distance_m?: number | null } | null)?.distance_m ?? null,
          }]
        })
        return spreadPoints.length > 1 ? (
          <SectionCard title={t('archerDash.spreadTrend')} className="mb-5">
            <DistanceSeriesChart
              points={spreadPoints}
              yUnit="cm"
              yDomain={['auto', 'auto']}
              betterNote={t('archerDash.spreadBetterNote')}
              onPointClick={setPlotSessionId}
            />
            <p className="text-xs text-text-dim mt-2">
              <strong className="text-warning">{t('archerDash.spreadWorse')}</strong>{' '}
              {t('archerDetail.spreadHint')}
            </p>
          </SectionCard>
        ) : null
      })()}

      {/* Session detail viewer — shared by all three charts */}
      {(() => {
        const plotSession = plotSessionId ? scores.find((s) => s.id === plotSessionId) : null
        return (
          <Modal
            open={!!plotSession}
            onClose={() => setPlotSessionId(null)}
            title={plotSession ? `${t('sessionDetail.session')} · ${formatDate(plotSession.date)}` : t('sessionDetail.session')}
            width="min(480px,100%)"
          >
            {plotSession && (
              <SessionDetailContent
                s={{
                  date: plotSession.date,
                  time: (plotSession as { session_time?: string }).session_time ?? null,
                  roundName: (plotSession.round as { name?: string } | null)?.name ?? null,
                  distanceM: (plotSession.round as { distance_m?: number | null } | null)?.distance_m ?? null,
                  totalScore: plotSession.total_score,
                  maxScore: plotSession.max_score,
                  status: plotSession.status,
                  notes: (plotSession as { notes?: string | null }).notes ?? null,
                  arrowsData: (plotSession as { arrows_data?: (string | number)[] | null }).arrows_data ?? null,
                  arrowsPerEnd: (plotSession.round as { arrows_per_end?: number | null } | null)?.arrows_per_end ?? null,
                  plot: (plotSession as { plot_data?: PlotData }).plot_data ?? null,
                }}
              />
            )}
          </Modal>
        )
      })()}

      {/* Training Logs */}
      <SectionCard title={`${t('archerDetail.trainingLogs')} (${trainLogs.length})`} className="mb-5">
        {trainLogs.length === 0 ? (
          <EmptyState title={t('archerDash.noTrainingYet')} description={t('archerDetail.noTrainingHint')} />
        ) : (
          <div className="space-y-2">
            {trainLogs.slice(0, 10).map(log => (
              <div key={log.id} className="flex items-center justify-between p-3 rounded-[var(--r)] bg-surface-soft">
                <div>
                  <p className="text-sm font-medium">{log.session_type ?? t('sessionDetail.session')}</p>
                  <p className="text-xs text-text-dim">{formatDate(log.date)}</p>
                  {log.notes && <p className="text-xs text-text-dim mt-0.5">{log.notes}</p>}
                </div>
                <div className="text-right">
                  <p className="font-display font-semibold text-lg">{log.arrows_shot}</p>
                  <p className="text-xs text-text-dim">{t('scoreEntry.arrows')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Archer Info */}
      <SectionCard title={t('archerDetail.archerInfo')}>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {([
            [t('crFields.fullName'),   archer.name],
            [t('common.email'),       archer.email],
            [t('excel.archerId'),   archer.archer_id ?? '—'],
            [t('common.age'),         archer.age ? String(archer.age) : '—'],
            [t('common.school'),      archer.school?.name ?? '—'],
            [t('common.pld'),         archer.pld?.name    ?? '—'],
            [t('common.state'),       archer.state?.name  ?? '—'],
            [t('archerDetail.accountCreated'), formatDate(archer.created_at)],
          ] as [string, string][]).map(([label, val]) => (
            <div key={label}>
              <dt className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint">{label}</dt>
              <dd className="text-sm text-text mt-0.5">{val}</dd>
            </div>
          ))}
        </dl>
      </SectionCard>

      {/* Unlink confirm modal */}
      <Modal open={unlinkOpen} onClose={() => !unlinking && setUnlinkOpen(false)} title={t('coachArchers.unlinkTitle')} width="min(400px,100%)">
        <p className="text-sm text-text-dim mb-4">
          {t('coachArchers.unlinkBody', { name: archer.name })}
        </p>
        <Input
          label={t('coachArchers.typeNameConfirm')}
          placeholder={archer.name}
          value={unlinkConfirm}
          onChange={(e) => setUnlinkConfirm(e.target.value)}
          hint={t('coachArchers.notCaseSensitive')}
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setUnlinkOpen(false)} disabled={unlinking}>{t('common.cancel')}</Button>
          <Button
            variant="danger"
            onClick={handleUnlink}
            disabled={
              unlinking ||
              unlinkConfirm.trim().replace(/\s+/g, ' ').toLowerCase() !==
                archer.name.trim().replace(/\s+/g, ' ').toLowerCase()
            }
          >
            {unlinking ? t('common.processing') : t('coachArchers.unlink')}
          </Button>
        </div>
      </Modal>
    </PageWrapper>
  )
}

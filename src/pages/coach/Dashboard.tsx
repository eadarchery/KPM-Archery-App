import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Button, Modal } from '@/components/ui'
import { PlusIcon, PeopleIcon, ClipboardIcon, TargetIcon } from '@/components/ui/icons'
import { SessionDetailContent } from '@/components/charts/SessionDetail'
import { EmptyState } from '@/components/ui/EmptyState'
import { AccountStatusBadge } from '@/components/ui/Badge'
import { Avatar } from '@/components/ui/Avatar'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { formatDate } from '@/utils/dates'
import { scoreDisplay } from '@/utils/format'
import { useNavigate } from 'react-router-dom'
import { MultiSeriesChart } from '@/components/charts/TrendChart'
import type { Profile, ScoreSubmission } from '@/types'

/** Tiny inline score trend (last sessions, % of max) for an archer row. */
function MiniSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const w = 88, h = 26, pad = 2
  const min = Math.min(...values), max = Math.max(...values)
  const span = Math.max(1, max - min)
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1)
    const y = h - pad - ((v - min) / span) * (h - pad * 2)
    return `${x},${y}`
  }).join(' ')
  const up = values[values.length - 1] >= values[0]
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? '#16a34a' : '#e11d48'} strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const NONE_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Attach round + archer objects to score submissions WITHOUT PostgREST embedding
 * — embedded joins through the security_invoker views fail (PGRST200) and return
 * nothing. Resolve the related rows in separate queries and stitch client-side.
 */
async function stitchSubmissions(subs: Record<string, unknown>[]): Promise<ScoreSubmission[]> {
  if (!subs.length) return []
  const roundIds  = [...new Set(subs.map((s) => s.round_id as string).filter(Boolean))]
  const archerIds = [...new Set(subs.map((s) => s.archer_id as string).filter(Boolean))]
  const [rRes, aRes] = await Promise.all([
    supabase.from('rounds').select('*').in('id', roundIds.length ? roundIds : [NONE_ID]),
    supabase.from('profiles')
      .select('id, name, archer_id, age, bow_category, status')
      .in('id', archerIds.length ? archerIds : [NONE_ID]),
  ])
  const rmap = new Map(((rRes.data ?? []) as { id: string }[]).map((r) => [r.id, r]))
  const amap = new Map(((aRes.data ?? []) as { id: string }[]).map((a) => [a.id, a]))
  return subs.map((s) => ({
    ...s,
    round:  s.round_id  ? rmap.get(s.round_id as string)  ?? null : null,
    archer: s.archer_id ? amap.get(s.archer_id as string) ?? null : null,
  })) as unknown as ScoreSubmission[]
}

export default function CoachDashboard() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const [detailSub, setDetailSub] = useState<ScoreSubmission | null>(null)

  const { data: linkedArchers = [] } = useQuery<Profile[]>({
    queryKey: ['coach-archers', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from('coach_archer_links')
        .select('archer_id')
        .eq('coach_id', profile!.id)
        .eq('status', 'active')
      if (error) throw error
      const ids = [...new Set((links ?? []).map((l: { archer_id: string }) => l.archer_id))]
      if (!ids.length) return []
      const { data: profs, error: e2 } = await supabase.from('profiles').select('*').in('id', ids)
      if (e2) throw e2
      return (profs ?? []) as Profile[]
    },
  })

  const { data: pendingValidations = [] } = useQuery<ScoreSubmission[]>({
    queryKey: ['coach-pending-validations', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_submissions')
        .select('*')
        .eq('coach_id', profile!.id)
        .eq('status', 'pending')
        .order('date', { ascending: false })
        .limit(10)
      if (error) throw error
      return stitchSubmissions((data ?? []) as Record<string, unknown>[])
    },
  })

  // All linked archers' sessions (last 90 days) — feeds the school trend,
  // the school-average card and the per-archer sparklines. Distance comes from
  // the round (resolved separately — no embeds).
  const { data: schoolSubs = [] } = useQuery<{ archer_id: string; date: string; total_score: number; max_score: number; distance: number | null }[]>({
    queryKey: ['coach-school-submissions', profile?.id, linkedArchers.length],
    enabled: !!profile?.id && linkedArchers.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const archerIds = linkedArchers.map((a) => a.id)
      const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('score_submissions')
        .select('archer_id, round_id, date, total_score, max_score')
        .in('archer_id', archerIds)
        .gte('date', cutoff)
        .order('date', { ascending: true })
        .limit(500)
      if (error) throw error
      const rows = (data ?? []) as { archer_id: string; round_id: string | null; date: string; total_score: number; max_score: number }[]
      const roundIds = [...new Set(rows.map((r) => r.round_id).filter(Boolean))] as string[]
      const { data: rounds } = roundIds.length
        ? await supabase.from('rounds').select('id, distance_m').in('id', roundIds)
        : { data: [] }
      const dist = new Map(((rounds ?? []) as { id: string; distance_m: number | null }[]).map((r) => [r.id, r.distance_m]))
      return rows.map((r) => ({
        archer_id: r.archer_id, date: r.date,
        total_score: r.total_score, max_score: r.max_score,
        distance: r.round_id ? dist.get(r.round_id) ?? null : null,
      }))
    },
  })

  // New active links in the last 30 days (student-count trend).
  const { data: linkDates = [] } = useQuery<string[]>({
    queryKey: ['coach-link-dates', profile?.id],
    enabled: !!profile?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coach_archer_links')
        .select('linked_at')
        .eq('coach_id', profile!.id)
        .eq('status', 'active')
      if (error) throw error
      return ((data ?? []) as { linked_at: string | null }[]).map((l) => l.linked_at ?? '')
    },
  })

  // ── Derived school analytics ────────────────────────────────────────────
  const pct = (s: { total_score: number; max_score: number }) =>
    s.max_score ? (s.total_score / s.max_score) * 100 : 0

  // Weekly school average per DISTANCE for the big trend chart — one coloured
  // line per shooting distance, all normalised to % of round max.
  const { schoolTrend, trendSeries } = (() => {
    // week key → distance key → values
    const weeks = new Map<string, Map<string, number[]>>()
    const distances = new Set<string>()
    for (const s of schoolSubs) {
      const d = new Date(s.date + 'T12:00:00')
      const monday = new Date(d)
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
      const week = monday.toISOString().slice(0, 10)
      const dk = s.distance != null ? `d${s.distance}` : 'dna'
      distances.add(dk)
      const wm = weeks.get(week) ?? new Map<string, number[]>()
      const arr = wm.get(dk) ?? []
      arr.push(pct(s))
      wm.set(dk, arr)
      weeks.set(week, wm)
    }
    const COLORS = ['#ff6a18', '#3d8bff', '#16a34a', '#a855f7', '#e11d48', '#0891b2']
    const distKeys = [...distances].sort((a, b) =>
      (a === 'dna' ? 1e9 : Number(a.slice(1))) - (b === 'dna' ? 1e9 : Number(b.slice(1))))
    const rows = [...weeks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, wm]) => {
        const row: { date: string; [k: string]: string | number } = { date }
        for (const [dk, vals] of wm) {
          row[dk] = Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 10) / 10
        }
        return row
      })
    return {
      schoolTrend: rows,
      trendSeries: distKeys.map((dk, i) => ({
        key: dk,
        label: dk === 'dna' ? t('charts.noDistance') : `${dk.slice(1)}m`,
        color: COLORS[i % COLORS.length],
      })),
    }
  })()

  // 30-day school average + delta vs the previous 30 days.
  const day30 = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)
  const day60 = new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10)
  const avgOf = (rows: typeof schoolSubs) =>
    rows.length ? Math.round((rows.reduce((s, r) => s + pct(r), 0) / rows.length) * 10) / 10 : null
  const avg30 = avgOf(schoolSubs.filter((s) => s.date >= day30))
  const avgPrev30 = avgOf(schoolSubs.filter((s) => s.date >= day60 && s.date < day30))
  const avgDelta = avg30 != null && avgPrev30 != null ? Math.round((avg30 - avgPrev30) * 10) / 10 : null

  const newLinks30 = linkDates.filter((d) => d && d.slice(0, 10) >= day30).length

  // Visual-only spark data for the school-average card (schoolSubs is already
  // date-ascending, but keep the sort defensive).
  const schoolAverageMiniData = [...schoolSubs]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-12)
    .map((s) => Math.round(pct(s)))

  // Per-archer sparkline values (chronological pct, last 8 sessions).
  const sparkByArcher = (() => {
    const m = new Map<string, number[]>()
    for (const s of schoolSubs) {
      const arr = m.get(s.archer_id) ?? []
      arr.push(Math.round(pct(s)))
      m.set(s.archer_id, arr)
    }
    for (const [k, v] of m) m.set(k, v.slice(-8))
    return m
  })()

  return (
    <PageWrapper>
      <PageHead
        title={t('coachDash.title')}
        description={t('coachDash.description')}
        action={
          <Button variant="primary" onClick={() => navigate('/coach/scores')}>
            <PlusIcon /> {t('scoreEntry.submitScore')}
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label={t('coachDash.linkedArchers')}
          value={linkedArchers.length}
          clickable
          onClick={() => navigate('/coach/archers')}
          tone="primary"
          description={t('coachDash.activeArchers')}
          icon={<PeopleIcon />}
        />
        <StatCard
          label={t('coachDash.pendingValidation')}
          value={pendingValidations.length}
          sub={pendingValidations.length > 0 ? t('coachDash.requiresReview') : t('coachDash.allClear')}
          badge={pendingValidations.length}
          clickable
          onClick={() => navigate('/coach/scores')}
          tone={pendingValidations.length > 0 ? 'danger' : 'success'}
          trend={pendingValidations.length > 0 ? 'up' : 'flat'}
          icon={<ClipboardIcon />}
        />
        <StatCard
          label={t('coachDash.activeArchers')}
          value={linkedArchers.filter((a) => a.status === 'approved').length}
          sub={newLinks30 > 0 ? t('coachDash.newLinks30', { count: newLinks30 }) : t('coachDash.noNewLinks30')}
          clickable
          onClick={() => navigate('/coach/archers')}
          tone="success"
          trend={newLinks30 > 0 ? 'up' : 'flat'}
          trendLabel={newLinks30 > 0 ? `+${newLinks30}` : undefined}
          icon={<CheckIcon />}
        />
        <StatCard
          label={t('coachDash.schoolAverage')}
          value={avg30 != null ? `${avg30}%` : '—'}
          sub={
            avgDelta != null
              ? `${avgDelta > 0 ? '▲ +' : avgDelta < 0 ? '▼ ' : '▬ '}${avgDelta}% ${t('coachDash.vsPrev30')}`
              : t('coachDash.last30')
          }
          tone={avgDelta != null && avgDelta > 0 ? 'success' : avgDelta != null && avgDelta < 0 ? 'danger' : 'neutral'}
          trend={avgDelta != null && avgDelta > 0 ? 'up' : avgDelta != null && avgDelta < 0 ? 'down' : 'flat'}
          trendLabel={t('coachDash.last30')}
          progressPct={avg30}
          miniChartData={schoolAverageMiniData}
          icon={<TargetIcon />}
        />
      </div>

      {/* Quick links to the coach's own tools */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        {[
          { label: t('myPerf.title'), desc: t('coachDash.myPerfDesc'), path: '/coach/performance' },
          { label: t('coachBoard.title'), desc: t('coachDash.coachBoardDesc'), path: '/coach/leaderboard' },
          { label: t('coachDash.archersBoard'), desc: t('coachDash.archersBoardDesc'), path: '/coach/archer-leaderboard' },
          ...((profile as { is_pld_coach?: boolean } | null)?.is_pld_coach
            ? [{ label: t('pldVal.title'), desc: t('coachDash.pldValDesc'), path: '/coach/pld-validation' }]
            : []),
        ].map((c) => (
          <button
            key={c.path}
            onClick={() => navigate(c.path)}
            className="text-left p-3.5 rounded-[var(--r-md)] border border-line bg-surface hover:border-primary hover:bg-surface-soft hover:-translate-y-0.5 hover:shadow-card transition-all"
          >
            <p className="font-display font-semibold text-sm text-text">{c.label}</p>
            <p className="text-[11px] text-text-dim mt-0.5">{c.desc}</p>
          </button>
        ))}
      </div>

      {/* School performance trend — weekly average of ALL linked archers */}
      {schoolTrend.length > 1 && (
        <SectionCard title={t('coachDash.schoolTrend')} className="mb-4">
          <MultiSeriesChart
            data={schoolTrend}
            series={trendSeries}
            yLabel="%"
          />
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
            {trendSeries.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-text-dim">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
            ))}
          </div>
          <p className="text-xs text-text-faint mt-1.5">
            {t('coachDash.schoolTrendHint')}
          </p>
        </SectionCard>
      )}

      {/* Pending validations */}
      {pendingValidations.length > 0 && (
        <SectionCard
          title={`${t('coachDash.pendingValidation')} (${pendingValidations.length})`}
          action={<Button variant="ghost" size="sm" onClick={() => navigate('/coach/scores')}>{t('common.viewAll')}</Button>}
          className="mb-4"
        >
          <div className="space-y-2">
            {pendingValidations.slice(0, 3).map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-3 rounded-[var(--r)] bg-surface-soft cursor-pointer hover:bg-surface-raised transition-colors"
                onClick={() => setDetailSub(s)}
              >
                <div>
                  <div className="font-semibold text-sm">{(s.archer as any)?.name ?? t('common.unknown')}</div>
                  <div className="text-xs text-text-dim">{(s.round as any)?.name ?? t('common.round')} · {formatDate(s.date)}</div>
                </div>
                <div className="text-right">
                  <div className="font-display font-semibold text-lg">{scoreDisplay(s.total_score, s.max_score)}</div>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* Linked archers list */}
      <SectionCard
        title={t('coachDash.linkedArchers')}
        action={<Button variant="ghost" size="sm" onClick={() => navigate('/coach/archers')}>{t('common.viewAll')}</Button>}
      >
        {linkedArchers.length ? (
          <div className="space-y-2">
            {linkedArchers.slice(0, 6).map((archer) => (
              <div
                key={archer.id}
                className="flex items-center gap-3 p-2.5 rounded-[var(--r)] hover:bg-surface-soft cursor-pointer transition-colors"
                onClick={() => navigate(`/coach/archers/${archer.id}`)}
              >
                <Avatar name={archer.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-sm text-text truncate">{archer.name}</div>
                  <div className="text-xs text-text-faint truncate">{archer.archer_id}</div>
                </div>
                <MiniSparkline values={sparkByArcher.get(archer.id) ?? []} />
                <AccountStatusBadge status={archer.status} />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={t('coachDash.noLinkedYet')}
            description={t('coachDash.noLinkedYetHint')}
          />
        )}
      </SectionCard>

      {/* Session detail popup (pending-validation rows) */}
      <Modal
        open={!!detailSub}
        onClose={() => setDetailSub(null)}
        title={detailSub ? `${t('sessionDetail.session')} · ${formatDate(detailSub.date)}` : t('sessionDetail.session')}
        width="min(480px,100%)"
      >
        {detailSub && (
          <SessionDetailContent
            s={{
              date: detailSub.date,
              time: (detailSub as { session_time?: string }).session_time ?? null,
              roundName: (detailSub.round as { name?: string } | null)?.name ?? null,
              distanceM: (detailSub.round as { distance_m?: number | null } | null)?.distance_m ?? null,
              totalScore: detailSub.total_score,
              maxScore: detailSub.max_score,
              status: detailSub.status,
              notes: (detailSub as { notes?: string | null }).notes ?? null,
              arrowsData: (detailSub as { arrows_data?: (string | number)[] | null }).arrows_data ?? null,
              arrowsPerEnd: (detailSub.round as { arrows_per_end?: number | null } | null)?.arrows_per_end ?? null,
              plot: (detailSub as { plot_data?: import('@/utils/archery').PlotData }).plot_data ?? null,
            }}
          />
        )}
      </Modal>
    </PageWrapper>
  )
}

function CheckIcon() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }

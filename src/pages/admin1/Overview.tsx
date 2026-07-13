import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { PeopleIcon, ClipboardIcon, TargetIcon, ArrowIcon } from '@/components/ui/icons'
import { Badge, EmptyState, Modal, Input } from '@/components/ui'
import { MultiSeriesChart, ScoreTrendChart } from '@/components/charts/TrendChart'
import { supabase } from '@/services/supabase'
import { useLanguage } from '@/contexts/LanguageContext'
import { compact, scorePct } from '@/utils/format'
import { daysAgo, formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'

/**
 * Admin 1 — National Overview.
 * Everything is computed from Admin-1-readable sources (profiles read-all,
 * score submissions read-all, training logs via migration 051, and the
 * report_* views from migration 025). Every card and table row drills down:
 * card → full list → entity popup → archer popup.
 */

// ─── RANGE ────────────────────────────────────────────────────────────────────

type RangeKey = '30d' | '90d' | '6m' | '1y'
const RANGES: { key: RangeKey; labelKey: string; days: number }[] = [
  { key: '30d', labelKey: 'overview.range30d', days: 30 },
  { key: '90d', labelKey: 'overview.range90d', days: 90 },
  { key: '6m',  labelKey: 'overview.range6m', days: 182 },
  { key: '1y',  labelKey: 'overview.range1y', days: 365 },
]

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface ArcherProfile {
  id: string
  name: string
  archer_id: string | null
  age: number | null
  status: string
  coach_id: string | null
  state_id: string | null
  pld_id: string | null
  school_id: string | null
  created_at: string
  bow_category: string | null
}

interface Sub {
  archer_id: string
  date: string
  total_score: number
  max_score: number
  status: string
  bow_category: string | null
}

interface TrainRow { archer_id: string; date: string; arrows_shot: number }

interface StateRow  { state_id: string; state: string; state_code: string; registered_archers: number; active_archers: number; coaches: number; schools_total: number }
interface PldRow    { pld_id: string; pld: string; state: string; state_code: string; registered_archers: number; active_archers: number; coaches: number; schools_total: number }
interface SchoolRow { school_id: string; school: string; pld: string | null; state: string; state_code: string; registered_archers: number; active_archers: number; coaches: number }

type EntityKind = 'state' | 'pld' | 'school'
interface EntityRef { kind: EntityKind; id: string; name: string; sub?: string }

/** Aggregates for one entity within a period. */
interface Agg { sessions: number; pctSum: number; pctN: number }

// ─── SMALL HELPERS ────────────────────────────────────────────────────────────

const avg = (a: Agg) => (a.pctN ? a.pctSum / a.pctN : null)

type Translate = (key: string, vars?: Record<string, string | number>) => string

function trendOf(t: Translate, cur: number | null, prev: number | null): { delta: number | null; label: string; cls: string; icon: string } {
  if (cur == null || prev == null) return { delta: null, label: t('overview.noComparison'), cls: 'text-text-faint', icon: '▬' }
  const delta = Math.round((cur - prev) * 10) / 10
  if (Math.abs(delta) < 3) return { delta, label: t('overview.steady'), cls: 'text-text-dim', icon: '▬' }
  if (delta > 0) return { delta, label: t('overview.increasing'), cls: 'text-success', icon: '▲' }
  return { delta, label: t('overview.decreasing'), cls: 'text-danger', icon: '▼' }
}

function countTrend(t: Translate, cur: number, prev: number): { label: string; cls: string; icon: string; pct: number | null } {
  if (!prev) return { label: cur ? t('overview.newActivity') : t('overview.noActivity'), cls: 'text-text-faint', icon: '▬', pct: null }
  const pct = Math.round(((cur - prev) / prev) * 1000) / 10
  if (Math.abs(pct) < 5) return { label: `${t('overview.steady')} (${pct > 0 ? '+' : ''}${pct}%)`, cls: 'text-text-dim', icon: '▬', pct }
  if (pct > 0) return { label: `${t('overview.increasing')} +${pct}%`, cls: 'text-success', icon: '▲', pct }
  return { label: `${t('overview.decreasing')} ${pct}%`, cls: 'text-danger', icon: '▼', pct }
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function Admin1Overview() {
  const { t } = useLanguage()
  const [range, setRange] = useState<RangeKey>('90d')
  const days = RANGES.find(r => r.key === range)!.days
  const startCur  = daysAgo(days)
  const startPrev = daysAgo(days * 2)

  const [entity, setEntity] = useState<EntityRef | null>(null)
  const [archerId, setArcherId] = useState<string | null>(null)
  const [cardList, setCardList] = useState<'students' | 'active' | 'sessions' | 'arrows' | null>(null)

  // ── Base data ──────────────────────────────────────────────────────────────
  const { data: archers = [] } = useQuery<ArcherProfile[]>({
    queryKey: ['nat-archers'],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, archer_id, age, status, coach_id, state_id, pld_id, school_id, created_at, bow_category')
        .eq('role', 'archer')
        .limit(5000)
      if (error) throw error
      return (data ?? []) as ArcherProfile[]
    },
  })

  const { data: subs = [] } = useQuery<Sub[]>({
    queryKey: ['nat-subs', range],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_submissions')
        .select('archer_id, date, total_score, max_score, status, bow_category')
        .gte('date', startPrev)
        .order('date', { ascending: true })
        .limit(10000)
      if (error) throw error
      return (data ?? []) as Sub[]
    },
  })

  const { data: training = [] } = useQuery<TrainRow[]>({
    queryKey: ['nat-training', range],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('training_logs')
        .select('archer_id, date, arrows_shot')
        .gte('date', startPrev)
        .limit(10000)
      if (error) return [] // policy may not be applied yet (migration 051)
      return (data ?? []) as TrainRow[]
    },
  })

  // Server-side weekly trend (migration 054). Falls back to the client
  // computation below when the function isn't deployed yet.
  const { data: rpcTrend = null } = useQuery<{ date: string; all?: number; linked?: number; unlinked?: number }[] | null>({
    queryKey: ['overview-weekly-trend', days],
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('overview_weekly_trend', { p_days: days })
      if (error) return null
      const rows = (data ?? []) as { week: string; all_avg: number | null; linked_avg: number | null; unlinked_avg: number | null }[]
      if (!rows.length) return null
      return rows.map(r => {
        const o: { date: string; all?: number; linked?: number; unlinked?: number } = { date: r.week }
        if (r.all_avg != null) o.all = Number(r.all_avg)
        if (r.linked_avg != null) o.linked = Number(r.linked_avg)
        if (r.unlinked_avg != null) o.unlinked = Number(r.unlinked_avg)
        return o
      })
    },
  })

  const { data: stateRows = [] } = useQuery<StateRow[]>({
    queryKey: ['report-states'],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('report_state_activity').select('*')
      if (error) throw error
      return (data ?? []) as StateRow[]
    },
  })
  const { data: pldRows = [] } = useQuery<PldRow[]>({
    queryKey: ['report-plds'],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('report_pld_activity').select('*')
      if (error) throw error
      return (data ?? []) as PldRow[]
    },
  })
  const { data: schoolRows = [] } = useQuery<SchoolRow[]>({
    queryKey: ['report-schools'],
    staleTime: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('report_school_activity').select('*')
      if (error) throw error
      return (data ?? []) as SchoolRow[]
    },
  })

  // ── Derived ────────────────────────────────────────────────────────────────
  const archerById = useMemo(() => new Map(archers.map(a => [a.id, a])), [archers])

  const derived = useMemo(() => {
    const approved = subs.filter(s => s.status === 'admin_approved')
    const inCur  = (d: string) => d >= startCur
    const curAll  = subs.filter(s => inCur(s.date))
    const prevAll = subs.filter(s => !inCur(s.date))
    const curApp  = approved.filter(s => inCur(s.date))
    const prevApp = approved.filter(s => !inCur(s.date))

    // Entity aggregates (approved scores → averages; all subs → sessions)
    const mk = () => ({ cur: new Map<string, Agg>(), prev: new Map<string, Agg>() })
    const byState = mk(), byPld = mk(), bySchool = mk()
    const bump = (m: Map<string, Agg>, key: string | null, pct: number | null) => {
      if (!key) return
      const a = m.get(key) ?? { sessions: 0, pctSum: 0, pctN: 0 }
      a.sessions++
      if (pct != null) { a.pctSum += pct; a.pctN++ }
      m.set(key, a)
    }
    for (const s of subs) {
      const p = archerById.get(s.archer_id)
      if (!p) continue
      const pct = s.status === 'admin_approved' && s.max_score ? (s.total_score / s.max_score) * 100 : null
      const side = inCur(s.date) ? 'cur' : 'prev'
      bump(byState[side], p.state_id, pct)
      bump(byPld[side], p.pld_id, pct)
      bump(bySchool[side], p.school_id, pct)
    }

    // National weekly trend (approved, % of max), split linked/unlinked
    const weeks = new Map<string, { all: number[]; linked: number[]; unlinked: number[] }>()
    for (const s of curApp) {
      const d = new Date(s.date + 'T12:00:00')
      const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7))
      const wk = monday.toISOString().slice(0, 10)
      const bucket = weeks.get(wk) ?? { all: [], linked: [], unlinked: [] }
      const pct = s.max_score ? (s.total_score / s.max_score) * 100 : 0
      bucket.all.push(pct)
      const p = archerById.get(s.archer_id)
      if (p?.coach_id) bucket.linked.push(pct); else bucket.unlinked.push(pct)
      weeks.set(wk, bucket)
    }
    const mean = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : undefined)
    const nationalTrend = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, all: mean(v.all), linked: mean(v.linked), unlinked: mean(v.unlinked) }))
      .map(r => Object.fromEntries(Object.entries(r).filter(([, val]) => val !== undefined))) as { date: string; [k: string]: string | number }[]

    // Linked vs unlinked averages (current range)
    const lu = { linked: [] as number[], unlinked: [] as number[] }
    for (const s of curApp) {
      const p = archerById.get(s.archer_id)
      if (!p || !s.max_score) continue
      lu[p.coach_id ? 'linked' : 'unlinked'].push((s.total_score / s.max_score) * 100)
    }

    // Per-archer improvement inside the current range (min 4 approved sessions)
    const perArcher = new Map<string, number[]>()
    for (const s of curApp) {
      if (!s.max_score) continue
      const arr = perArcher.get(s.archer_id) ?? []
      arr.push((s.total_score / s.max_score) * 100)
      perArcher.set(s.archer_id, arr)
    }
    const improvements: { archer: ArcherProfile; sessions: number; avgPct: number; delta: number }[] = []
    for (const [id, vals] of perArcher) {
      if (vals.length < 4) continue
      const p = archerById.get(id)
      if (!p) continue
      const half = Math.floor(vals.length / 2)
      const m1 = vals.slice(0, half).reduce((a, b) => a + b, 0) / half
      const m2 = vals.slice(-half).reduce((a, b) => a + b, 0) / half
      improvements.push({
        archer: p,
        sessions: vals.length,
        avgPct: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
        delta: Math.round((m2 - m1) * 10) / 10,
      })
    }
    improvements.sort((a, b) => b.delta - a.delta)

    // Emerging entities = average improvement of their improving archers (≥2 archers)
    const groupEmerging = (key: 'state_id' | 'pld_id') => {
      const g = new Map<string, { sum: number; n: number }>()
      for (const t of improvements) {
        const k = t.archer[key]
        if (!k) continue
        const e = g.get(k) ?? { sum: 0, n: 0 }
        e.sum += t.delta; e.n++
        g.set(k, e)
      }
      return [...g.entries()]
        .filter(([, e]) => e.n >= 2)
        .map(([id, e]) => ({ id, avgDelta: Math.round((e.sum / e.n) * 10) / 10, talents: e.n }))
        .sort((a, b) => b.avgDelta - a.avgDelta)
        .slice(0, 5)
    }

    // Card metrics
    const newStudents = archers.filter(a => a.created_at.slice(0, 10) >= startCur).length
    const activeCur  = new Set(curApp.map(s => s.archer_id)).size
    const activePrev = new Set(prevApp.map(s => s.archer_id)).size
    const arrowsCur  = training.filter(t => inCur(t.date)).reduce((s, t) => s + t.arrows_shot, 0)
    const arrowsPrev = training.filter(t => !inCur(t.date)).reduce((s, t) => s + t.arrows_shot, 0)
    const arrowsByState = new Map<string, number>()
    for (const t of training.filter(t => inCur(t.date))) {
      const p = archerById.get(t.archer_id)
      if (p?.state_id) arrowsByState.set(p.state_id, (arrowsByState.get(p.state_id) ?? 0) + t.arrows_shot)
    }
    const activeByState = new Map<string, Set<string>>()
    for (const s of curApp) {
      const p = archerById.get(s.archer_id)
      if (p?.state_id) {
        const set = activeByState.get(p.state_id) ?? new Set<string>()
        set.add(s.archer_id)
        activeByState.set(p.state_id, set)
      }
    }

    return {
      byState, byPld, bySchool, nationalTrend, lu, improvements,
      emergingPlds: groupEmerging('pld_id'), emergingStates: groupEmerging('state_id'),
      sessionsCur: curAll.length, sessionsPrev: prevAll.length,
      newStudents, activeCur, activePrev, arrowsCur, arrowsPrev,
      arrowsByState, activeByState,
      curApp,
    }
  }, [subs, training, archers, archerById, startCur])

  const luAvg = (v: number[]) => (v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null)
  const linkedAvg = luAvg(derived.lu.linked)
  const unlinkedAvg = luAvg(derived.lu.unlinked)

  const sessionsTrend = countTrend(t, derived.sessionsCur, derived.sessionsPrev)
  const activeTrend   = countTrend(t, derived.activeCur, derived.activePrev)
  const arrowsTrend   = countTrend(t, derived.arrowsCur, derived.arrowsPrev)

  // Entity trend-table rows
  function entityRows(kind: EntityKind) {
    const src = kind === 'state' ? derived.byState : kind === 'pld' ? derived.byPld : derived.bySchool
    const base: { id: string; name: string; sub: string; registered: number }[] =
      kind === 'state'
        ? stateRows.map(s => ({ id: s.state_id, name: s.state, sub: s.state_code, registered: s.registered_archers }))
        : kind === 'pld'
          ? pldRows.map(p => ({ id: p.pld_id, name: p.pld, sub: p.state_code, registered: p.registered_archers }))
          : schoolRows.map(s => ({ id: s.school_id, name: s.school, sub: [s.pld, s.state_code].filter(Boolean).join(' · '), registered: s.registered_archers }))
    return base.map(b => {
      const cur = src.cur.get(b.id)
      const prev = src.prev.get(b.id)
      const curAvg = cur ? avg(cur) : null
      const prevAvg = prev ? avg(prev) : null
      const trend = trendOf(t, curAvg, prevAvg)
      return {
        ...b,
        sessions: cur?.sessions ?? 0,
        avgPct: curAvg != null ? Math.round(curAvg * 10) / 10 : null,
        trend,
      }
    }).sort((a, b) => b.sessions - a.sessions)
  }

  const stateTable  = useMemo(entityRows.bind(null, 'state'),  [derived, stateRows])   // eslint-disable-line react-hooks/exhaustive-deps
  const pldTable    = useMemo(entityRows.bind(null, 'pld'),    [derived, pldRows])     // eslint-disable-line react-hooks/exhaustive-deps
  const schoolTable = useMemo(entityRows.bind(null, 'school'), [derived, schoolRows])  // eslint-disable-line react-hooks/exhaustive-deps

  const openEntity = (kind: EntityKind, id: string, name: string, sub?: string) =>
    setEntity({ kind, id, name, sub })

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <PageWrapper>
      <PageHead
        title={t('overview.title')}
        description={t('overview.description')}
        action={
          <div className="flex gap-1 bg-section rounded-[11px] p-1">
            {RANGES.map(r => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={cn('px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors',
                  range === r.key ? 'bg-surface text-text shadow-sm' : 'text-text-dim hover:text-text')}>
                {t(r.labelKey)}
              </button>
            ))}
          </div>
        }
      />

      {/* ── STAT CARDS (click → full state list) ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('overview.totalStudents')} value={compact(archers.length)}
          sub={t('overview.registeredInRange', { count: derived.newStudents })}
          tone="primary"
          trend={derived.newStudents > 0 ? 'up' : 'flat'}
          trendLabel={derived.newStudents > 0 ? `+${derived.newStudents}` : undefined}
          clickable onClick={() => setCardList('students')} icon={<PeopleIcon />} />
        <StatCard label={t('coachDash.activeArchers')} value={compact(derived.activeCur)}
          sub={<span className={activeTrend.cls}>{activeTrend.label}</span>}
          tone={activeTrend.icon === '▲' ? 'success' : activeTrend.icon === '▼' ? 'danger' : 'neutral'}
          trend={activeTrend.icon === '▲' ? 'up' : activeTrend.icon === '▼' ? 'down' : 'flat'}
          trendLabel={activeTrend.pct != null ? `${activeTrend.pct > 0 ? '+' : ''}${activeTrend.pct}%` : undefined}
          clickable onClick={() => setCardList('active')} icon={<TargetIcon />} />
        <StatCard label={t('common.sessions')} value={compact(derived.sessionsCur)}
          sub={<span className={sessionsTrend.cls}>{sessionsTrend.label}</span>}
          tone={sessionsTrend.icon === '▲' ? 'success' : sessionsTrend.icon === '▼' ? 'danger' : 'neutral'}
          trend={sessionsTrend.icon === '▲' ? 'up' : sessionsTrend.icon === '▼' ? 'down' : 'flat'}
          trendLabel={sessionsTrend.pct != null ? `${sessionsTrend.pct > 0 ? '+' : ''}${sessionsTrend.pct}%` : undefined}
          clickable onClick={() => setCardList('sessions')} icon={<ClipboardIcon />} />
        <StatCard label={t('overview.arrowsTraining')} value={compact(derived.arrowsCur)}
          sub={<span className={arrowsTrend.cls}>{arrowsTrend.label}</span>}
          tone={arrowsTrend.icon === '▲' ? 'success' : arrowsTrend.icon === '▼' ? 'danger' : 'neutral'}
          trend={arrowsTrend.icon === '▲' ? 'up' : arrowsTrend.icon === '▼' ? 'down' : 'flat'}
          trendLabel={arrowsTrend.pct != null ? `${arrowsTrend.pct > 0 ? '+' : ''}${arrowsTrend.pct}%` : undefined}
          clickable onClick={() => setCardList('arrows')} icon={<ArrowIcon />} />
      </div>

      {/* ── NATIONAL SCORING TREND (server-aggregated when available) ── */}
      <SectionCard title={t('overview.nationalTrend')} className="mb-4">
        {(rpcTrend ?? derived.nationalTrend).length > 1 ? (
          <>
            <MultiSeriesChart
              data={rpcTrend ?? derived.nationalTrend}
              series={[
                { key: 'all',      label: t('overview.nationalAvgPct'), color: '#ff6a18' },
                { key: 'linked',   label: t('overview.coached'),        color: '#16a34a' },
                { key: 'unlinked', label: t('overview.uncoached'),      color: '#8a8378' },
              ]}
              yLabel="%"
            />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] text-text-dim">
              <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5" style={{ background: '#ff6a18' }} />{t('overview.nationalAverage')}</span>
              <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5" style={{ background: '#16a34a' }} />{t('overview.coachedLinked')}</span>
              <span><span className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1.5" style={{ background: '#8a8378' }} />{t('overview.uncoachedArchers')}</span>
              <span className="ml-auto">
                {t('overview.rangeAvgCoached')}: <strong className="text-text">{linkedAvg ?? '—'}%</strong> ·
                {' '}{t('overview.uncoachedLower')}: <strong className="text-text">{unlinkedAvg ?? '—'}%</strong>
              </span>
            </div>
          </>
        ) : (
          <EmptyState title={t('overview.notEnoughScores')} description={t('overview.notEnoughScoresHint')} />
        )}
      </SectionCard>

      {/* ── ACTIVE BY STATE + TOP PLDs ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <SectionCard title={t('overview.activeByState')}>
          {stateTable.length ? (
            <div className="space-y-1.5 max-h-[340px] overflow-y-auto pr-1">
              {[...stateTable]
                .sort((a, b) => (derived.activeByState.get(b.id)?.size ?? 0) - (derived.activeByState.get(a.id)?.size ?? 0))
                .map(s => {
                const active = derived.activeByState.get(s.id)?.size ?? 0
                const max = Math.max(1, ...stateTable.map(x => derived.activeByState.get(x.id)?.size ?? 0))
                return (
                  <button key={s.id} onClick={() => openEntity('state', s.id, s.name, s.sub)}
                    className="w-full flex items-center gap-3 text-left hover:bg-surface-soft rounded-[8px] px-2 py-1.5 transition-colors">
                    <span className="text-xs font-semibold text-text w-28 truncate">{s.name}</span>
                    <span className="flex-1 h-2.5 bg-section rounded-full overflow-hidden">
                      <span className="block h-full rounded-full" style={{ width: `${(active / max) * 100}%`, background: 'var(--primary)' }} />
                    </span>
                    <span className="text-xs font-bold text-text w-10 text-right tabular-nums">{active}</span>
                  </button>
                )
              })}
            </div>
          ) : <EmptyState title={t('overview.noStateData')} />}
        </SectionCard>

        <SectionCard title={t('overview.topPlds')}>
          {pldTable.filter(p => p.sessions > 0).length ? (
            <div className="space-y-1.5">
              {pldTable.filter(p => p.sessions > 0).slice(0, 8).map((p, i) => (
                <button key={p.id} onClick={() => openEntity('pld', p.id, p.name, p.sub)}
                  className="w-full flex items-center gap-3 text-left hover:bg-surface-soft rounded-[8px] px-2 py-1.5 transition-colors">
                  <span className="font-display font-bold text-text-dim w-6">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-text block truncate">{p.name}</span>
                    <span className="text-[10px] text-text-faint">{p.sub}</span>
                  </span>
                  <span className="text-xs text-text-dim">{p.sessions} {t('overview.sessionsLower')}</span>
                  <span className={cn('text-xs font-semibold w-16 text-right', p.trend.cls)}>
                    {p.trend.icon} {p.avgPct != null ? `${p.avgPct}%` : '—'}
                  </span>
                </button>
              ))}
            </div>
          ) : <EmptyState title={t('overview.noPldActivity')} />}
        </SectionCard>
      </div>

      {/* ── EMERGING TALENTS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
        <SectionCard title={t('overview.emergingTalents')} className="lg:col-span-2">
          {derived.improvements.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead><tr className="border-b border-line">
                  {[t('roles.archer'), t('common.school'), t('common.pld'), t('common.sessions'), t('overview.avgPct'), t('overview.improvement')].map(h => (
                    <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wide text-text-faint pb-1.5 pr-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {derived.improvements.slice(0, 10).map(t => (
                    <tr key={t.archer.id} className="hover:bg-surface-soft cursor-pointer" onClick={() => setArcherId(t.archer.id)}>
                      <td className="py-2 pr-3 font-semibold text-text whitespace-nowrap">{t.archer.name}</td>
                      <td className="py-2 pr-3 text-xs text-text-dim">{schoolRows.find(s => s.school_id === t.archer.school_id)?.school ?? '—'}</td>
                      <td className="py-2 pr-3 text-xs text-text-dim">{pldRows.find(p => p.pld_id === t.archer.pld_id)?.pld ?? '—'}</td>
                      <td className="py-2 pr-3 text-text-dim">{t.sessions}</td>
                      <td className="py-2 pr-3 font-mono">{t.avgPct}%</td>
                      <td className={cn('py-2 font-bold', t.delta > 0 ? 'text-success' : 'text-danger')}>
                        {t.delta > 0 ? '▲ +' : '▼ '}{t.delta} pp
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t('overview.noTalentsYet')}
              description={t('overview.noTalentsHint')} />
          )}
        </SectionCard>

        <SectionCard title={t('overview.emergingPldsStates')}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-faint mb-1.5">{t('overview.plds')}</p>
          {derived.emergingPlds.length ? derived.emergingPlds.map(e => {
            const p = pldRows.find(x => x.pld_id === e.id)
            return (
              <button key={e.id} onClick={() => p && openEntity('pld', e.id, p.pld, p.state_code)}
                className="w-full flex items-center justify-between text-left hover:bg-surface-soft rounded px-2 py-1.5">
                <span className="text-xs font-semibold text-text truncate">{p?.pld ?? '—'}</span>
                <span className="text-xs text-success font-bold">▲ +{e.avgDelta} pp · {e.talents}</span>
              </button>
            )
          }) : <p className="text-xs text-text-faint mb-2">{t('overview.notEnoughData')}</p>}
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-faint mt-3 mb-1.5">{t('overview.states')}</p>
          {derived.emergingStates.length ? derived.emergingStates.map(e => {
            const s = stateRows.find(x => x.state_id === e.id)
            return (
              <button key={e.id} onClick={() => s && openEntity('state', e.id, s.state, s.state_code)}
                className="w-full flex items-center justify-between text-left hover:bg-surface-soft rounded px-2 py-1.5">
                <span className="text-xs font-semibold text-text truncate">{s?.state ?? '—'}</span>
                <span className="text-xs text-success font-bold">▲ +{e.avgDelta} pp · {e.talents}</span>
              </button>
            )
          }) : <p className="text-xs text-text-faint">{t('overview.notEnoughData')}</p>}
        </SectionCard>
      </div>

      {/* ── TREND TABLES ── */}
      <EntityTrendTable title={t('overview.stateTrend')} rows={stateTable} onRow={(r) => openEntity('state', r.id, r.name, r.sub)} />
      <EntityTrendTable title={t('overview.pldTrend')} rows={pldTable} onRow={(r) => openEntity('pld', r.id, r.name, r.sub)} />
      <EntityTrendTable title={t('overview.schoolTrend')} rows={schoolTable} onRow={(r) => openEntity('school', r.id, r.name, r.sub)} />

      {/* ── CARD LIST MODAL (full by-state lists) ── */}
      <Modal open={!!cardList} onClose={() => setCardList(null)}
        title={cardList === 'students' ? t('overview.studentsByState') : cardList === 'active' ? t('overview.activeByState') : cardList === 'sessions' ? t('overview.sessionsByState') : t('overview.arrowsByState')}
        width="min(480px,100%)">
        <div className="space-y-1">
          {stateTable.map(s => {
            const val = cardList === 'students' ? s.registered
              : cardList === 'active' ? (derived.activeByState.get(s.id)?.size ?? 0)
              : cardList === 'sessions' ? s.sessions
              : (derived.arrowsByState.get(s.id) ?? 0)
            return (
              <button key={s.id}
                onClick={() => { setCardList(null); openEntity('state', s.id, s.name, s.sub) }}
                className="w-full flex items-center justify-between text-left hover:bg-surface-soft rounded-[8px] px-3 py-2">
                <span className="text-sm font-semibold text-text">{s.name}</span>
                <span className="font-mono font-bold text-text">{compact(val)}</span>
              </button>
            )
          })}
        </div>
      </Modal>

      {/* ── ENTITY DRILL-DOWN ── */}
      <EntityModal
        entity={entity}
        onClose={() => setEntity(null)}
        archers={archers}
        curApp={derived.curApp}
        table={entity?.kind === 'state' ? stateTable : entity?.kind === 'pld' ? pldTable : schoolTable}
        activeByState={derived.activeByState}
        onArcher={(id) => setArcherId(id)}
      />

      {/* ── ARCHER DRILL-DOWN ── */}
      <ArcherModal
        archer={archerId ? archerById.get(archerId) ?? null : null}
        subs={subs.filter(s => s.archer_id === archerId && s.date >= startCur)}
        schoolName={archerId ? schoolRows.find(s => s.school_id === archerById.get(archerId)?.school_id)?.school : undefined}
        onClose={() => setArcherId(null)}
      />
    </PageWrapper>
  )
}

// ─── ENTITY TREND TABLE ───────────────────────────────────────────────────────

interface TableRow {
  id: string; name: string; sub: string; registered: number
  sessions: number; avgPct: number | null
  trend: { delta: number | null; label: string; cls: string; icon: string }
}

function EntityTrendTable({ title, rows, onRow }: { title: string; rows: TableRow[]; onRow: (r: TableRow) => void }) {
  const { t } = useLanguage()
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? rows : rows.slice(0, 6)
  return (
    <SectionCard title={title} className="mb-4"
      action={rows.length > 6 ? (
        <button onClick={() => setExpanded(e => !e)} className="text-xs font-semibold text-primary hover:underline">
          {expanded ? t('overview.showLess') : t('overview.showAll', { count: rows.length })}
        </button>
      ) : undefined}>
      {rows.length === 0 ? <EmptyState title={t('common.noData')} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead><tr className="border-b border-line">
              {[t('common.name'), t('nav.archers'), t('common.sessions'), t('overview.avgPct'), t('overview.trendVsPrevious')].map(h => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wide text-text-faint pb-1.5 pr-3">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-line">
              {shown.map(r => (
                <tr key={r.id} className="hover:bg-surface-soft cursor-pointer" onClick={() => onRow(r)}>
                  <td className="py-2 pr-3">
                    <span className="font-semibold text-text">{r.name}</span>
                    {r.sub && <span className="text-[10px] text-text-faint block">{r.sub}</span>}
                  </td>
                  <td className="py-2 pr-3 text-text-dim">{r.registered}</td>
                  <td className="py-2 pr-3 text-text-dim">{r.sessions}</td>
                  <td className="py-2 pr-3 font-mono">{r.avgPct != null ? `${r.avgPct}%` : '—'}</td>
                  <td className={cn('py-2 font-semibold text-xs', r.trend.cls)}>
                    {r.trend.icon} {r.trend.delta != null ? `${r.trend.delta > 0 ? '+' : ''}${r.trend.delta} pp · ` : ''}{r.trend.label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

// ─── ENTITY MODAL (state / pld / school → leaderboard → archer) ───────────────

function EntityModal({ entity, onClose, archers, curApp, table, activeByState, onArcher }: {
  entity: EntityRef | null
  onClose: () => void
  archers: ArcherProfile[]
  curApp: Sub[]
  table: TableRow[]
  activeByState: Map<string, Set<string>>
  onArcher: (id: string) => void
}) {
  const { t } = useLanguage()
  const [bow, setBow] = useState('')
  const [q, setQ] = useState('')

  if (!entity) return null
  const row = table.find(r => r.id === entity.id)
  const key = entity.kind === 'state' ? 'state_id' : entity.kind === 'pld' ? 'pld_id' : 'school_id'
  const members = archers.filter(a => a[key] === entity.id)
  const memberIds = new Set(members.map(m => m.id))

  // Mini leaderboard inside the entity, from validated range scores
  const perArcher = new Map<string, { best: number; sessions: number; pctSum: number }>()
  for (const s of curApp) {
    if (!memberIds.has(s.archer_id) || !s.max_score) continue
    const a = archers.find(x => x.id === s.archer_id)
    if (bow && (s.bow_category ?? a?.bow_category ?? '') !== bow) continue
    const pct = (s.total_score / s.max_score) * 100
    const e = perArcher.get(s.archer_id) ?? { best: 0, sessions: 0, pctSum: 0 }
    e.best = Math.max(e.best, pct); e.sessions++; e.pctSum += pct
    perArcher.set(s.archer_id, e)
  }
  let board = [...perArcher.entries()]
    .map(([id, e]) => ({ archer: archers.find(a => a.id === id)!, best: Math.round(e.best * 10) / 10, sessions: e.sessions, avg: Math.round((e.pctSum / e.sessions) * 10) / 10 }))
    .filter(b => b.archer)
    .sort((a, b) => b.best - a.best)
  if (q.trim()) {
    const s = q.toLowerCase()
    board = board.filter(b => b.archer.name.toLowerCase().includes(s) || (b.archer.archer_id ?? '').toLowerCase().includes(s))
  }

  const bows = [...new Set(members.map(m => m.bow_category).filter(Boolean))] as string[]
  const activeCount = entity.kind === 'state'
    ? activeByState.get(entity.id)?.size ?? board.length
    : new Set(curApp.filter(s => memberIds.has(s.archer_id)).map(s => s.archer_id)).size

  return (
    <Modal open onClose={onClose} title={`${entity.name}${entity.sub ? ` · ${entity.sub}` : ''}`} width="min(640px,100%)">
      <div className="space-y-4">
        {/* Statistics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat label={t('overview.registered')} value={String(row?.registered ?? members.length)} />
          <MiniStat label={t('overview.activeInRange')} value={String(activeCount)} />
          <MiniStat label={t('common.sessions')} value={String(row?.sessions ?? 0)} />
          <MiniStat label={t('overview.avgScore')} value={row?.avgPct != null ? `${row.avgPct}%` : '—'}
            sub={row ? `${row.trend.icon} ${row.trend.label}` : undefined} subCls={row?.trend.cls} />
        </div>

        {/* Leaderboard filters */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <Input placeholder={t('overview.searchArcher')} value={q} onChange={e => setQ(e.target.value)} wrapperClassName="flex-1 min-w-[140px]" />
          <button onClick={() => setBow('')}
            className={cn('px-2.5 py-1.5 rounded-full text-[11px] font-semibold border',
              !bow ? 'bg-primary text-primary-on border-primary' : 'bg-section text-text-dim border-line')}>
            {t('overview.allBows')}
          </button>
          {bows.map(b => (
            <button key={b} onClick={() => setBow(bow === b ? '' : b)}
              className={cn('px-2.5 py-1.5 rounded-full text-[11px] font-semibold border capitalize',
                bow === b ? 'bg-primary text-primary-on border-primary' : 'bg-section text-text-dim border-line')}>
              {b}
            </button>
          ))}
        </div>

        {/* Leaderboard */}
        {board.length === 0 ? (
          <EmptyState title={t('overview.noValidatedInRange')} description={t('overview.noValidatedInRangeHint')} />
        ) : (
          <div className="space-y-1 max-h-[320px] overflow-y-auto pr-1">
            {board.slice(0, 25).map((b, i) => (
              <button key={b.archer.id} onClick={() => onArcher(b.archer.id)}
                className="w-full flex items-center gap-3 text-left hover:bg-surface-soft rounded-[8px] px-2.5 py-2">
                <span className="font-display font-bold text-text-dim w-6">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-semibold text-text block truncate">{b.archer.name}</span>
                  <span className="text-[10px] font-mono text-text-faint">{b.archer.archer_id ?? '—'} · {b.sessions} {t('overview.sessionsLower')}</span>
                </span>
                <span className="text-xs text-text-dim">{t('overview.avgShort')} {b.avg}%</span>
                <span className="font-bold text-primary">{b.best}%</span>
              </button>
            ))}
          </div>
        )}
        <p className="text-[11px] text-text-faint">{t('overview.tapArcher')}</p>
      </div>
    </Modal>
  )
}

function MiniStat({ label, value, sub, subCls }: { label: string; value: string; sub?: string; subCls?: string }) {
  return (
    <div className="bg-surface-soft rounded-[10px] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{label}</p>
      <p className="font-display font-bold text-lg text-text tabular-nums">{value}</p>
      {sub && <p className={cn('text-[10px] font-semibold', subCls ?? 'text-text-dim')}>{sub}</p>}
    </div>
  )
}

// ─── ARCHER MODAL ─────────────────────────────────────────────────────────────

function ArcherModal({ archer, subs, schoolName, onClose }: {
  archer: ArcherProfile | null
  subs: Sub[]
  schoolName?: string
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (!archer) return null
  const approved = subs.filter(s => s.status === 'admin_approved' && s.max_score)
  const sorted = [...subs].sort((a, b) => a.date.localeCompare(b.date))
  const best = approved.length ? Math.max(...approved.map(s => scorePct(s.total_score, s.max_score))) : null
  const avgP = approved.length
    ? Math.round(approved.reduce((sum, s) => sum + scorePct(s.total_score, s.max_score), 0) / approved.length)
    : null

  return (
    <Modal open onClose={onClose} title={archer.name} width="min(560px,100%)">
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap text-xs text-text-dim">
          {archer.archer_id && <span className="font-mono">{archer.archer_id}</span>}
          {archer.age != null && <Badge variant="neutral">{t('common.age')} {archer.age}</Badge>}
          {archer.bow_category && <Badge variant="neutral" className="capitalize">{archer.bow_category}</Badge>}
          {schoolName && <Badge variant="neutral">{schoolName}</Badge>}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <MiniStat label={t('overview.sessionsRange')} value={String(subs.length)} />
          <MiniStat label={t('overview.bestPct')} value={best != null ? `${best}%` : '—'} />
          <MiniStat label={t('overview.averagePct')} value={avgP != null ? `${avgP}%` : '—'} />
        </div>

        {sorted.length > 1 ? (
          <ScoreTrendChart
            height={200}
            data={sorted.map(s => ({
              date: s.date,
              score: s.total_score,
              maxScore: s.max_score,
              status: s.status,
            }))}
          />
        ) : (
          <EmptyState title={t('overview.notEnoughSessions')} />
        )}

        {sorted.length > 0 && (
          <p className="text-[11px] text-text-faint text-center">
            {sorted.length} {t('overview.sessionsLower')} · {formatDate(sorted[0].date)} → {formatDate(sorted[sorted.length - 1].date)}
          </p>
        )}
      </div>
    </Modal>
  )
}


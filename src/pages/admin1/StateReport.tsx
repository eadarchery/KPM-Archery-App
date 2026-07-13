import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Select, EmptyState } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { canViewReports } from '@/lib/permissions'
import { getAdminScope } from '@/lib/scope'
import { getActiveStates, getActivePLDs, getActiveSchools } from '@/services/organization'
import { getAdmin1Scopes } from '@/services/adminScopes'
import { supabase } from '@/services/supabase'
import { getKpmTrainingActivity } from '@/services/kpmMetrics'
import { KpmBackendNotice } from '@/components/reports/kpm/shared'
import { daysAgo, formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'

/**
 * State Report Generator — Admin 1.
 * Produces a period report for ONE state as a printable document with
 * rule-based analytical findings. Every number and finding is deterministic
 * (thresholds + arithmetic — no AI): auditable and reproducible.
 */

// ─── PERIODS ──────────────────────────────────────────────────────────────────

type PeriodKey = '30d' | '90d' | '6m' | '1y'
const PERIODS: { key: PeriodKey; labelKey: string; days: number }[] = [
  { key: '30d', labelKey: 'stateReport.last30d', days: 30 },
  { key: '90d', labelKey: 'stateReport.lastQuarter', days: 90 },
  { key: '6m',  labelKey: 'stateReport.last6m', days: 182 },
  { key: '1y',  labelKey: 'stateReport.last12m', days: 365 },
]

// ─── DATA SHAPES ──────────────────────────────────────────────────────────────

interface ArcherRow {
  id: string; name: string; archer_id: string | null; age: number | null
  status: string; coach_id: string | null
  school_id: string | null; pld_id: string | null; created_at: string
}
interface Sub {
  archer_id: string; date: string; total_score: number; max_score: number
  status: string; created_at: string
}
interface SchoolInfo { school_id: string; school: string; pld: string | null; active: boolean; registered_archers: number }
interface PldInfo { pld_id: string; pld: string; registered_archers: number }

interface Finding { icon: string; cls: string; text: string }

const pct = (s: Sub) => (s.max_score ? (s.total_score / s.max_score) * 100 : 0)
const r1 = (n: number) => Math.round(n * 10) / 10

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function StateReportPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  if (!canViewReports(profile?.role)) return <AccessDenied />

  const scope = getAdminScope(profile ?? null)
  const [stateId, setStateId] = useState<string>(scope.stateId ?? '')
  const [period, setPeriod] = useState<PeriodKey>('90d')
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null)

  const days = PERIODS.find(p => p.key === period)!.days
  const startCur = daysAgo(days)
  const startPrev = daysAgo(days * 2)

  const { data: allStates = [] } = useQuery({ queryKey: ['rpt-states'], queryFn: getActiveStates, staleTime: 300_000 })
  const { data: allPlds = [] } = useQuery({ queryKey: ['rpt-plds'], queryFn: getActivePLDs, staleTime: 300_000 })
  const { data: allSchools = [] } = useQuery({ queryKey: ['rpt-schools'], queryFn: getActiveSchools, staleTime: 300_000 })
  const { data: assignments = [] } = useQuery({
    queryKey: ['my-admin1-scopes', profile?.id],
    queryFn: () => getAdmin1Scopes(profile!.id),
    enabled: !!profile?.id,
    staleTime: 60_000,
  })

  // Restrict selectable states to the admin's scope: states ticked directly,
  // plus the states their ticked PLDs / schools belong to. No assignments →
  // legacy scope (their single state), else everything (national admins).
  const states = useMemo(() => {
    if (assignments.length > 0) {
      const allowed = new Set<string>()
      for (const a of assignments) {
        if (a.level === 'state') allowed.add(a.ref_id)
        if (a.level === 'pld') {
          const st = allPlds.find(p => p.id === a.ref_id)?.state_id
          if (st) allowed.add(st)
        }
        if (a.level === 'school') {
          const st = allSchools.find(s => s.id === a.ref_id)?.state_id
          if (st) allowed.add(st)
        }
      }
      return allStates.filter(s => allowed.has(s.id))
    }
    if (scope.stateId) return allStates.filter(s => s.id === scope.stateId)
    return allStates
  }, [assignments, allStates, allPlds, allSchools, scope.stateId])

  const stateName = states.find(s => s.id === stateId)?.name ?? ''

  // ── Report data (fetched once state+period chosen) ─────────────────────────
  const enabled = !!stateId && !!generatedAt

  const { data: archers = [], isLoading: l1 } = useQuery<ArcherRow[]>({
    queryKey: ['sr-archers', stateId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, archer_id, age, status, coach_id, school_id, pld_id, created_at')
        .eq('role', 'archer').eq('state_id', stateId).limit(5000)
      if (error) throw error
      return (data ?? []) as ArcherRow[]
    },
  })

  const { data: allSubs = [], isLoading: l2 } = useQuery<Sub[]>({
    queryKey: ['sr-subs', period],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_submissions')
        .select('archer_id, date, total_score, max_score, status, created_at')
        .gte('date', startPrev).order('date', { ascending: true }).limit(10000)
      if (error) throw error
      return (data ?? []) as Sub[]
    },
  })

  // Training arrows come from the trusted kpm_training_summary RPC (migration
  // 062) — never summed in the browser. Two calls: current window + previous.
  const { data: trainCur, error: trainErr } = useQuery({
    queryKey: ['sr-train-cur', stateId, period],
    enabled,
    queryFn: () => getKpmTrainingActivity({ stateId, startDate: startCur }),
  })
  const { data: trainPrev } = useQuery({
    queryKey: ['sr-train-prev', stateId, period],
    enabled,
    // Previous window ends the day before the current window starts.
    queryFn: () => getKpmTrainingActivity({ stateId, startDate: startPrev, endDate: daysAgo(days + 1) }),
  })

  const { data: schools = [], isError: schoolsErr } = useQuery<SchoolInfo[]>({
    queryKey: ['sr-schools', stateId],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('report_school_activity')
        .select('school_id, school, pld, active, registered_archers')
        .eq('state_id', stateId)
      if (error) throw error
      return (data ?? []) as SchoolInfo[]
    },
  })

  const { data: plds = [], isError: pldsErr } = useQuery<PldInfo[]>({
    queryKey: ['sr-plds', stateId],
    enabled,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('report_pld_activity')
        .select('pld_id, pld, registered_archers')
        .eq('state_id', stateId)
      if (error) throw error
      return (data ?? []) as PldInfo[]
    },
  })

  const loading = enabled && (l1 || l2)
  const viewsMissing = schoolsErr || pldsErr

  // ── Report computation (all deterministic rules) ───────────────────────────
  const report = useMemo(() => {
    if (!enabled || loading) return null
    const ids = new Set(archers.map(a => a.id))
    const byId = new Map(archers.map(a => [a.id, a]))
    const subs = allSubs.filter(s => ids.has(s.archer_id))
    const inCur = (d: string) => d >= startCur

    const cur = subs.filter(s => inCur(s.date))
    const prev = subs.filter(s => !inCur(s.date))
    const curApp = cur.filter(s => s.status === 'admin_approved' && s.max_score)
    const prevApp = prev.filter(s => s.status === 'admin_approved' && s.max_score)

    const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)
    const avgCur = mean(curApp.map(pct))
    const avgPrev = mean(prevApp.map(pct))

    const activeCur = new Set(curApp.map(s => s.archer_id)).size
    const activePrev = new Set(prevApp.map(s => s.archer_id)).size
    const newRegs = archers.filter(a => a.created_at.slice(0, 10) >= startCur).length
    // Official training volume from kpm_training_summary — not browser-summed.
    const arrowsCur = trainCur?.total_arrows ?? 0
    const arrowsPrev = trainPrev?.total_arrows ?? 0

    // Coached vs uncoached
    const coached: number[] = [], uncoached: number[] = []
    for (const s of curApp) (byId.get(s.archer_id)?.coach_id ? coached : uncoached).push(pct(s))
    const coachedAvg = mean(coached), uncoachedAvg = mean(uncoached)

    // Per-entity (school / pld) aggregates for the period
    const agg = (key: 'school_id' | 'pld_id', rows: Sub[]) => {
      const m = new Map<string, { sessions: number; pcts: number[] }>()
      for (const s of rows) {
        const k = byId.get(s.archer_id)?.[key]
        if (!k) continue
        const e = m.get(k) ?? { sessions: 0, pcts: [] }
        e.sessions++
        if (s.status === 'admin_approved' && s.max_score) e.pcts.push(pct(s))
        m.set(k, e)
      }
      return m
    }
    const schoolCur = agg('school_id', cur), schoolPrev = agg('school_id', prev)
    const pldCur = agg('pld_id', cur), pldPrev = agg('pld_id', prev)

    const entityTable = <T extends { registered_archers: number }>(
      infos: (T & { id: string; name: string; sub?: string | null })[],
      curM: Map<string, { sessions: number; pcts: number[] }>,
      prevM: Map<string, { sessions: number; pcts: number[] }>,
    ) => infos.map(info => {
      const c = curM.get(info.id), p = prevM.get(info.id)
      const a = c ? mean(c.pcts) : null
      const b = p ? mean(p.pcts) : null
      const delta = a != null && b != null ? r1(a - b) : null
      return {
        id: info.id, name: info.name, sub: info.sub ?? '', registered: info.registered_archers,
        sessions: c?.sessions ?? 0, avgPct: a != null ? r1(a) : null, delta,
      }
    }).sort((x, y) => y.sessions - x.sessions)

    const schoolTable = entityTable(
      schools.map(s => ({ ...s, id: s.school_id, name: s.school, sub: s.pld })),
      schoolCur, schoolPrev)
    const pldTable = entityTable(
      plds.map(p => ({ ...p, id: p.pld_id, name: p.pld })),
      pldCur, pldPrev)

    // Emerging talents: ≥4 validated sessions, second half vs first half
    const perArcher = new Map<string, number[]>()
    for (const s of curApp) {
      const arr = perArcher.get(s.archer_id) ?? []
      arr.push(pct(s)); perArcher.set(s.archer_id, arr)
    }
    const talents = [...perArcher.entries()]
      .filter(([, v]) => v.length >= 4)
      .map(([id, v]) => {
        const half = Math.floor(v.length / 2)
        const d = r1(mean(v.slice(-half))! - mean(v.slice(0, half))!)
        return { archer: byId.get(id)!, sessions: v.length, avg: r1(mean(v)!), best: r1(Math.max(...v)), delta: d }
      })
      .sort((a, b) => b.delta - a.delta)

    // Top performers by best %
    const performers = [...perArcher.entries()]
      .map(([id, v]) => ({ archer: byId.get(id)!, sessions: v.length, best: r1(Math.max(...v)), avg: r1(mean(v)!) }))
      .sort((a, b) => b.best - a.best)
      .slice(0, 10)

    // ── RULE-BASED FINDINGS ──
    const findings: Finding[] = []
    const pd = (c: number, p: number) => (p ? r1(((c - p) / p) * 100) : null)

    const sessDelta = pd(cur.length, prev.length)
    if (sessDelta != null) {
      findings.push(Math.abs(sessDelta) < 5
        ? { icon: '▬', cls: 'text-text-dim', text: t('stateReport.findSessSteady', { delta: `${sessDelta > 0 ? '+' : ''}${sessDelta}`, count: cur.length }) }
        : sessDelta > 0
          ? { icon: '▲', cls: 'text-success', text: t('stateReport.findSessUp', { delta: sessDelta, prev: prev.length, cur: cur.length }) }
          : { icon: '▼', cls: 'text-danger', text: t('stateReport.findSessDown', { delta: Math.abs(sessDelta), prev: prev.length, cur: cur.length }) })
    }
    if (avgCur != null && avgPrev != null) {
      const d = r1(avgCur - avgPrev)
      findings.push(Math.abs(d) < 3
        ? { icon: '▬', cls: 'text-text-dim', text: t('stateReport.findAvgSteady', { avg: r1(avgCur), delta: `${d > 0 ? '+' : ''}${d}` }) }
        : d > 0
          ? { icon: '▲', cls: 'text-success', text: t('stateReport.findAvgUp', { delta: d, avg: r1(avgCur) }) }
          : { icon: '▼', cls: 'text-danger', text: t('stateReport.findAvgDown', { delta: Math.abs(d), avg: r1(avgCur) }) })
    }
    if (activePrev) {
      const d = pd(activeCur, activePrev)!
      if (Math.abs(d) >= 10) findings.push(d > 0
        ? { icon: '▲', cls: 'text-success', text: t('stateReport.findActiveUp', { delta: d, prev: activePrev, cur: activeCur }) }
        : { icon: '▼', cls: 'text-danger', text: t('stateReport.findActiveDown', { delta: Math.abs(d), prev: activePrev, cur: activeCur }) })
    }
    if (newRegs > 0) findings.push({ icon: '＋', cls: 'text-success', text: t('stateReport.findNewRegs', { count: newRegs }) })
    if (coachedAvg != null && uncoachedAvg != null) {
      const d = r1(coachedAvg - uncoachedAvg)
      findings.push({ icon: d >= 0 ? '▲' : '▼', cls: d >= 0 ? 'text-success' : 'text-warning',
        text: t('stateReport.findCoached', { coached: r1(coachedAvg), uncoached: r1(uncoachedAvg), delta: `${d > 0 ? '+' : ''}${d}` }) })
    }
    const inactiveSchools = schoolTable.filter(s => s.registered > 0 && s.sessions === 0)
    if (inactiveSchools.length) findings.push({
      icon: '⚠', cls: 'text-warning',
      text: t('stateReport.findInactiveSchools', {
        count: inactiveSchools.length,
        names: `${inactiveSchools.slice(0, 5).map(s => s.name).join(', ')}${inactiveSchools.length > 5 ? '…' : ''}`,
      }),
    })
    const strongTalents = talents.filter(x => x.delta >= 5)
    if (strongTalents.length) findings.push({
      icon: '★', cls: 'text-primary',
      text: t('stateReport.findTalents', { count: strongTalents.length }),
    })
    const weekAgoIso = new Date(Date.now() - 7 * 86400_000).toISOString()
    const backlog = cur.filter(s => ['pending', 'coach_approved'].includes(s.status) && s.created_at < weekAgoIso).length
    if (backlog) findings.push({ icon: '⏳', cls: 'text-warning', text: t('stateReport.findBacklog', { count: backlog }) })
    const scoredSchools = schoolTable.filter(s => s.avgPct != null && s.sessions >= 3)
    if (scoredSchools.length >= 2) {
      const top = scoredSchools.reduce((a, b) => (b.avgPct! > a.avgPct! ? b : a))
      const bottom = scoredSchools.reduce((a, b) => (b.avgPct! < a.avgPct! ? b : a))
      findings.push({ icon: '🏆', cls: 'text-text-dim', text: t('stateReport.findTopBottom', { top: top.name, topPct: top.avgPct!, bottom: bottom.name, bottomPct: bottom.avgPct! }) })
    }
    if (findings.length === 0) findings.push({ icon: '▬', cls: 'text-text-faint', text: t('stateReport.findNone') })

    return {
      registered: archers.length, newRegs, activeCur, activePrev,
      sessions: cur.length, sessionsPrev: prev.length,
      validated: curApp.length,
      avgCur: avgCur != null ? r1(avgCur) : null, avgPrev: avgPrev != null ? r1(avgPrev) : null,
      arrowsCur, arrowsPrev,
      coachedAvg: coachedAvg != null ? r1(coachedAvg) : null,
      uncoachedAvg: uncoachedAvg != null ? r1(uncoachedAvg) : null,
      findings, schoolTable, pldTable, talents: talents.slice(0, 10), performers,
    }
  }, [enabled, loading, archers, allSubs, trainCur, trainPrev, schools, plds, startCur, t])

  // ── CSV export ──────────────────────────────────────────────────────────────
  function exportCsv() {
    if (!report) return
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines: string[] = []
    lines.push(`State report,${esc(stateName)}`)
    lines.push(`Period,${esc(t(PERIODS.find(p => p.key === period)!.labelKey))}`)
    lines.push(`Generated,${esc(new Date().toLocaleString())}`)
    lines.push('')
    lines.push('SUMMARY')
    lines.push('Metric,Current period,Previous period')
    lines.push(`Registered archers,${report.registered},`)
    lines.push(`New registrations,${report.newRegs},`)
    lines.push(`Active archers,${report.activeCur},${report.activePrev}`)
    lines.push(`Sessions,${report.sessions},${report.sessionsPrev}`)
    lines.push(`Validated scores,${report.validated},`)
    lines.push(`Average score %,${report.avgCur ?? ''},${report.avgPrev ?? ''}`)
    lines.push(`Training arrows,${report.arrowsCur},${report.arrowsPrev}`)
    lines.push('')
    lines.push('FINDINGS')
    report.findings.forEach(f => lines.push(esc(f.text)))
    lines.push('')
    lines.push('PLD TABLE')
    lines.push('PLD,Registered,Sessions,Avg %,Delta pp')
    report.pldTable.forEach(r => lines.push(`${esc(r.name)},${r.registered},${r.sessions},${r.avgPct ?? ''},${r.delta ?? ''}`))
    lines.push('')
    lines.push('SCHOOL TABLE')
    lines.push('School,PLD,Registered,Sessions,Avg %,Delta pp')
    report.schoolTable.forEach(r => lines.push(`${esc(r.name)},${esc(r.sub)},${r.registered},${r.sessions},${r.avgPct ?? ''},${r.delta ?? ''}`))
    lines.push('')
    lines.push('EMERGING TALENTS')
    lines.push('Archer,Archer ID,Sessions,Avg %,Best %,Improvement pp')
    report.talents.forEach(t => lines.push(`${esc(t.archer.name)},${esc(t.archer.archer_id)},${t.sessions},${t.avg},${t.best},${t.delta}`))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `state-report-${stateName.replace(/\s+/g, '-').toLowerCase()}-${period}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const stateOpts = [{ value: '', label: t('stateReport.selectState') }, ...states.map(s => ({ value: s.id, label: s.name }))]
  const periodOpts = PERIODS.map(p => ({ value: p.key, label: t(p.labelKey) }))

  return (
    <PageWrapper>
      {/* Print isolation: when printing, only the report itself is visible */}
      <style>{`@media print {
        body * { visibility: hidden; }
        #state-report, #state-report * { visibility: visible; }
        #state-report { position: absolute; left: 0; top: 0; width: 100%; }
      }`}</style>

      <PageHead
        title={t('stateReport.title')}
        description={t('stateReport.description')}
      />

      {/* Controls */}
      <SectionCard className="mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <Select label={t('common.state')} options={stateOpts} value={stateId}
            onChange={e => { setStateId(e.target.value); setGeneratedAt(null) }} />
          <Select label={t('stateReport.period')} options={periodOpts} value={period}
            onChange={e => { setPeriod(e.target.value as PeriodKey); setGeneratedAt(null) }} />
          <Button variant="primary" disabled={!stateId} onClick={() => setGeneratedAt(new Date())}>
            {t('stateReport.generate')}
          </Button>
        </div>
      </SectionCard>

      {states.length === 0 && (
        <p className="text-sm text-warning bg-warning-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-4">
          {t('stateReport.noStates')}
        </p>
      )}

      {viewsMissing && (
        <p className="text-sm text-warning bg-warning-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-4">
          {t('stateReport.viewsMissing')}
        </p>
      )}

      {trainErr != null && <KpmBackendNotice migrations="061–062" error={trainErr} />}

      {!generatedAt ? (
        <EmptyState title={t('stateReport.selectPrompt')} description={t('stateReport.selectPromptHint')} />
      ) : loading || !report ? (
        <p className="py-12 text-center text-text-faint text-sm">{t('stateReport.compiling')}</p>
      ) : (
        <>
          <div className="flex gap-2 mb-4 print:hidden">
            <Button variant="outline" onClick={() => window.print()}>{t('stateReport.printPdf')}</Button>
            <Button variant="outline" onClick={exportCsv}>{t('stateReport.exportCsv')}</Button>
          </div>

          {/* ── THE REPORT DOCUMENT ── */}
          <div id="state-report" className="card p-6 space-y-6">
            {/* Header */}
            <div className="border-b border-line pb-4">
              <h2 className="font-display font-bold text-xl text-text">{stateName} — {t('stateReport.reportHeading')}</h2>
              <p className="text-sm text-text-dim mt-1">
                {t(PERIODS.find(p => p.key === period)!.labelKey)} · {t('stateReport.comparedWith')}
              </p>
              <p className="text-xs text-text-faint mt-0.5">
                {t('stateReport.generatedBy', { date: generatedAt.toLocaleString(), name: profile?.name ?? '' })}
              </p>
            </div>

            {/* Summary */}
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[.07em] text-text-faint mb-2">{t('stateReport.summary')}</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <SummaryCell label={t('stateReport.registeredArchers')} value={String(report.registered)} />
                <SummaryCell label={t('stateReport.newRegistrations')} value={`+${report.newRegs}`} />
                <SummaryCell label={t('coachDash.activeArchers')} value={String(report.activeCur)} prev={report.activePrev} />
                <SummaryCell label={t('common.sessions')} value={String(report.sessions)} prev={report.sessionsPrev} />
                <SummaryCell label={t('stateReport.validatedScores')} value={String(report.validated)} />
                <SummaryCell label={t('stateReport.averageScore')} value={report.avgCur != null ? `${report.avgCur}%` : '—'}
                  prevLabel={report.avgPrev != null ? `${report.avgPrev}%` : undefined} />
                <SummaryCell label={t('stateReport.trainingArrows')} value={String(report.arrowsCur)} prev={report.arrowsPrev} />
                <SummaryCell label={t('stateReport.coachedVsUncoached')}
                  value={report.coachedAvg != null && report.uncoachedAvg != null
                    ? `${report.coachedAvg}% / ${report.uncoachedAvg}%` : '—'} />
              </div>
            </div>

            {/* Findings */}
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-[.07em] text-text-faint mb-2">
                {t('stateReport.findings')} <span className="normal-case font-normal">{t('stateReport.findingsHint')}</span>
              </h3>
              <ul className="space-y-1.5">
                {report.findings.map((f, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className={cn('font-bold shrink-0', f.cls)}>{f.icon}</span>
                    <span className="text-text">{f.text}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* PLD table */}
            <ReportTable
              title={t('stateReport.pldPerformance')}
              headers={[t('common.pld'), t('overview.registered'), t('common.sessions'), t('overview.avgPct'), t('stateReport.deltaVsPrev')]}
              rows={report.pldTable.map(r => [r.name, String(r.registered), String(r.sessions),
                r.avgPct != null ? `${r.avgPct}%` : '—',
                r.delta != null ? `${r.delta > 0 ? '+' : ''}${r.delta} pp` : '—'])}
            />

            {/* School table */}
            <ReportTable
              title={t('stateReport.schoolPerformance')}
              headers={[t('common.school'), t('common.pld'), t('overview.registered'), t('common.sessions'), t('overview.avgPct'), t('stateReport.deltaVsPrev')]}
              rows={report.schoolTable.map(r => [r.name, r.sub || '—', String(r.registered), String(r.sessions),
                r.avgPct != null ? `${r.avgPct}%` : '—',
                r.delta != null ? `${r.delta > 0 ? '+' : ''}${r.delta} pp` : '—'])}
            />

            {/* Emerging talents */}
            <ReportTable
              title={t('stateReport.talentsTitle')}
              headers={[t('roles.archer'), 'ID', t('common.sessions'), t('overview.avgPct'), t('overview.bestPct'), t('overview.improvement')]}
              rows={report.talents.map(t => [t.archer.name, t.archer.archer_id ?? '—', String(t.sessions),
                `${t.avg}%`, `${t.best}%`, `${t.delta > 0 ? '+' : ''}${t.delta} pp`])}
            />

            {/* Top performers */}
            <ReportTable
              title={t('stateReport.performersTitle')}
              headers={['#', t('roles.archer'), 'ID', t('common.sessions'), t('overview.avgPct'), t('overview.bestPct')]}
              rows={report.performers.map((p, i) => [String(i + 1), p.archer.name, p.archer.archer_id ?? '—',
                String(p.sessions), `${p.avg}%`, `${p.best}%`])}
            />

            <p className="text-[10px] text-text-faint border-t border-line pt-3">
              {t('stateReport.methodology')}
            </p>
          </div>
        </>
      )}
    </PageWrapper>
  )
}

// ─── PIECES ───────────────────────────────────────────────────────────────────

function SummaryCell({ label, value, prev, prevLabel }: { label: string; value: string; prev?: number; prevLabel?: string }) {
  const { t } = useLanguage()
  return (
    <div className="bg-surface-soft rounded-[10px] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-faint">{label}</p>
      <p className="font-display font-bold text-lg text-text">{value}</p>
      {(prev != null || prevLabel) && (
        <p className="text-[10px] text-text-faint">{t('stateReport.prevShort')}: {prevLabel ?? prev}</p>
      )}
    </div>
  )
}

function ReportTable({ title, headers, rows }: { title: string; headers: string[]; rows: string[][] }) {
  const { t } = useLanguage()
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-[.07em] text-text-faint mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-text-faint">{t('stateReport.noDataPeriod')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-surface-soft">
                {headers.map(h => (
                  <th key={h} className="text-left px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {r.map((c, j) => (
                    <td key={j} className={cn('px-2.5 py-1.5', j === 0 ? 'font-semibold text-text' : 'text-text-dim')}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

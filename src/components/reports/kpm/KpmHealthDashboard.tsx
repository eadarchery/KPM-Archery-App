import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import { SectionCard } from '@/components/layout/PageWrapper'
import { Badge } from '@/components/ui'
import { Select } from '@/components/ui'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmNationalHealthSummary, getKpmScopeHealth,
  type KpmHealthGroupBy, type KpmNationalHealthRow, type KpmScopeHealth,
} from '@/services/kpmMetrics'
import { fmtNum, HealthBadge, ExplainBox, StatusWord } from './shared'
import { HealthUnitDetailModal } from './HealthUnitDetailModal'

/**
 * Visual health dashboard rendered at the top of the Health tab.
 *
 * GOLDEN RULE compliance: every number plotted here arrives pre-computed from
 * migration 067's RPCs (health_status / health_score / health_reasons and the
 * per-unit metric columns). This file only formats, slices and PLOTS — the
 * green/yellow/red classification is the database's, never recomputed here.
 *
 * Three views:
 *   1. Status distribution — DB green/yellow/red counts per scope level.
 *   2. Correlation explorer — pick an X/Y metric pair; each dot is one unit,
 *      coloured AND shaped by its DB health status (status is never
 *      colour-alone: shape + legend label + tooltip text carry it too).
 *   3. Lowest health scores — the DB's own worst-first ordering, bar = score.
 *
 * Chart status colours are validated (scripts/validate_palette.js) per theme:
 *   light  #16a34a / #d97706 / #d92d20  on #ffffff — all checks pass
 *   dark   #16a34a / #d97706 / #ef4444  on #1d1b16 — all checks pass
 * (The app's dark badge tokens are lighter than the chart band, so the chart
 *  layer uses these darker steps; badges/text keep the normal tokens.)
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const STATUSES = ['Green', 'Yellow', 'Red'] as const
type Status = (typeof STATUSES)[number]

const CHART_STATUS_COLORS: Record<'light' | 'dark', Record<Status, string>> = {
  light: { Green: '#16a34a', Yellow: '#d97706', Red: '#d92d20' },
  dark:  { Green: '#16a34a', Yellow: '#d97706', Red: '#ef4444' },
}
const SURFACE = { light: '#ffffff', dark: '#1d1b16' }
/** Shape per status so state is never colour-alone (CVD/print safe). */
const STATUS_SHAPE: Record<Status, 'circle' | 'triangle' | 'diamond'> = {
  Green: 'circle', Yellow: 'triangle', Red: 'diamond',
}

// ─── Correlation axis options (raw DB columns; formatting only) ──────────────

interface AxisOpt {
  value: string
  labelKey: string
  get: (r: KpmScopeHealth) => number | null
  /** Display formatting for ticks/tooltip. */
  fmt: (v: number) => string
}

const X_OPTS: AxisOpt[] = [
  { value: 'training_sessions', labelKey: 'kpm.health.axisTraining',
    get: (r) => r.training_sessions, fmt: (v) => `${v}` },
  { value: 'active_ratio', labelKey: 'kpm.health.axisActiveRatio',
    get: (r) => (r.active_ratio == null ? null : Math.round(r.active_ratio * 100)), fmt: (v) => `${v}%` },
  { value: 'active_coaches', labelKey: 'kpm.health.axisActiveCoaches',
    get: (r) => r.active_coaches, fmt: (v) => `${v}` },
  { value: 'retention_rate', labelKey: 'kpm.health.axisRetention',
    get: (r) => r.retention_rate, fmt: (v) => `${v}%` },
]

const Y_OPTS: AxisOpt[] = [
  { value: 'avg_improvement_pp', labelKey: 'kpm.health.axisImprovement',
    get: (r) => r.avg_improvement_pp, fmt: (v) => `${v > 0 ? '+' : ''}${v} pp` },
  { value: 'avg_score_pct', labelKey: 'kpm.health.axisAvgScore',
    get: (r) => r.avg_score_pct, fmt: (v) => `${v}%` },
  { value: 'retention_rate', labelKey: 'kpm.health.axisRetention',
    get: (r) => r.retention_rate, fmt: (v) => `${v}%` },
]

const LEVEL_OPTS: { value: KpmHealthGroupBy; labelKey: string }[] = [
  { value: 'school', labelKey: 'common.school' },
  { value: 'pld',    labelKey: 'common.pld' },
  { value: 'state',  labelKey: 'common.state' },
]

// ─── 1. Status distribution (plain HTML stacked bars — DB counts) ────────────

function StatusStack({ row, colors, t, onPick }: {
  row: KpmNationalHealthRow
  colors: Record<Status, string>
  t: Translate
  onPick: (level: string, status: Status) => void
}) {
  const total = row.total_units
  const parts: { status: Status; n: number }[] = [
    { status: 'Green', n: row.green },
    { status: 'Yellow', n: row.yellow },
    { status: 'Red', n: row.red },
  ]
  const levelKey: Record<string, string> = { state: 'common.state', pld: 'common.pld', school: 'common.school' }
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 shrink-0 text-xs font-semibold text-text-dim">
        {levelKey[row.scope_type] ? t(levelKey[row.scope_type]) : row.scope_type}
      </span>
      <div className="flex-1 flex h-6 rounded-[6px] overflow-hidden bg-surface-soft" role="group"
        aria-label={parts.map((p) => `${p.n} ${t('kpm.health.' + p.status.toLowerCase())}`).join(', ')}>
        {total > 0 && parts.map((p) => p.n > 0 && (
          <button
            key={p.status}
            type="button"
            onClick={() => onPick(row.scope_type, p.status)}
            title={`${t('kpm.health.' + p.status.toLowerCase())}: ${p.n}/${total} — ${t('kpm.health.clickToList')}`}
            className="h-full flex items-center justify-center transition-all hover:brightness-110 hover:saturate-150 cursor-pointer"
            style={{
              width: `${(p.n / total) * 100}%`,
              background: colors[p.status],
              // 2px surface gap between adjacent fills
              boxShadow: '1px 0 0 0 var(--surface), -1px 0 0 0 var(--surface)',
            }}
          >
            {p.n / total > 0.08 && (
              <span className="text-[10px] font-bold text-white/95 tabular-nums">{p.n}</span>
            )}
          </button>
        ))}
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-text-faint">{total}</span>
    </div>
  )
}

// ─── 2. Correlation scatter ───────────────────────────────────────────────────

interface Dot {
  x: number
  y: number
  name: string
  status: Status
  score: number | null
  reasons: string[]
  attention: boolean
}

function ScatterTip({ active, payload, xOpt, yOpt, t }: {
  active?: boolean
  payload?: { payload: Dot }[]
  xOpt: AxisOpt
  yOpt: AxisOpt
  t: Translate
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--line-strong)',
      borderRadius: 'var(--r-sm)', padding: '8px 10px', boxShadow: 'var(--shadow)',
      fontSize: 12, color: 'var(--text)', maxWidth: 240,
    }}>
      <div style={{ fontWeight: 700 }}>
        {d.name} {d.attention ? '⚑' : ''}
      </div>
      <div style={{ color: 'var(--text-dim)', marginTop: 2 }}>
        {t(xOpt.labelKey)}: <strong>{xOpt.fmt(d.x)}</strong>
        {' · '}
        {t(yOpt.labelKey)}: <strong>{yOpt.fmt(d.y)}</strong>
      </div>
      <div style={{ marginTop: 2 }}>
        {t('kpm.health.status')}: <strong>{t('kpm.health.' + d.status.toLowerCase())}</strong>
        {d.score != null && <> · {t('kpm.health.score')}: <strong>{d.score}</strong></>}
      </div>
      {d.reasons.length > 0 && (
        <div style={{ color: 'var(--text-dim)', marginTop: 2, fontSize: 11 }}>
          {d.reasons.slice(0, 3).join(' · ')}
        </div>
      )}
    </div>
  )
}

// ─── 3. Lowest health scores (DB worst-first order) ──────────────────────────

function WorstUnitBar({ r, colors, onClick }: { r: KpmScopeHealth; colors: Record<Status, string>; onClick: () => void }) {
  const status = (STATUSES as readonly string[]).includes(r.health_status)
    ? (r.health_status as Status) : 'Red'
  const score = Math.max(0, Math.min(100, r.health_score ?? 0))
  return (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2.5 text-left rounded-[6px] px-1 py-0.5 hover:bg-surface-soft transition-colors cursor-pointer">
      <div className="w-[38%] min-w-0 shrink-0">
        <span className="block text-xs font-medium text-text truncate" title={r.unit_name ?? ''}>
          {r.unit_name ?? '—'}
        </span>
        {(r.parent_state || r.parent_pld) && (
          <span className="block text-[10px] text-text-faint truncate">
            {[r.parent_pld, r.parent_state].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex-1 h-3.5 rounded-[4px] bg-surface-soft overflow-hidden">
        <div
          className="h-full rounded-r-[4px]"
          style={{ width: `${score}%`, background: colors[status] }}
        />
      </div>
      <span className="w-8 text-right text-xs tabular-nums font-semibold text-text">{fmtNum(r.health_score)}</span>
      <span className="w-[86px] shrink-0 text-right"><HealthBadge status={r.health_status} /></span>
    </button>
  )
}

// ─── DRILL-DOWN: units at a clicked (level, status) with their reasons ───────

function statusOf(s: string): Status {
  return (STATUSES as readonly string[]).includes(s) ? (s as Status) : 'Red'
}

function HealthUnitsModal({
  level, status, filters, colors, onClose, onPickUnit,
}: {
  level: KpmHealthGroupBy
  status: Status
  filters: ReportFilters
  colors: Record<Status, string>
  onClose: () => void
  onPickUnit: (u: KpmScopeHealth) => void
}) {
  const { t } = useLanguage()
  const { data: units = [], isLoading } = useQuery({
    queryKey: ['kpm-health-drill', level, JSON.stringify(filters)],
    queryFn: () => getKpmScopeHealth(level, filters),
    staleTime: 300_000,
  })
  const rows = units.filter((u) => statusOf(u.health_status) === status)
  const levelLabel = level === 'state' ? t('common.state') : level === 'pld' ? t('common.pld') : t('common.school')

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('kpm.health.' + status.toLowerCase())} · ${levelLabel}`}
      width="min(680px,100%)"
    >
      <p className="text-xs text-text-dim mb-3">
        {t('kpm.health.drillHint', { n: rows.length, status: t('kpm.health.' + status.toLowerCase()), level: levelLabel.toLowerCase() })}
      </p>
      {isLoading ? (
        <div className="py-8 text-center text-text-faint text-sm">{t('common.loading')}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={t('common.noData')} />
      ) : (
        <div className="space-y-2 max-h-[62vh] overflow-y-auto pr-1">
          {rows.map((u) => (
            <button key={u.unit_id} type="button" onClick={() => onPickUnit(u)}
              className="w-full text-left rounded-[var(--r)] border border-line p-3 hover:bg-surface-soft transition-colors cursor-pointer"
              style={{ borderLeft: `3px solid ${colors[status]}` }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm text-text truncate">{u.unit_name ?? '—'}</div>
                  {(u.parent_pld || u.parent_state) && (
                    <div className="text-[11px] text-text-faint truncate">
                      {[u.parent_pld, u.parent_state].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
                <HealthBadge status={u.health_status} />
              </div>

              {/* The "why" — the exact problems the reporting DB flagged. */}
              {u.health_reasons?.length ? (
                <div className="flex flex-wrap gap-1 mt-2">
                  {u.health_reasons.map((r) => (
                    <span key={r} className="text-[11px] px-1.5 py-0.5 rounded bg-surface-soft text-text-dim border border-line">
                      {r}
                    </span>
                  ))}
                </div>
              ) : null}

              {/* Key metrics behind the status. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2.5 text-[11px]">
                <Metric label={t('nav.archers')} value={`${u.active_archers}/${u.registered_archers}`} sub={t('coachDash.activeArchers').toLowerCase()} />
                <Metric label={t('nav.coaches')} value={`${u.active_coaches}`} sub={u.certs_expired || u.certs_expiring_90 ? t('kpm.health.certFlag') : undefined} tone={u.active_coaches === 0 && u.registered_archers > 0 ? 'danger' : undefined} />
                <Metric label={t('common.sessions')} value={`${u.training_sessions}`} />
                <Metric label={t('kpm.common.avgPct')} value={u.avg_score_pct != null ? `${u.avg_score_pct}%` : '—'} />
              </div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'danger' }) {
  return (
    <div>
      <div className="text-text-faint">{label}</div>
      <div className={tone === 'danger' ? 'font-semibold text-danger' : 'font-semibold text-text'}>{value}</div>
      {sub && <div className="text-text-faint">{sub}</div>}
    </div>
  )
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

export function KpmHealthDashboard({ filters }: { filters: ReportFilters }) {
  const { t } = useLanguage()
  const { theme } = useTheme()
  const fkey = JSON.stringify(filters)
  const colors = CHART_STATUS_COLORS[theme === 'dark' ? 'dark' : 'light']
  const surface = SURFACE[theme === 'dark' ? 'dark' : 'light']
  const tickColor = theme === 'dark' ? '#8a8378' : '#8a8178'

  const [level, setLevel] = useState<KpmHealthGroupBy>('school')
  const [drill, setDrill] = useState<{ level: KpmHealthGroupBy; status: Status } | null>(null)
  const [detailUnit, setDetailUnit] = useState<KpmScopeHealth | null>(null)
  const [xKey, setXKey] = useState(X_OPTS[0].value)
  const [yKey, setYKey] = useState(Y_OPTS[0].value)
  const xOpt = X_OPTS.find((o) => o.value === xKey) ?? X_OPTS[0]
  const yOpt = Y_OPTS.find((o) => o.value === yKey) ?? Y_OPTS[0]

  const { data: national = [] } = useQuery({
    queryKey: ['kpm-health-nat', fkey],
    queryFn: () => getKpmNationalHealthSummary(filters),
    staleTime: 300_000,
  })
  const { data: units = [] } = useQuery({
    queryKey: ['kpm-health-units', level, fkey],
    queryFn: () => getKpmScopeHealth(level, filters),
    staleTime: 300_000,
  })

  // Dots for the chosen metric pair — rows missing either value are skipped.
  const dots = useMemo<Record<Status, Dot[]>>(() => {
    const by: Record<Status, Dot[]> = { Green: [], Yellow: [], Red: [] }
    for (const r of units) {
      const x = xOpt.get(r)
      const y = yOpt.get(r)
      if (x == null || y == null) continue
      const status = (STATUSES as readonly string[]).includes(r.health_status)
        ? (r.health_status as Status) : 'Red'
      by[status].push({
        x, y, name: r.unit_name ?? '—', status,
        score: r.health_score, reasons: r.health_reasons ?? [],
        attention: r.needs_attention,
      })
    }
    return by
  }, [units, xOpt, yOpt])
  const dotCount = dots.Green.length + dots.Yellow.length + dots.Red.length

  const flagged = national.reduce((s, r) => s + r.needs_attention, 0)
  const worst = units.slice(0, 8) // RPC returns worst-first

  return (
    <>
      {/* Plain-language legend — what green/yellow/red actually mean */}
      <ExplainBox defaultOpen>
        <p>{t('kpm.explain.healthIntro')}</p>
        <p><StatusWord tone="success">🟢 {t('kpm.health.green')}</StatusWord> — {t('kpm.explain.healthGreen')}</p>
        <p><StatusWord tone="warning">🟡 {t('kpm.health.yellow')}</StatusWord> — {t('kpm.explain.healthYellow')}</p>
        <p><StatusWord tone="danger">🔴 {t('kpm.health.red')}</StatusWord> — {t('kpm.explain.healthRed')}</p>
        <p className="text-text-faint">{t('kpm.explain.healthOutro')}</p>
      </ExplainBox>

      {/* ── 1. Are we green? DB status counts per scope level ── */}
      <SectionCard
        title={t('kpm.health.dashTitle')}
        action={flagged > 0 ? (
          <Badge variant="danger" dot>{t('kpm.health.flaggedUnits', { n: flagged })}</Badge>
        ) : undefined}
        className="mb-6"
      >
        <div className="space-y-2.5">
          {national.map((row) => (
            <StatusStack key={row.scope_type} row={row} colors={colors} t={t}
              onPick={(lvl, status) => setDrill({ level: lvl as KpmHealthGroupBy, status })} />
          ))}
        </div>
        {/* Legend — colour chip + shape glyph + label, never colour alone */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3">
          {STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-text-dim">
              <span aria-hidden style={{
                width: 9, height: 9, background: colors[s], display: 'inline-block',
                borderRadius: STATUS_SHAPE[s] === 'circle' ? '50%' : 2,
                transform: STATUS_SHAPE[s] === 'diamond' ? 'rotate(45deg)' : undefined,
                clipPath: STATUS_SHAPE[s] === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' : undefined,
              }} />
              {t('kpm.health.' + s.toLowerCase())}
            </span>
          ))}
          <span className="text-[11px] text-text-faint ml-auto">{t('kpm.health.clickBarHint')}</span>
        </div>
      </SectionCard>

      {/* ── 2. Correlation explorer ── */}
      <SectionCard title={t('kpm.health.correlationTitle')} className="mb-6">
        <ExplainBox>{t('kpm.explain.correlation')}</ExplainBox>
        {/* Filters in one row above the chart */}
        <div className="flex flex-wrap gap-3 mb-3">
          <div className="w-[150px]">
            <Select label={t('kpm.common.level')} value={level}
              onChange={(e) => setLevel(e.target.value as KpmHealthGroupBy)}
              options={LEVEL_OPTS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
          </div>
          <div className="w-[180px]">
            <Select label={t('kpm.health.xAxis')} value={xKey}
              onChange={(e) => setXKey(e.target.value)}
              options={X_OPTS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
          </div>
          <div className="w-[180px]">
            <Select label={t('kpm.health.yAxis')} value={yKey}
              onChange={(e) => setYKey(e.target.value)}
              options={Y_OPTS.map((o) => ({ value: o.value, label: t(o.labelKey) }))} />
          </div>
        </div>

        {dotCount === 0 ? (
          <p className="text-sm text-text-faint py-8 text-center">{t('kpm.health.noCorrData')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
              <XAxis
                type="number" dataKey="x" name={t(xOpt.labelKey)}
                tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => xOpt.fmt(v)}
              />
              <YAxis
                type="number" dataKey="y" name={t(yOpt.labelKey)}
                tick={{ fontSize: 11, fill: tickColor }} axisLine={false} tickLine={false}
                tickFormatter={(v: number) => yOpt.fmt(v)}
                domain={['auto', 'auto']}
              />
              {/* Zero baseline matters when Y is signed improvement */}
              {yOpt.value === 'avg_improvement_pp' && (
                <ReferenceLine y={0} stroke="var(--line-strong)" />
              )}
              <Tooltip content={<ScatterTip xOpt={xOpt} yOpt={yOpt} t={t} />} cursor={{ stroke: 'var(--line-strong)', strokeDasharray: '4 4' }} />
              {STATUSES.map((s) => (
                <Scatter
                  key={s}
                  name={t('kpm.health.' + s.toLowerCase())}
                  data={dots[s]}
                  fill={colors[s]}
                  stroke={surface}
                  strokeWidth={1.5}
                  shape={STATUS_SHAPE[s]}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        )}

        {/* Legend with counts (shape + colour + text) */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          {STATUSES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-text-dim">
              <span aria-hidden style={{
                width: 9, height: 9, background: colors[s], display: 'inline-block',
                borderRadius: STATUS_SHAPE[s] === 'circle' ? '50%' : 2,
                transform: STATUS_SHAPE[s] === 'diamond' ? 'rotate(45deg)' : undefined,
                clipPath: STATUS_SHAPE[s] === 'triangle' ? 'polygon(50% 0, 100% 100%, 0 100%)' : undefined,
              }} />
              {t('kpm.health.' + s.toLowerCase())} ({dots[s].length})
            </span>
          ))}
        </div>
        <p className="text-[11px] text-text-faint mt-2">{t('kpm.health.correlationNote')}</p>
      </SectionCard>

      {/* ── 3. Lowest health scores — DB worst-first ── */}
      {worst.length > 0 && (
        <SectionCard title={t('kpm.health.worstTitle')} className="mb-6">
          <div className="space-y-2">
            {worst.map((r) => (
              <WorstUnitBar key={r.unit_id} r={r} colors={colors} onClick={() => setDetailUnit(r)} />
            ))}
          </div>
          <p className="text-[11px] text-text-faint mt-3">{t('kpm.health.worstNote')} {t('kpm.health.clickRowHint')}</p>
        </SectionCard>
      )}

      {/* Drill-down: units in the clicked (level, status) with their reasons */}
      {drill && (
        <HealthUnitsModal
          level={drill.level}
          status={drill.status}
          filters={filters}
          colors={colors}
          onClose={() => setDrill(null)}
          onPickUnit={(u) => { setDrill(null); setDetailUnit(u) }}
        />
      )}

      {/* Single-unit detail: score explainer + problems (with fix links) */}
      <HealthUnitDetailModal unit={detailUnit} onClose={() => setDetailUnit(null)} />
    </>
  )
}

export default KpmHealthDashboard

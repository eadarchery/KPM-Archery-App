import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts'
import { formatShort } from '@/utils/dates'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/contexts/LanguageContext'

// ─── SCORE TREND ─────────────────────────────────────────────────────────────

interface ScoreTrendPoint {
  date: string
  score: number
  maxScore: number
  status?: string
  time?: string | null
  label?: string
}

interface ScoreTrendChartProps {
  data: ScoreTrendPoint[]
  height?: number
  showGrid?: boolean
  /** Called with the point's original index when a dot is clicked. */
  onPointClick?: (index: number) => void
  /**
   * Fade dots that are NOT admin-approved (pending/coach/rejected/withdrawn).
   * Use where a nearby metric counts validated scores only, so the plotted
   * points that don't feed that metric read as visually secondary.
   */
  dimUnvalidated?: boolean
}

// Dot colour by submission status — each session is coloured by where it is in
// the validation flow (pending → coach → admin), plus rejected/withdrawn.
export const STATUS_DOT_COLOR: Record<string, string> = {
  pending:        '#d97706',
  coach_approved: '#3d8bff',
  admin_approved: '#16a34a',
  approved:       '#16a34a',
  rejected:       '#e11d48',
  withdrawn:      '#8a8378',
}

// Status → translation key; components resolve via t() so the legend/tooltip
// follow the active language.
const STATUS_LABEL_KEY: Record<string, string> = {
  pending: 'status.pending', coach_approved: 'status.coachApproved', admin_approved: 'status.approved',
  approved: 'status.approved', rejected: 'status.rejected', withdrawn: 'status.withdrawn',
}

function dotColor(status?: string) { return (status && STATUS_DOT_COLOR[status]) || '#ff6a18' }

function SessionTooltip({ active, payload }: { active?: boolean; payload?: { payload: Record<string, unknown> }[] }) {
  const { t } = useLanguage()
  if (!active || !payload?.length) return null
  const p = payload[0].payload as { rawDate: string; time?: string | null; label?: string; score: number; max: number; pct: number; status?: string }
  const status = p.status ?? ''
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-sm)', padding: '8px 10px', boxShadow: 'var(--shadow)', fontSize: 12, color: 'var(--text)' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>
        {new Date(p.rawDate).toLocaleDateString()}{p.time ? ` · ${String(p.time).slice(0, 5)}` : ''}
      </div>
      {p.label && <div style={{ fontWeight: 600 }}>{p.label}</div>}
      <div style={{ fontWeight: 700, fontSize: 14 }}>{p.score}/{p.max} ({p.pct}%)</div>
      <div style={{ color: dotColor(status), fontWeight: 600 }}>{STATUS_LABEL_KEY[status] ? t(STATUS_LABEL_KEY[status]) : status}</div>
    </div>
  )
}

export function ScoreTrendChart({ data, height = 220, showGrid = true, onPointClick, dimUnvalidated = false }: ScoreTrendChartProps) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  const gridColor = theme === 'dark' ? 'rgba(246,243,236,.11)' : 'rgba(26,22,19,.09)'
  const textColor = theme === 'dark' ? '#8a8378' : '#8a8178'

  // Index-based X so multiple sessions on the same day stay distinct points.
  const chartData = data.map((d, i) => ({
    i,
    dateLabel: formatShort(d.date),
    rawDate: d.date,
    time: d.time ?? null,
    pct: d.maxScore ? Math.round((d.score / d.maxScore) * 100) : 0,
    score: d.score,
    max: d.maxScore,
    status: d.status,
    label: d.label,
  }))

  if (!chartData.length) return (
    <div className="flex items-center justify-center h-[220px] text-text-faint text-sm">
      {t('charts.noScoreData')}
    </div>
  )

  const statusesShown = [...new Set(chartData.map((d) => d.status).filter(Boolean) as string[])]

  const renderDot = (props: { cx?: number; cy?: number; index?: number; payload?: { status?: string } }) => {
    const { cx, cy, payload, index } = props
    if (cx == null || cy == null) return <g />
    // Approved scores are the ones an adjacent validated-only metric counts;
    // fade the rest when asked, so the chart and that metric visibly agree.
    const isValidated = payload?.status === 'admin_approved' || payload?.status === 'approved'
    const faded = dimUnvalidated && !isValidated
    return (
      <circle
        cx={cx} cy={cy} r={faded ? 3.5 : 4.5}
        fill={dotColor(payload?.status)}
        fillOpacity={faded ? 0.35 : 1}
        stroke="var(--surface)" strokeWidth={1.5}
        style={{ cursor: onPointClick ? 'pointer' : 'default' }}
        onClick={() => onPointClick?.(index ?? 0)}
      />
    )
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <defs>
            <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ff6a18" stopOpacity={0.18} />
              <stop offset="100%" stopColor="#ff6a18" stopOpacity={0} />
            </linearGradient>
          </defs>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />}
          <XAxis
            dataKey="i"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11, fill: textColor }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => chartData[v]?.dateLabel ?? ''}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: textColor }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip content={<SessionTooltip />} />
          <Area
            type="monotone"
            dataKey="pct"
            stroke="#ff6a18"
            strokeWidth={2}
            fill="url(#scoreGrad)"
            dot={renderDot}
            // The hover activeDot renders ON TOP of the session dot and was
            // swallowing its click — disable it when clicks are wired.
            activeDot={onPointClick ? false : { r: 6 }}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Status legend */}
      {statusesShown.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
          {statusesShown.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-[11px] text-text-dim">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: dotColor(s) }} />
              {STATUS_LABEL_KEY[s] ? t(STATUS_LABEL_KEY[s]) : s}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── ARROWS BAR CHART ────────────────────────────────────────────────────────

interface ArrowsBarData {
  date: string
  arrows: number
  note?: string
}

interface ArrowsBarChartProps {
  data: ArrowsBarData[]
  height?: number
  /** Called with the clicked bar's original bucket date (enables drill-down). */
  onBarClick?: (bucket: string) => void
}

export function ArrowsBarChart({ data, height = 200, onBarClick }: ArrowsBarChartProps) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  const gridColor = theme === 'dark' ? 'rgba(246,243,236,.11)' : 'rgba(26,22,19,.09)'
  const textColor = theme === 'dark' ? '#8a8378' : '#8a8178'

  const chartData = data.map((d) => ({ ...d, rawDate: d.date, date: formatShort(d.date) }))

  if (!chartData.length) return (
    <div className="flex items-center justify-center h-[200px] text-text-faint text-sm">
      {t('charts.noTrainingData')}
    </div>
  )

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: textColor }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: textColor }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={false}
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--text)',
            fontSize: 13,
          }}
          formatter={(v: number) => [`${v} ${t('scoreEntry.arrows')}`, t('trainingLog.arrowsShot')]}
        />
        <Bar
          dataKey="arrows" fill="#ff6a18" radius={[3, 3, 0, 0]} maxBarSize={48}
          activeBar={{ fill: '#ff8a3d', stroke: '#ff6a18' }}
          cursor={onBarClick ? 'pointer' : undefined}
          onClick={(entry: { rawDate?: string }) => { if (onBarClick && entry?.rawDate) onBarClick(entry.rawDate) }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── DISTANCE SERIES CHART (dots + moving average per shooting distance) ─────
// Scores are plotted as % of the round's max (so 300-point and 360-point
// formats are comparable) — or any other per-session value (e.g. group spread
// in cm). One colour per distance; solid line = moving average.

export interface DistancePoint {
  /** Identifies the session (e.g. submission id) for click-through. */
  id?: string
  date: string
  time?: string | null
  /** The session value — score % of max, or spread in cm. */
  value: number
  distance: number | null
}

interface DistanceSeriesChartProps {
  points: DistancePoint[]
  height?: number
  yUnit?: string
  yDomain?: [number, number] | ['auto', 'auto']
  /** Moving-average window (sessions per distance). */
  maWindow?: number
  /** Extra note in the legend, e.g. "↓ lower = tighter group (better)". */
  betterNote?: string
  /** Called with the point's id when a session dot is clicked. */
  onPointClick?: (id: string) => void
}

export function DistanceSeriesChart({
  points, height = 260, yUnit = '%', yDomain = [0, 100], maWindow = 3,
  betterNote, onPointClick,
}: DistanceSeriesChartProps) {
  const { theme } = useTheme()
  const { t } = useLanguage()
  const gridColor = theme === 'dark' ? 'rgba(246,243,236,.11)' : 'rgba(26,22,19,.09)'
  const textColor = theme === 'dark' ? '#8a8378' : '#8a8178'

  // Chronological session order across all distances.
  const ordered = [...points].sort((a, b) =>
    (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')))

  const distances = [...new Set(ordered.map((p) => p.distance ?? -1))].sort((a, b) => a - b)

  // Rows: one per session; each session fills only its own distance column.
  // A per-distance running window fills the moving-average column.
  const windows = new Map<number, number[]>()
  const rows = ordered.map((p, i) => {
    const d = p.distance ?? -1
    const w = windows.get(d) ?? []
    w.push(p.value)
    if (w.length > maWindow) w.shift()
    windows.set(d, w)
    const ma = Math.round((w.reduce((s, v) => s + v, 0) / w.length) * 10) / 10
    return {
      i,
      id: p.id ?? '',
      dateLabel: formatShort(p.date),
      [`v${d}`]: Math.round(p.value * 10) / 10,
      [`ma${d}`]: ma,
    } as Record<string, number | string>
  })

  if (!rows.length) return (
    <div className="flex items-center justify-center h-[220px] text-text-faint text-sm">
      {t('charts.noSessions')}
    </div>
  )

  const distLabel = (d: number) => (d === -1 ? t('charts.noDistance') : `${d}m`)

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="i"
            type="number"
            domain={['dataMin', 'dataMax']}
            tick={{ fontSize: 11, fill: textColor }}
            axisLine={false} tickLine={false}
            tickFormatter={(v: number) => String(rows[v]?.dateLabel ?? '')}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: textColor }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => `${v}${yUnit}`}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--surface)', border: '1px solid var(--line-strong)',
              borderRadius: 'var(--r-sm)', color: 'var(--text)', fontSize: 12,
            }}
            labelFormatter={(v: number) => String(rows[v]?.dateLabel ?? '')}
            formatter={(value: number, name: string) => {
              const d = Number(name.replace(/^(v|ma)/, ''))
              const kind = name.startsWith('ma') ? t('charts.avg') : t('charts.session')
              return [`${value}${yUnit}`, `${distLabel(d)} ${kind}`]
            }}
          />
          {distances.map((d, i) => {
            const color = COLORS[i % COLORS.length]
            const renderDot = (props: { cx?: number; cy?: number; payload?: { id?: string }; value?: unknown }) => {
              const { cx, cy, payload, value } = props
              if (cx == null || cy == null || value == null) return <g />
              return (
                <circle
                  cx={cx} cy={cy} r={onPointClick ? 4.5 : 3.5}
                  fill={color}
                  style={{ cursor: onPointClick && payload?.id ? 'pointer' : 'default' }}
                  onClick={() => { if (payload?.id) onPointClick?.(payload.id) }}
                />
              )
            }
            return [
              // Moving average FIRST so it renders UNDER the dots — at the first
              // session the average equals the value, and a line drawn on top
              // was swallowing that dot's click.
              <Line key={`ma${d}`} dataKey={`ma${d}`} stroke={color} strokeWidth={2}
                dot={false} connectNulls isAnimationActive={false}
                style={{ pointerEvents: 'none' }} />,
              // Raw session dots (no connecting line); clickable when wired
              <Line key={`v${d}`} dataKey={`v${d}`} stroke="none"
                dot={renderDot} activeDot={false}
                isAnimationActive={false} connectNulls={false} />,
            ]
          })}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 px-1">
        {distances.map((d, i) => (
          <span key={d} className="inline-flex items-center gap-1.5 text-[11px] text-text-dim">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
            {distLabel(d)}
          </span>
        ))}
        <span className="text-[11px] text-text-faint ml-auto">
          {betterNote ? <strong className="text-warning mr-2">{betterNote}</strong> : null}
          {t('charts.legendNote', { window: maWindow })}
        </span>
      </div>
    </div>
  )
}

// ─── MULTI-SERIES LINE CHART (for Admin 1 national overview) ─────────────────

interface MultiSeriesPoint {
  date: string
  [key: string]: number | string
}

interface MultiSeriesChartProps {
  data: MultiSeriesPoint[]
  series: { key: string; label: string; color: string }[]
  height?: number
  yLabel?: string
  /** Appended to every value in the hover tooltip (e.g. "%"). */
  valueSuffix?: string
  /** Fixed Y range, e.g. [0, 100] for percentages. */
  yDomain?: [number, number] | ['auto', 'auto']
  /** Called with the clicked point's index (enables click-through drill-downs). */
  onPointClick?: (index: number) => void
}

const COLORS = ['#ff6a18', '#3d8bff', '#16a34a', '#a855f7', '#e11d48', '#0891b2']

export function MultiSeriesChart({ data, series, height = 240, yLabel, valueSuffix = '', yDomain, onPointClick }: MultiSeriesChartProps) {
  const { theme } = useTheme()
  const gridColor = theme === 'dark' ? 'rgba(246,243,236,.11)' : 'rgba(26,22,19,.09)'
  const textColor = theme === 'dark' ? '#8a8378' : '#8a8178'

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
        style={{ cursor: onPointClick ? 'pointer' : undefined }}
        onClick={(state: { activeTooltipIndex?: number } | null) => {
          if (onPointClick && state && typeof state.activeTooltipIndex === 'number') onPointClick(state.activeTooltipIndex)
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: textColor }} axisLine={false} tickLine={false} tickFormatter={formatShort} />
        <YAxis domain={yDomain} tick={{ fontSize: 11, fill: textColor }} axisLine={false} tickLine={false} label={yLabel ? { value: yLabel, angle: -90, position: 'insideLeft', fill: textColor, fontSize: 11 } : undefined} />
        <Tooltip
          contentStyle={{
            background: 'var(--surface)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--r-sm)',
            color: 'var(--text)',
            fontSize: 13,
          }}
          labelFormatter={(v) => formatShort(String(v))}
          formatter={(value: number, name: string) => [`${value}${valueSuffix}`, name]}
        />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            stroke={s.color ?? COLORS[i % COLORS.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 6 }}
            connectNulls
            name={s.label}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

import { type CSSProperties, type ReactNode, useId } from 'react'
import { cn } from '@/utils/cn'

type StatCardTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'neutral'
type StatCardSize = 'sm' | 'md' | 'lg' | 'wide'
type StatCardTrend = 'up' | 'down' | 'flat'

interface StatCardProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  accent?: boolean
  clickable?: boolean
  active?: boolean
  badge?: number
  onClick?: () => void
  className?: string

  /**
   * Optional visual upgrades.
   * All are safe to omit, so old StatCard usages still work.
   */
  tone?: StatCardTone
  size?: StatCardSize
  trend?: StatCardTrend
  trendLabel?: ReactNode
  progressPct?: number | null
  miniChartData?: number[]
  chartSlot?: ReactNode
  description?: ReactNode
  footer?: ReactNode
  loading?: boolean
  interactive?: boolean
  ariaLabel?: string
}

const sizeStyles: Record<StatCardSize, string> = {
  sm: 'p-3 min-h-[92px]',
  md: 'p-4 min-h-[112px]',
  lg: 'p-5 min-h-[142px]',
  wide: 'p-5 min-h-[160px] col-span-2 md:col-span-2',
}

const toneStyles: Record<
  StatCardTone,
  {
    card: string
    label: string
    value: string
    sub: string
    icon: string
    chart: string
    progressTrack: string
    progressFill: string
    aura: CSSProperties['background']
  }
> = {
  default: {
    card: 'bg-surface border-line text-text',
    label: 'text-text-faint',
    value: 'text-text',
    sub: 'text-text-dim',
    icon: 'text-primary',
    chart: 'text-primary',
    progressTrack: 'bg-section',
    progressFill: 'bg-primary',
    aura: 'radial-gradient(circle at top right, var(--primary-soft), transparent 58%)',
  },
  primary: {
    card: 'bg-gradient-to-br from-primary to-primary-hover border-transparent text-white',
    label: 'text-white/75',
    value: 'text-white',
    sub: 'text-white/75',
    icon: 'text-white',
    chart: 'text-white',
    progressTrack: 'bg-white/20',
    progressFill: 'bg-white',
    aura: 'radial-gradient(circle at top right, rgba(255,255,255,0.28), transparent 56%)',
  },
  success: {
    card: 'bg-surface border-success/25 text-text',
    label: 'text-success',
    value: 'text-text',
    sub: 'text-text-dim',
    icon: 'text-success',
    chart: 'text-success',
    progressTrack: 'bg-success-soft',
    progressFill: 'bg-success',
    aura: 'radial-gradient(circle at top right, var(--success-soft), transparent 58%)',
  },
  warning: {
    card: 'bg-surface border-warning/25 text-text',
    label: 'text-warning',
    value: 'text-text',
    sub: 'text-text-dim',
    icon: 'text-warning',
    chart: 'text-warning',
    progressTrack: 'bg-warning-soft',
    progressFill: 'bg-warning',
    aura: 'radial-gradient(circle at top right, var(--warning-soft), transparent 58%)',
  },
  danger: {
    card: 'bg-surface border-danger/25 text-text',
    label: 'text-danger',
    value: 'text-text',
    sub: 'text-text-dim',
    icon: 'text-danger',
    chart: 'text-danger',
    progressTrack: 'bg-danger-soft',
    progressFill: 'bg-danger',
    aura: 'radial-gradient(circle at top right, var(--danger-soft), transparent 58%)',
  },
  neutral: {
    card: 'bg-surface-soft border-line text-text',
    label: 'text-text-faint',
    value: 'text-text',
    sub: 'text-text-dim',
    icon: 'text-text-faint',
    chart: 'text-text-faint',
    progressTrack: 'bg-section',
    progressFill: 'bg-text-dim',
    aura: 'radial-gradient(circle at top right, rgba(138,129,120,0.14), transparent 58%)',
  },
}

function clampPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return null
  return Math.max(0, Math.min(100, value))
}

function TrendPill({
  trend,
  trendLabel,
  accent,
}: {
  trend?: StatCardTrend
  trendLabel?: ReactNode
  accent?: boolean
}) {
  if (!trend && !trendLabel) return null

  const icon = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '▬'

  const tone =
    trend === 'up'
      ? 'bg-success-soft text-success'
      : trend === 'down'
        ? 'bg-danger-soft text-danger'
        : 'bg-section text-text-faint'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.04em]',
        accent ? 'bg-white/15 text-white' : tone,
      )}
    >
      {trend && <span aria-hidden="true">{icon}</span>}
      {trendLabel}
    </span>
  )
}

function MiniSparkline({
  data,
  toneClass,
}: {
  data?: number[]
  toneClass: string
}) {
  const gradientId = useId()
  const clean = (data ?? []).filter((n) => Number.isFinite(n)).slice(-18)

  if (clean.length < 2) return null

  const width = 160
  const height = 42
  const pad = 4

  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const range = max - min || 1

  const points = clean.map((n, i) => {
    const x = pad + (i / (clean.length - 1)) * (width - pad * 2)
    const y = height - pad - ((n - min) / range) * (height - pad * 2)
    return { x, y }
  })

  const line = points
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ')

  const area = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points
    .slice(1)
    .map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' L ')} L ${(width - pad).toFixed(2)} ${(height - pad).toFixed(2)} L ${pad} ${(height - pad).toFixed(2)} Z`

  return (
    <svg
      className={cn('h-11 w-full overflow-visible', toneClass)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.24" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>

      <path d={area} fill={`url(#${gradientId})`} />

      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function LoadingValue() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="h-7 w-24 animate-pulse rounded-md bg-section" />
      <div className="h-3 w-32 animate-pulse rounded-md bg-section" />
    </div>
  )
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  accent = false,
  clickable = false,
  active = false,
  badge,
  onClick,
  className,

  tone = 'default',
  size = 'md',
  trend,
  trendLabel,
  progressPct,
  miniChartData,
  chartSlot,
  description,
  footer,
  loading = false,
  interactive = false,
  ariaLabel,
}: StatCardProps) {
  const isInteractive = Boolean(onClick || clickable || interactive)
  const actualTone: StatCardTone = accent ? 'primary' : tone
  const t = toneStyles[actualTone]
  const pct = clampPct(progressPct)

  const cardClassName = cn(
    'group relative isolate w-full overflow-hidden rounded-[var(--r-lg)] border text-left shadow-card',
    'transition-all duration-200 ease-[var(--ease-out)]',
    sizeStyles[size],
    t.card,
    isInteractive && [
      'cursor-pointer select-none',
      'hover:-translate-y-0.5 hover:shadow-card-lg hover:border-line-strong',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
      'active:scale-[0.985]',
    ],
    active && !accent && 'border-primary shadow-[0_0_0_2px_var(--primary-soft)]',
    className,
  )

  const content = (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-80 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: t.aura }}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/45 to-transparent opacity-50"
      />

      {badge !== undefined && badge > 0 && (
        <span className="absolute right-3 top-3 flex h-[19px] min-w-[19px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white shadow-sm">
          {badge > 99 ? '99+' : badge}
        </span>
      )}

      <div className="relative flex items-start justify-between gap-3 pr-5">
        <div className={cn('text-[11px] font-semibold uppercase tracking-[.06em]', t.label)}>
          {label}
        </div>

        <TrendPill
          trend={trend}
          trendLabel={trendLabel}
          accent={actualTone === 'primary'}
        />
      </div>

      <div className="relative mt-2 flex items-end justify-between gap-3">
        <div
          className={cn(
            'min-w-0 font-display text-[28px] font-semibold leading-none tabular-nums',
            size === 'lg' && 'text-[34px]',
            t.value,
          )}
        >
          {loading ? <LoadingValue /> : value}
        </div>

        {icon && (
          <div
            className={cn(
              'shrink-0 opacity-25 transition-all duration-200 group-hover:scale-110 group-hover:opacity-40',
              t.icon,
            )}
          >
            {icon}
          </div>
        )}
      </div>

      {description && (
        <div className={cn('mt-2 text-xs leading-snug', t.sub)}>
          {description}
        </div>
      )}

      {sub && !loading && (
        <div className={cn('mt-1.5 text-xs leading-snug', t.sub)}>
          {sub}
        </div>
      )}

      {pct !== null && (
        <div className="mt-4" aria-hidden="true">
          <div className={cn('h-2 overflow-hidden rounded-full', t.progressTrack)}>
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500 ease-[var(--ease-out)]',
                t.progressFill,
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {miniChartData && miniChartData.length >= 2 && (
        <div className="mt-3">
          <MiniSparkline data={miniChartData} toneClass={t.chart} />
        </div>
      )}

      {chartSlot && (
        <div className="mt-4 min-h-[140px]">
          {chartSlot}
        </div>
      )}

      {footer && (
        <div
          className={cn(
            'mt-4 border-t pt-3 text-xs',
            actualTone === 'primary'
              ? 'border-white/15 text-white/75'
              : 'border-line text-text-dim',
          )}
        >
          {footer}
        </div>
      )}
    </>
  )

  if (isInteractive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? label}
        className={cardClassName}
      >
        {content}
      </button>
    )
  }

  return (
    <div aria-label={ariaLabel} className={cardClassName}>
      {content}
    </div>
  )
}

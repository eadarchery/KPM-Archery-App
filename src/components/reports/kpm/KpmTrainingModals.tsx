import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import { getKpmTrainingBreakdown, type KpmTrainingGroupBy } from '@/services/kpmMetrics'
import { fmtNum, groupRowLabel } from './shared'

/**
 * Training-tab card drill-down. Each headline card opens this with a plain
 * explanation of how the number is built plus its OWN relative data — the same
 * metric broken down month-by-month (from the training trend already fetched).
 * Coaches has no monthly series, so it shows the explanation only.
 */

export type TrainingSeriesPoint = { bucket: string; value: number }

const monthLabel = (bucket: string) =>
  new Date(bucket).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

// One colour per month row (cycles for longer ranges).
const BAR_COLORS = ['#ff6a18', '#3d8bff', '#16a34a', '#a855f7', '#e11d48', '#0891b2', '#f59e0b', '#14b8a6']

/** First and last calendar day of the month a bucket date falls in. */
function monthRange(bucket: string): { start: string; end: string } {
  const [y, m] = bucket.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const p = (n: number) => String(n).padStart(2, '0')
  return { start: `${y}-${p(m)}-01`, end: `${y}-${p(m)}-${p(last)}` }
}

export function TrainingCardModal({
  pick, onClose,
}: {
  pick: {
    title: string
    value: ReactNode
    howKey: string
    seriesLabel?: string
    series?: TrainingSeriesPoint[]
    noteKey?: string
  } | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (!pick) return null

  const max = Math.max(1, ...(pick.series ?? []).map((p) => p.value))

  return (
    <Modal open onClose={onClose} title={pick.title} width="min(560px,100%)">
      <div className="font-display font-bold text-3xl text-primary tabular-nums mb-2">{pick.value}</div>
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-4">
        <span aria-hidden>💡 </span>{t(pick.howKey)}
      </p>

      {pick.series && pick.series.length > 0 ? (
        <>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">
            {pick.seriesLabel ?? t('kpm.training.byMonth')}
          </h4>
          <div className="space-y-1.5">
            {pick.series.map((p, i) => (
              <div key={p.bucket} className="flex items-center gap-3">
                <span className="w-20 shrink-0 text-xs text-text-dim">{monthLabel(p.bucket)}</span>
                <span className="flex-1 h-4 rounded-[5px] bg-surface-soft overflow-hidden">
                  <span className="block h-full rounded-[5px]" style={{ width: `${Math.max(2, (p.value / max) * 100)}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                </span>
                <span className="w-16 text-right text-sm tabular-nums font-semibold text-text">{fmtNum(p.value)}</span>
              </div>
            ))}
          </div>
        </>
      ) : pick.noteKey ? (
        <p className="text-[12px] text-text-faint">{t(pick.noteKey)}</p>
      ) : null}
    </Modal>
  )
}

// ─── Clicking a month bar → that month's arrows by state / PLD / school ────────

const SCOPE_OPTS: { value: KpmTrainingGroupBy; labelKey: string }[] = [
  { value: 'state',  labelKey: 'common.state' },
  { value: 'pld',    labelKey: 'common.pld' },
  { value: 'school', labelKey: 'common.school' },
]

export function ArrowsMonthModal({
  bucket, filters, onClose,
}: {
  bucket: string | null
  filters: ReportFilters
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [scope, setScope] = useState<KpmTrainingGroupBy>('state')

  // Scope the training breakdown to the clicked month only.
  const monthFilters = useMemo<ReportFilters>(() => {
    if (!bucket) return filters
    const { start, end } = monthRange(bucket)
    return { ...filters, startDate: start, endDate: end }
  }, [bucket, filters])

  const { data: rows = [], isFetching, error } = useQuery({
    queryKey: ['kpm-arrows-month', bucket, scope, JSON.stringify(filters)],
    queryFn: () => getKpmTrainingBreakdown(scope, monthFilters),
    staleTime: 120_000,
    enabled: bucket != null,
  })

  if (!bucket) return null

  const sorted = [...rows].sort((a, b) => b.arrows - a.arrows)
  const totalArrows = sorted.reduce((sum, r) => sum + (r.arrows ?? 0), 0)
  const max = Math.max(1, ...sorted.map((r) => r.arrows))
  const title = new Date(bucket).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <Modal open onClose={onClose} title={`${title} · ${t('kpm.training.totalArrows')}`} width="min(620px,100%)">
      {/* Month total */}
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-display font-bold text-3xl text-primary tabular-nums">{fmtNum(totalArrows)}</span>
        <span className="text-xs text-text-faint">{t('kpm.training.totalArrows').toLowerCase()}</span>
      </div>

      {/* Scope selector */}
      <div className="max-w-[220px] mb-3">
        <Select
          label={t('kpm.common.level')}
          value={scope}
          onChange={(e) => setScope(e.target.value as KpmTrainingGroupBy)}
          options={SCOPE_OPTS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        />
      </div>

      {error != null ? (
        <p className="text-sm text-danger bg-danger-soft/30 rounded-[var(--r-sm)] px-3 py-2">{(error as Error).message}</p>
      ) : isFetching ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.loading')}</p>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('kpm.training.noData')}</p>
      ) : (
        <div className="space-y-1.5 max-h-[52vh] overflow-y-auto -mx-1 px-1">
          {sorted.map((r, i) => (
            <div key={r.group_key ?? r.group_label ?? i} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs text-text truncate" title={groupRowLabel(t, scope, r.group_label ?? r.group_key)}>
                {groupRowLabel(t, scope, r.group_label ?? r.group_key)}
              </span>
              <span className="flex-1 h-4 rounded-[5px] bg-surface-soft overflow-hidden">
                <span className="block h-full rounded-[5px]" style={{ width: `${Math.max(2, (r.arrows / max) * 100)}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
              </span>
              <span className="w-16 text-right text-sm tabular-nums font-semibold text-text">{fmtNum(r.arrows)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-text-faint mt-3">{t('kpm.training.monthScopeHint')}</p>
    </Modal>
  )
}

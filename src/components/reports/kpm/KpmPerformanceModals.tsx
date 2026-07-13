import { useMemo, type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import type { KpmNormalisedScore } from '@/services/kpmMetrics'
import { fmtPct, ShowingNote } from './shared'

/**
 * Two small pop-ups for the Performance tab:
 *  • PerfMetricModal   — explains how a headline metric card is calculated.
 *  • ScoresListModal   — "pinpoints" the actual submissions behind a
 *                        verification-funnel count (Submitted / Verified /
 *                        Coach approved / Pending / Rejected).
 */

// ─── Metric explainer ────────────────────────────────────────────────────────

export function PerfMetricModal({
  metric, onClose,
}: {
  metric: { title: string; value: ReactNode; howKey: string } | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (!metric) return null
  return (
    <Modal open onClose={onClose} title={metric.title} width="min(480px,100%)">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-display font-bold text-3xl text-primary tabular-nums">{metric.value}</span>
      </div>
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5">
        <span aria-hidden>💡 </span>{t(metric.howKey)}
      </p>
    </Modal>
  )
}

// ─── Funnel status drill-down ────────────────────────────────────────────────

const STATUS_VARIANT: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'neutral'> = {
  admin_approved: 'success', approved: 'success', coach_approved: 'primary',
  pending: 'warning', rejected: 'danger', withdrawn: 'neutral',
}
const STATUS_LABEL_KEY: Record<string, string> = {
  admin_approved: 'status.approved', approved: 'status.approved', coach_approved: 'status.coachApproved',
  pending: 'status.pending', rejected: 'status.rejected', withdrawn: 'status.withdrawn',
}

function StatusPill({ status }: { status: string }) {
  const { t } = useLanguage()
  const key = STATUS_LABEL_KEY[status]
  return <Badge variant={STATUS_VARIANT[status] ?? 'neutral'}>{key ? t(key) : status}</Badge>
}

const LIST_LIMIT = 100

// ─── Monthly trend detail (who scored highest + how avg/median were built) ────

/** percentile_cont(0.5) — matches how the DB computes the median line. */
function medianIndices(n: number): number[] {
  if (n === 0) return []
  return n % 2 ? [(n - 1) / 2] : [n / 2 - 1, n / 2]
}

export function TrendMonthModal({
  month, scores, loading, onClose,
}: {
  month: { bucket: string; avg: number | null; median: number | null; best: number | null } | null
  scores: KpmNormalisedScore[]
  loading?: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()

  // Approved scores in the clicked month (the trend line uses approved only),
  // strongest first — so row 0 is the highest scorer.
  const rows = useMemo(() => {
    if (!month) return []
    const ym = month.bucket.slice(0, 7)
    return scores
      .filter((s) => s.status === 'admin_approved' && (s.date ?? '').slice(0, 7) === ym && s.score_pct != null)
      .sort((a, b) => (b.score_pct ?? 0) - (a.score_pct ?? 0))
  }, [month, scores])

  if (!month) return null

  const n = rows.length
  const top = rows[0]
  const medIdx = new Set(medianIndices(n))
  const title = new Date(month.bucket).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <Modal open onClose={onClose} title={title} width="min(720px,100%)">
      {/* Headline numbers straight from the trend line */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <HeadStat label={t('kpm.common.avgPct')} value={fmtPct(month.avg)} color="#ff6a18" />
        <HeadStat label={t('kpm.performance.medianPct')} value={fmtPct(month.median)} color="#3d8bff" />
        <HeadStat label={t('kpm.common.bestPct')} value={fmtPct(month.best)} color="#16a34a" />
      </div>

      {loading ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.loading')}</p>
      ) : n === 0 ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.noData')}</p>
      ) : (
        <>
          {/* Who scored the highest */}
          {top && (
            <div className="rounded-[var(--r-sm)] border border-success/40 bg-success-soft/25 p-3 mb-4">
              <div className="text-[10px] uppercase tracking-wide text-text-faint mb-1">🏆 {t('kpm.performance.highestScorer')}</div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text truncate">
                    {top.archer_name ?? '—'}
                    {top.archer_code && <span className="text-text-faint text-xs ml-1.5">{top.archer_code}</span>}
                  </div>
                  <div className="text-[11px] text-text-dim truncate">
                    {top.round_name ?? '—'}{top.distance_m ? ` · ${top.distance_m}m` : ''}
                    {[top.school, top.state].filter(Boolean).length ? ` · ${[top.school, top.state].filter(Boolean).join(' · ')}` : ''}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-display font-bold text-2xl text-success leading-none">{fmtPct(top.score_pct)}</div>
                  <div className="text-[11px] text-text-faint tabular-nums">{top.total_score}/{top.eff_max_score}</div>
                </div>
              </div>
            </div>
          )}

          {/* How avg & median were built */}
          <p className="text-[12px] text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-3">
            <span aria-hidden>💡 </span>{t('kpm.performance.howAvgMedian', { n })}
          </p>

          <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">
            {t('kpm.performance.approvedScores')} ({n})
          </h4>
          <div className="space-y-1 max-h-[42vh] overflow-y-auto -mx-1 px-1">
            {rows.slice(0, LIST_LIMIT).map((s, i) => {
              const isMedian = medIdx.has(i)
              const isTop = i === 0
              return (
                <div
                  key={s.score_id}
                  className={
                    'rounded-[var(--r-sm)] border p-2 flex items-center justify-between gap-3 ' +
                    (isMedian ? '' : isTop ? 'border-success/40' : 'border-line')
                  }
                  style={isMedian ? { borderColor: '#3d8bff', background: 'rgba(61,139,255,0.12)' } : undefined}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-[11px] tabular-nums text-text-faint w-5 shrink-0">{i + 1}</span>
                    <span className="text-sm text-text truncate">{s.archer_name ?? '—'}</span>
                    {isTop && <span className="text-[10px] text-success shrink-0">🏆</span>}
                    {isMedian && <span className="text-[10px] font-semibold shrink-0" style={{ color: '#3d8bff' }}>← {t('kpm.performance.medianPct')}</span>}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-text shrink-0">{fmtPct(s.score_pct)}</span>
                </div>
              )
            })}
          </div>
          <ShowingNote shown={Math.min(LIST_LIMIT, n)} total={n} />
        </>
      )}
    </Modal>
  )
}

function HeadStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-[var(--r-sm)] border border-line p-2.5 text-center">
      <div className="font-display font-bold text-xl tabular-nums" style={{ color }}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-faint mt-0.5">{label}</div>
    </div>
  )
}

export function ScoresListModal({
  pick, scores, loading, onClose,
}: {
  /** status = null → all submissions; otherwise filter to that status. */
  pick: { status: string | null; title: string; explainKey: string } | null
  scores: KpmNormalisedScore[]
  loading?: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()

  const rows = useMemo(() => {
    if (!pick) return []
    return pick.status == null ? scores : scores.filter((s) => s.status === pick.status)
  }, [pick, scores])

  if (!pick) return null

  return (
    <Modal open onClose={onClose} title={pick.title} width="min(760px,100%)">
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-3">
        <span aria-hidden>💡 </span>{t(pick.explainKey)}
      </p>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">
        {t('kpm.performance.matchingScores')} ({rows.length})
      </h4>

      {loading ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">
          {t('common.loading')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">
          {t('common.noData')}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[58vh] overflow-y-auto -mx-1 px-1">
          {rows.slice(0, LIST_LIMIT).map((s) => {
            const where = [s.school, s.pld, s.state].filter(Boolean).join(' · ')
            return (
              <div key={s.score_id} className="rounded-[var(--r-sm)] border border-line p-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text truncate">
                    {s.archer_name ?? '—'}
                    {s.archer_code && <span className="text-text-faint text-xs ml-1.5">{s.archer_code}</span>}
                  </div>
                  <div className="text-[11px] text-text-dim mt-0.5 truncate">
                    {s.round_name ?? '—'}
                    {s.distance_m ? ` · ${s.distance_m}m` : ''}
                    {' · '}
                    <span className="tabular-nums">{s.total_score ?? '—'}/{s.eff_max_score ?? '—'} ({fmtPct(s.score_pct)})</span>
                  </div>
                  <div className="text-[11px] text-text-faint mt-0.5 truncate">
                    {s.date ? new Date(s.date).toLocaleDateString() : '—'}
                    {where ? ` · ${where}` : ''}
                    {s.coach_name ? ` · ${s.coach_name}` : ''}
                  </div>
                </div>
                <div className="shrink-0"><StatusPill status={s.status} /></div>
              </div>
            )
          })}
        </div>
      )}
      <ShowingNote shown={Math.min(LIST_LIMIT, rows.length)} total={rows.length} />
    </Modal>
  )
}

import { SessionPlotView } from './SessionPlotView'
import { SubmissionStatusBadge } from '@/components/ui/Badge'
import { useLanguage } from '@/contexts/LanguageContext'
import type { PlotData } from '@/utils/archery'
import type { SubmissionStatus } from '@/types'

/**
 * Session detail popup body — shared by the Score trend, Score by distance and
 * Group spread charts. Shows the round context, the END-BY-END score breakdown
 * (from arrows_data), the archer's session notes, and — when the session was
 * plotted — the arrow pattern with the spread explanation.
 */

export interface SessionDetailData {
  date: string
  time?: string | null
  roundName?: string | null
  distanceM?: number | null
  totalScore: number
  maxScore: number
  status?: string | null
  notes?: string | null
  arrowsData?: (string | number)[] | null
  arrowsPerEnd?: number | null
  plot?: PlotData | null
}

function arrowValue(v: string | number): number {
  if (v === 'M') return 0
  if (v === 'X') return 10
  return Number(v) || 0
}

export function SessionDetailContent({ s }: { s: SessionDetailData }) {
  const { t } = useLanguage()
  const arrows = Array.isArray(s.arrowsData) ? s.arrowsData : null
  // End size: the round's format, else the archery convention (6, or 3 for
  // totals that only divide by 3).
  const ape = s.arrowsPerEnd
    ?? (arrows && arrows.length % 6 === 0 ? 6 : arrows && arrows.length % 3 === 0 ? 3 : null)

  const ends: (string | number)[][] = []
  if (arrows && ape && ape > 0) {
    for (let i = 0; i < arrows.length; i += ape) ends.push(arrows.slice(i, i + ape))
  }

  return (
    <div className="space-y-4">
      {/* Header facts */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="font-semibold text-sm text-text">
            {s.roundName ?? t('common.round')}
            {s.distanceM != null && <span className="text-text-dim font-normal"> · {s.distanceM}m</span>}
          </p>
          <p className="text-xs text-text-faint">
            {s.time ? t('sessionDetail.sessionAt', { time: String(s.time).slice(0, 5) }) : t('sessionDetail.session')}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display font-bold text-xl text-text">{s.totalScore}/{s.maxScore}</p>
          {s.status && <SubmissionStatusBadge status={s.status as SubmissionStatus} />}
        </div>
      </div>

      {/* End-by-end breakdown */}
      {ends.length > 0 ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-1.5">
            {t('sessionDetail.scoreByEnd')}
          </p>
          <div className="space-y-1">
            {ends.map((end, e) => (
              <div key={e} className="flex items-center gap-2 rounded-[8px] bg-surface-soft px-2 py-1">
                <span className="text-xs font-semibold text-text-dim w-12 shrink-0">{t('plotter.end')} {e + 1}</span>
                <div className="flex flex-wrap gap-1 flex-1">
                  {end.map((v, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded-[6px] text-xs font-mono font-bold border bg-surface border-line text-text-dim">
                      {String(v)}
                    </span>
                  ))}
                </div>
                <span className="text-xs font-bold text-text shrink-0">
                  = {end.reduce((sum: number, v) => sum + arrowValue(v), 0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-faint">
          {t('sessionDetail.noPerArrow')}
        </p>
      )}

      {/* Session notes */}
      {s.notes && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-1">
            {t('sessionDetail.sessionNotes')}
          </p>
          <p className="text-sm text-text-dim bg-surface-soft rounded-[8px] px-3 py-2 whitespace-pre-wrap">
            {s.notes}
          </p>
        </div>
      )}

      {/* Arrow pattern + spread explanation (plotted sessions only) */}
      {s.plot?.arrows?.length ? (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-1.5">
            {t('sessionDetail.arrowPattern')}
          </p>
          <SessionPlotView plot={s.plot} />
        </div>
      ) : null}
    </div>
  )
}

import { useState } from 'react'
import { cn } from '@/utils/cn'
import { useLanguage } from '@/contexts/LanguageContext'
import { Modal } from '@/components/ui/Modal'
import type { ValidationSummary as VSummary } from '@/services/reports'

interface Tile {
  key: string
  label: string
  value: number
  tone: 'warning' | 'primary' | 'success' | 'danger'
  explainKey: string
}

/** Compact 4-tile validation status overview (pending → approved → rejected).
 *  Each tile is clickable and explains what it represents. */
export function ValidationSummary({ data }: { data: VSummary }) {
  const { t } = useLanguage()
  const [pick, setPick] = useState<Tile | null>(null)

  const tiles: Tile[] = [
    { key: 'pendingTraining',   label: t('validationSummary.pendingTraining'),   value: data.pendingTraining,   tone: 'warning', explainKey: 'validationSummary.explain.pendingTraining' },
    { key: 'pendingTournament', label: t('validationSummary.pendingTournament'), value: data.pendingTournament, tone: 'primary', explainKey: 'validationSummary.explain.pendingTournament' },
    { key: 'approved',          label: t('status.approved'),                     value: data.approved,          tone: 'success', explainKey: 'validationSummary.explain.approved' },
    { key: 'rejected',          label: t('status.rejected'),                     value: data.rejected,          tone: 'danger',  explainKey: 'validationSummary.explain.rejected' },
  ]

  const toneClass: Record<Tile['tone'], string> = {
    warning: 'text-warning',
    primary: 'text-primary',
    success: 'text-success',
    danger:  'text-danger',
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {tiles.map((tile) => (
          <button
            key={tile.key}
            type="button"
            onClick={() => setPick(tile)}
            className="rounded-[var(--r)] border border-line bg-surface p-4 text-center transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <div className={cn('font-display font-semibold text-[28px] leading-none', toneClass[tile.tone])}>
              {tile.value}
            </div>
            <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-text-faint mt-2">
              {tile.label}
            </div>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-text-faint mt-2">{t('validationSummary.clickHint')}</p>

      {pick && (
        <Modal open onClose={() => setPick(null)} title={pick.label} width="min(460px,100%)">
          <div className={cn('font-display font-bold text-3xl tabular-nums mb-3', toneClass[pick.tone])}>{pick.value}</div>
          <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5">
            <span aria-hidden>💡 </span>{t(pick.explainKey)}
          </p>
        </Modal>
      )}
    </>
  )
}

export default ValidationSummary

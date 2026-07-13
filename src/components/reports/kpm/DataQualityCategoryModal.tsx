import { useMemo } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useLanguage } from '@/contexts/LanguageContext'
import type { KpmDataQualityIssue, KpmDqCategory } from '@/services/kpmMetrics'
import { SeverityBadge, dqCategoryLabel, issueTypeLabel } from './shared'

/**
 * Opened by clicking a Data-Quality completeness card. It answers two things a
 * percentage alone can't:
 *   • what does this metric actually measure? (plain-language "meaning" line)
 *   • which specific entities are incomplete? (the filtered issue list —
 *     e.g. click "Equipment completeness" to see exactly who has no equipment).
 *
 * All issues are already fetched by the section; here we only filter the list
 * client-side by category. 'overall' shows every issue.
 */

export type DqCardKey = KpmDqCategory | 'overall'

const PCT_COLOR = (p: number | null) =>
  p == null ? 'var(--text-faint)' : p >= 90 ? 'var(--success)' : p >= 60 ? 'var(--warning)' : 'var(--danger)'

export function DataQualityCategoryModal({
  pick, pct, issues, onClose,
}: {
  pick: DqCardKey | null
  pct: number | null
  issues: KpmDataQualityIssue[]
  onClose: () => void
}) {
  const { t } = useLanguage()

  const rows = useMemo(() => {
    if (!pick) return []
    return pick === 'overall' ? issues : issues.filter((i) => i.category === pick)
  }, [pick, issues])

  if (!pick) return null

  const title = pick === 'overall' ? t('kpm.dq.overall') : dqCategoryLabel(t, pick)

  return (
    <Modal open onClose={onClose} title={title} width="min(640px,100%)">
      {/* Completeness headline + what it measures */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="text-[12px] text-text-dim leading-relaxed flex-1">
          <span aria-hidden>💡 </span>{t(`kpm.dq.meaning.${pick}`)}
        </p>
        <div className="text-right shrink-0">
          <div className="font-display font-bold text-3xl leading-none" style={{ color: PCT_COLOR(pct) }}>
            {pct == null ? '—' : `${Math.round(pct)}%`}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-text-faint mt-0.5">{t('kpm.dq.complete')}</div>
        </div>
      </div>

      {/* Who / what is incomplete */}
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">
        {t('kpm.dq.needsAttention')} ({rows.length})
      </h4>

      {rows.length === 0 ? (
        <p className="text-sm text-success bg-success-soft rounded-[var(--r-sm)] px-3 py-2">
          ✓ {t('kpm.dq.noIssues')}
        </p>
      ) : (
        <div className="space-y-1.5 max-h-[52vh] overflow-y-auto -mx-1 px-1">
          {rows.map((r) => {
            const where = [r.school, r.pld, r.state].filter(Boolean).join(' · ')
            return (
              <div
                key={`${r.entity_id}-${r.issue_type}`}
                className="rounded-[var(--r-sm)] border border-line p-2.5 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text truncate">{r.entity_label ?? '—'}</div>
                  <div className="text-[11px] text-text-dim mt-0.5">
                    {issueTypeLabel(t, r.issue_type, r.issue_message)}
                  </div>
                  {where && <div className="text-[11px] text-text-faint mt-0.5 truncate">{where}</div>}
                </div>
                <div className="shrink-0"><SeverityBadge severity={r.severity} /></div>
              </div>
            )
          })}
        </div>
      )}
    </Modal>
  )
}

export default DataQualityCategoryModal

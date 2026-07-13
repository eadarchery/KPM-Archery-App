import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  getKpmTalentConfig, KPM_TALENT_CONFIG_DEFAULTS,
  type KpmTalentCandidate, type KpmTalentConfig,
} from '@/services/kpmMetrics'
import { fmtPct, fmtPp, bandLabel, talentReasonLabel } from './shared'

/**
 * Zoom-in for a single talent candidate, opened by clicking a reason chip in
 * the candidate list. It explains WHY the archer earned each talent flag using
 * their own numbers against the migration-066 thresholds, and highlights the
 * metric behind the reason the user clicked.
 *
 * `focusReason` is the chip that was clicked (highlighted first); null opens
 * the full picture (e.g. from the "+N more" chip).
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** Which stat a reason is "about" — used to highlight the right metric card. */
type MetricKey = 'best' | 'improvement' | 'consistency' | 'tournament' | 'exposure' | 'band' | 'achievement'

/** Builds a plain-language "why" line for a reason from the archer's numbers
 *  and the live rating thresholds (so the text always matches how flags fire). */
function reasonDetail(t: Translate, r: string, c: KpmTalentCandidate, cfg: KpmTalentConfig): { metric: MetricKey; text: string } {
  const best = fmtPct(c.best_pct)
  const imp = fmtPp(c.improvement_pp)
  switch (r) {
    case 'Top Performer':
      return { metric: 'best', text: t('kpm.reasonWhy.topPerformer', { best, min: cfg.top_performer_min_pct }) }
    case 'Fast Improver':
      return { metric: 'improvement', text: t('kpm.reasonWhy.fastImprover', { imp, n: c.score_count, minPp: cfg.fast_improver_min_pp }) }
    case 'Consistent Archer':
      return { metric: 'consistency', text: t('kpm.reasonWhy.consistentArcher', { consistency: c.consistency_score ?? '—', n: c.score_count, avg: fmtPct(c.avg_pct), minC: cfg.consistent_min_consistency, minAvg: cfg.consistent_min_avg_pct, minN: cfg.consistent_min_scores }) }
    case 'Tournament Ready':
      return { metric: 'tournament', text: t('kpm.reasonWhy.tournamentReady', { best: fmtPct(c.best_tournament_pct), n: c.tournament_count, min: cfg.tournament_ready_min_pct }) }
    case 'Hidden Talent':
      return { metric: 'exposure', text: t('kpm.reasonWhy.hiddenTalent', { best, n: c.score_count }) }
    case 'Band Promotion':
      return { metric: 'band', text: t('kpm.reasonWhy.bandPromotion', { band: bandLabel(t, c.current_band) }) }
    case 'Achievement Milestone':
      return { metric: 'achievement', text: t('kpm.reasonWhy.achievementMilestone') }
    default:
      return { metric: 'best', text: '' }
  }
}

export function ArcherTalentModal({
  archer, focusReason, onClose,
}: {
  archer: KpmTalentCandidate | null
  focusReason: string | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  const { data: cfg = KPM_TALENT_CONFIG_DEFAULTS } = useQuery({
    queryKey: ['kpm-talent-config'],
    queryFn: getKpmTalentConfig,
    staleTime: 300_000,
  })
  if (!archer) return null

  const reasons = archer.talent_reasons ?? []
  // Clicked reason first, then the rest.
  const ordered = focusReason
    ? [focusReason, ...reasons.filter((r) => r !== focusReason)]
    : reasons
  const focusMetric = focusReason ? reasonDetail(t, focusReason, archer, cfg).metric : null

  const where = [archer.school, archer.pld, archer.state].filter(Boolean).join(' · ')

  return (
    <Modal open onClose={onClose} title={archer.archer_name ?? t('roles.archer')} width="min(560px,100%)">
      {/* Identity */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          {archer.archer_code && <p className="text-xs text-text-faint">{archer.archer_code}</p>}
          {where && <p className="text-sm text-text-dim truncate">{where}</p>}
          <div className="mt-1"><Badge variant="neutral">{bandLabel(t, archer.current_band)}</Badge></div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display font-bold text-3xl leading-none text-primary">{fmtPct(archer.best_pct)}</div>
          <div className="text-[10px] uppercase tracking-wide text-text-faint mt-0.5">{t('kpm.common.bestPct')}</div>
        </div>
      </div>

      {/* Metric cards — the one behind the clicked reason is highlighted */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <MetricCard k="best"        active={focusMetric === 'best'}        label={t('kpm.common.bestPct')}         value={fmtPct(archer.best_pct)} />
        <MetricCard k="improvement" active={focusMetric === 'improvement'} label={t('overview.improvement')}       value={fmtPp(archer.improvement_pp)} />
        <MetricCard k="consistency" active={focusMetric === 'consistency'} label={t('kpm.talent.consistency')}     value={archer.consistency_score != null ? `${archer.consistency_score}` : '—'} />
        <MetricCard k="tournament"  active={focusMetric === 'tournament'}  label={t('kpm.talent.bestTournamentPct')} value={fmtPct(archer.best_tournament_pct)} />
        <MetricCard k="exposure"    active={focusMetric === 'exposure'}    label={t('kpm.talent.scoreCount')}      value={`${archer.score_count}`} />
        <MetricCard k="tournament"  active={false}                         label={t('kpm.talent.tournaments')}     value={`${archer.tournament_count}`} />
      </div>

      {/* Why each flag was earned */}
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">{t('kpm.talent.whyFlagged')}</h4>
      <div className="space-y-2">
        {ordered.map((r) => {
          const { text } = reasonDetail(t, r, archer, cfg)
          const isFocus = r === focusReason
          return (
            <div
              key={r}
              className={
                'rounded-[var(--r-sm)] border p-2.5 ' +
                (isFocus ? 'border-primary bg-primary-soft/40 border-l-[3px] border-l-primary' : 'border-line')
              }
            >
              <Badge variant="primary">{talentReasonLabel(t, r)}</Badge>
              {text && <p className="text-[11px] text-text-dim leading-relaxed mt-1.5">{text}</p>}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function MetricCard({ active, label, value, sub }: { k: MetricKey; active: boolean; label: string; value: string; sub?: string }) {
  return (
    <div
      className={
        'rounded-[var(--r-sm)] border p-2 ' +
        (active ? 'border-primary bg-primary-soft/40 shadow-[0_0_0_1px_var(--primary)]' : 'border-line')
      }
    >
      <div className="text-[10px] uppercase tracking-wide text-text-faint">{label}</div>
      <div className={'font-semibold tabular-nums ' + (active ? 'text-primary' : 'text-text')}>{value}</div>
      {sub && <div className="text-[10px] text-text-faint">{sub}</div>}
    </div>
  )
}

export default ArcherTalentModal

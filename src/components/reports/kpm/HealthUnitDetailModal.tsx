import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { useAuth } from '@/hooks/useAuth'
import { isOperationalAdmin } from '@/lib/permissions'
import type { KpmScopeHealth } from '@/services/kpmMetrics'
import { HealthBadge } from './shared'

/**
 * Single-unit health detail — opened from the "Lowest health scores" bars and
 * the "Unit Health" table. It turns the raw reasons into plain guidance:
 *   • explains how the 0–100 health score is built (migration 067 formula),
 *   • splits reasons into Problems (with what-to-do + a jump-to-fix button
 *     where one exists) and Strengths (the positive reasons),
 *   • shows the key numbers behind the status.
 *
 * "Fix" buttons only appear for reasons with a real destination, and only for
 * Admin 2 / Super Admin (Admin 1 can't reach those admin pages).
 */

const SCORE_COLOR = (s: number | null) =>
  s == null ? 'var(--text-faint)' : s >= 80 ? 'var(--success)' : s >= 60 ? 'var(--warning)' : 'var(--danger)'

/** Reason string (from the DB) → how to treat it. */
type ReasonMeta = { kind: 'problem' | 'good'; guideKey?: string; fixPath?: string; fixKey?: string }
const REASON_META: Record<string, ReasonMeta> = {
  'No recent activity':      { kind: 'problem', guideKey: 'kpm.reasonGuide.noRecentActivity' },
  'Low active archer ratio': { kind: 'problem', guideKey: 'kpm.reasonGuide.lowActiveRatio' },
  'No active coach':         { kind: 'problem', guideKey: 'kpm.reasonGuide.noCoach', fixPath: '/admin2/users', fixKey: 'kpm.health.fixCoach' },
  'Low score improvement':   { kind: 'problem', guideKey: 'kpm.reasonGuide.lowImprovement' },
  'High dropout rate':       { kind: 'problem', guideKey: 'kpm.reasonGuide.highDropout' },
  'Certification issue':     { kind: 'problem', guideKey: 'kpm.reasonGuide.certIssue', fixPath: '/admin2/certifications', fixKey: 'kpm.health.fixCert' },
  'Low training activity':   { kind: 'problem', guideKey: 'kpm.reasonGuide.lowTraining' },
  'Data incomplete':         { kind: 'problem', guideKey: 'kpm.reasonGuide.dataIncomplete', fixPath: '/admin2/scores', fixKey: 'kpm.health.fixScores' },
  'Strong growth':           { kind: 'good' },
  'Strong improvement':      { kind: 'good' },
  'Strong talent pipeline':  { kind: 'good' },
}

export function HealthUnitDetailModal({
  unit, onClose,
}: {
  unit: KpmScopeHealth | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const canFix = isOperationalAdmin(profile?.role)

  if (!unit) return null

  const reasons = unit.health_reasons ?? []
  const problems = reasons.filter((r) => (REASON_META[r]?.kind ?? 'problem') === 'problem')
  const strengths = reasons.filter((r) => REASON_META[r]?.kind === 'good')

  const go = (path: string) => { onClose(); navigate(path) }

  return (
    <Modal
      open
      onClose={onClose}
      title={unit.unit_name ?? t('kpm.health.unit')}
      width="min(560px,100%)"
    >
      {/* Header: parent + status + big score */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          {(unit.parent_pld || unit.parent_state) && (
            <p className="text-xs text-text-faint truncate">
              {[unit.parent_pld, unit.parent_state].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className="mt-1"><HealthBadge status={unit.health_status} /></div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-display font-bold text-3xl leading-none" style={{ color: SCORE_COLOR(unit.health_score) }}>
            {unit.health_score ?? '—'}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-text-faint mt-0.5">{t('kpm.health.score')} / 100</div>
        </div>
      </div>

      {/* How the score works */}
      <p className="text-[11px] text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2 mb-4">
        <span aria-hidden>💡 </span>{t('kpm.health.howScore')}
      </p>

      {/* Key numbers behind the status */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mb-4 text-xs">
        <Metric label={t('nav.archers')} value={`${unit.active_archers}/${unit.registered_archers}`} sub={t('coachDash.activeArchers').toLowerCase()} />
        <Metric label={t('nav.coaches')} value={`${unit.active_coaches}`} tone={unit.active_coaches === 0 && unit.registered_archers > 0 ? 'danger' : undefined} />
        <Metric label={t('common.sessions')} value={`${unit.training_sessions}`} />
        <Metric label={t('kpm.common.avgPct')} value={unit.avg_score_pct != null ? `${unit.avg_score_pct}%` : '—'} />
      </div>

      {/* Problems */}
      {problems.length > 0 ? (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-danger mb-2">
            {t('kpm.health.problemsTitle')} ({problems.length})
          </h4>
          <div className="space-y-2">
            {problems.map((r) => {
              const meta = REASON_META[r]
              return (
                <div key={r} className="rounded-[var(--r-sm)] border border-line p-2.5 border-l-[3px] border-l-danger">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-text">{r}</span>
                    {meta?.fixPath && meta.fixKey && canFix && (
                      <Button size="sm" variant="outline" onClick={() => go(meta.fixPath!)}>
                        {t(meta.fixKey)} →
                      </Button>
                    )}
                  </div>
                  {meta?.guideKey && (
                    <p className="text-[11px] text-text-dim leading-relaxed mt-1">{t(meta.guideKey)}</p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-success bg-success-soft rounded-[var(--r-sm)] px-3 py-2 mb-4">
          ✓ {t('kpm.health.healthy')}
        </p>
      )}

      {/* Strengths (positive reasons) */}
      {strengths.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-success mb-2">
            {t('kpm.health.strengthsTitle')}
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {strengths.map((r) => (
              <span key={r} className="text-[11px] px-2 py-0.5 rounded-full bg-success-soft text-success border border-success/30">
                {r}
              </span>
            ))}
          </div>
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

export default HealthUnitDetailModal

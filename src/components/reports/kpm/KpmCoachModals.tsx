import { type ReactNode } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate } from '@/utils/dates'
import type { KpmCoachCertRow, KpmCoachCert, KpmSchoolWithoutCoachRow } from '@/services/kpmMetrics'
import { ShowingNote, KpmBackendNotice } from './shared'

/**
 * Coaches-tab pop-ups:
 *  • CoachCertModal   — click a coach card → the actual coaches (filtered) with
 *    how many certificates each holds and each certificate's title / level /
 *    issuer / status / expiry.
 *  • CoachMetricModal — click a coverage card → plain-language "how it's built".
 */

const LIST_LIMIT = 100

const CERT_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success', pending: 'warning', rejected: 'danger', expired: 'danger', withdrawn: 'neutral',
}

function CertRow({ c }: { c: KpmCoachCert }) {
  const { t } = useLanguage()
  const meta = [c.level, c.issuer].filter(Boolean).join(' · ')
  return (
    <div className="rounded-[var(--r-sm)] border border-line p-2 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-text truncate">{c.title ?? '—'}</div>
        {meta && <div className="text-[11px] text-text-faint truncate">{meta}</div>}
        {c.expiry && (
          <div className="text-[11px] text-text-faint">{t('kpm.coach.expiresOn')}: {formatDate(c.expiry)}</div>
        )}
      </div>
      {c.status && (
        <Badge variant={CERT_VARIANT[c.status] ?? 'neutral'}>
          {t(`kpm.certStatus.${c.status}`) !== `kpm.certStatus.${c.status}` ? t(`kpm.certStatus.${c.status}`) : c.status}
        </Badge>
      )}
    </div>
  )
}

export function CoachCertModal({
  pick, coaches, loading, error, onClose,
}: {
  pick: { titleKey: string; explainKey: string; filter: (c: KpmCoachCertRow) => boolean } | null
  coaches: KpmCoachCertRow[]
  loading?: boolean
  error?: unknown
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (!pick) return null
  const list = coaches.filter(pick.filter)

  return (
    <Modal open onClose={onClose} title={t(pick.titleKey)} width="min(720px,100%)">
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-3">
        <span aria-hidden>💡 </span>{t(pick.explainKey)}
      </p>

      {error != null && <div className="mb-3"><KpmBackendNotice migrations="073" error={error} /></div>}

      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">
        {t('nav.coaches')} ({list.length})
      </h4>

      {loading ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.noData')}</p>
      ) : (
        <div className="space-y-2 max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {list.slice(0, LIST_LIMIT).map((c) => {
            const where = [c.school, c.pld, c.state].filter(Boolean).join(' · ')
            return (
              <div key={c.coach_id} className="rounded-[var(--r-sm)] border border-line p-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-text truncate">{c.coach_name ?? '—'}</div>
                    {where && <div className="text-[11px] text-text-faint truncate">{where}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[11px] text-text-dim">{t('kpm.coach.certCount', { n: c.approved_cert_count })}</div>
                    {c.experience_years != null && (
                      <div className="text-[11px] text-text-faint">{t('kpm.coach.expYears', { n: c.experience_years })}</div>
                    )}
                  </div>
                </div>
                {/* Certificate list (type / level / status / expiry) */}
                {c.certs.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {c.certs.map((cert, i) => <CertRow key={i} c={cert} />)}
                  </div>
                ) : (
                  <div className="mt-2 text-[11px] text-warning">{t('kpm.coach.noCerts')}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
      <ShowingNote shown={Math.min(LIST_LIMIT, list.length)} total={list.length} />
    </Modal>
  )
}

// ─── Schools with no approved coach (name + PLD/state + archer count) ─────────

export function SchoolsWithoutCoachModal({
  open, rows, loading, error, onClose,
}: {
  open: boolean
  rows: KpmSchoolWithoutCoachRow[]
  loading?: boolean
  error?: unknown
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (!open) return null
  return (
    <Modal open onClose={onClose} title={t('kpm.coach.schoolsWithoutCoach')} width="min(680px,100%)">
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-3">
        <span aria-hidden>💡 </span>{t('kpm.coach.explain.schoolsWithout')}
      </p>

      {error != null && <div className="mb-3"><KpmBackendNotice migrations="074" error={error} /></div>}

      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">{t('common.school')} ({rows.length})</h4>

      {loading ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-success bg-success-soft rounded-[var(--r-sm)] px-3 py-2">✓ {t('kpm.coach.allSchoolsCovered')}</p>
      ) : (
        <div className="space-y-1.5 max-h-[58vh] overflow-y-auto -mx-1 px-1">
          {rows.slice(0, LIST_LIMIT).map((s) => {
            const where = [s.pld, s.state].filter(Boolean).join(' · ')
            return (
              <div key={s.school_id} className="rounded-[var(--r-sm)] border border-line p-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text truncate">{s.school ?? '—'}</div>
                  {where && <div className="text-[11px] text-text-faint truncate">{where}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums text-text">{s.registered_archers}</div>
                  <div className="text-[10px] uppercase tracking-wide text-text-faint">{t('kpm.coach.archersAffected')}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ShowingNote shown={Math.min(LIST_LIMIT, rows.length)} total={rows.length} />
    </Modal>
  )
}

// ─── Explanation-only pop-up for the non-certificate coverage cards ───────────

export function CoachMetricModal({
  metric, onClose,
}: {
  metric: { title: string; value: ReactNode; howKey: string } | null
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (!metric) return null
  return (
    <Modal open onClose={onClose} title={metric.title} width="min(480px,100%)">
      <div className="font-display font-bold text-3xl text-primary tabular-nums mb-3">{metric.value}</div>
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5">
        <span aria-hidden>💡 </span>{t(metric.howKey)}
      </p>
    </Modal>
  )
}

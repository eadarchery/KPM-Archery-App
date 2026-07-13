import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate } from '@/utils/dates'
import type { KpmRetentionSummary, KpmRetentionArcher, KpmInactiveArcherRow } from '@/services/kpmMetrics'
import { fmtNum, fmtPct, ShowingNote } from './shared'

/**
 * Two pop-ups for the Retention tab:
 *  • RetentionMetricModal — click a headline card → how it's calculated AND the
 *    actual archers behind that number (who is active / retained / dropped out).
 *  • InactiveBucketModal  — click an inactivity bucket → the archers who are not
 *    shooting (who + when they were last active + how long ago).
 */

// ─── Metric drill-down (explanation + the archers behind the number) ──────────

type MetricDef = {
  key: string
  labelKey: string
  /** Value for the headline (from the summary). */
  value: (s?: KpmRetentionSummary) => string | number
  /** Which archers this card represents. */
  filter: (a: KpmRetentionArcher) => boolean
  /** What the filtered list is called. */
  listKey: string
  rate?: boolean
}

const LIST_LIMIT = 100

const activeCur = (a: KpmRetentionArcher) => a.active_current
const activePrev = (a: KpmRetentionArcher) => a.active_previous
const retainedF = (a: KpmRetentionArcher) => a.active_current && a.active_previous
const newF = (a: KpmRetentionArcher) => a.active_current && !a.active_previous
const dropoutF = (a: KpmRetentionArcher) => a.active_previous && !a.active_current

const METRICS: Record<string, MetricDef> = {
  activeCurrent:  { key: 'activeCurrent',  labelKey: 'kpm.retention.activeCurrent',  value: (s) => fmtNum(s?.active_current),   filter: activeCur,  listKey: 'kpm.retention.listActive' },
  activePrevious: { key: 'activePrevious', labelKey: 'kpm.retention.activePrevious', value: (s) => fmtNum(s?.active_previous),  filter: activePrev, listKey: 'kpm.retention.listActivePrev' },
  returning:      { key: 'returning',      labelKey: 'kpm.retention.returning',      value: (s) => fmtNum(s?.returning_active), filter: retainedF,  listKey: 'kpm.retention.listReturning' },
  newActive:      { key: 'newActive',      labelKey: 'kpm.retention.newActive',      value: (s) => fmtNum(s?.new_active),       filter: newF,       listKey: 'kpm.retention.listNew' },
  retained:       { key: 'retained',       labelKey: 'kpm.retention.retained',       value: (s) => fmtNum(s?.retained),         filter: retainedF,  listKey: 'kpm.retention.listRetained' },
  dropout:        { key: 'dropout',        labelKey: 'kpm.retention.dropout',        value: (s) => fmtNum(s?.dropout),          filter: dropoutF,   listKey: 'kpm.retention.listDropout' },
  retentionRate:  { key: 'retentionRate',  labelKey: 'kpm.retention.retentionRate',  value: (s) => fmtPct(s?.retention_rate),   filter: retainedF,  listKey: 'kpm.retention.listRetained', rate: true },
  dropoutRate:    { key: 'dropoutRate',    labelKey: 'kpm.retention.dropoutRate',     value: (s) => fmtPct(s?.dropout_rate),     filter: dropoutF,   listKey: 'kpm.retention.listDropout', rate: true },
}

export function RetentionMetricModal({
  metricKey, summary, archers, loading, onClose,
}: {
  metricKey: string | null
  summary?: KpmRetentionSummary
  archers: KpmRetentionArcher[]
  loading?: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (!metricKey) return null
  const m = METRICS[metricKey]
  if (!m) return null

  const list = archers.filter(m.filter)
  const isActiveCard = m.key === 'activeCurrent' || m.key === 'activePrevious'
  const delta = (summary?.active_current ?? 0) - (summary?.active_previous ?? 0)

  return (
    <Modal open onClose={onClose} title={t(m.labelKey)} width="min(640px,100%)">
      {/* Headline + how it's calculated */}
      <div className="font-display font-bold text-3xl text-primary tabular-nums mb-2">{m.value(summary)}</div>
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-3">
        <span aria-hidden>💡 </span>{t(`kpm.retention.how.${m.key}`)}
      </p>

      {/* Active cards: a small previous → current trend (respects the time filter) */}
      {isActiveCard && (
        <div className="flex items-stretch gap-2 mb-3">
          <TrendStat label={t('kpm.retention.activePrevious')} value={fmtNum(summary?.active_previous)} on={m.key === 'activePrevious'} />
          <div className="flex items-center text-text-faint text-lg">→</div>
          <TrendStat label={t('kpm.retention.activeCurrent')} value={fmtNum(summary?.active_current)} on={m.key === 'activeCurrent'} />
          <div className={'flex items-center text-sm font-semibold ' + (delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-text-faint')}>
            {delta > 0 ? `+${delta}` : delta}
          </div>
        </div>
      )}

      {/* Rate cards: the actual fraction */}
      {m.rate && (
        <p className="text-[12px] text-text-dim bg-surface-soft rounded-[var(--r-sm)] px-3 py-2 mb-3 tabular-nums">
          {m.key === 'retentionRate'
            ? t('kpm.retention.rateMathRetention', { retained: summary?.retained ?? 0, prev: summary?.active_previous ?? 0, rate: fmtPct(summary?.retention_rate) })
            : t('kpm.retention.rateMathDropout',   { dropout: summary?.dropout ?? 0,   prev: summary?.active_previous ?? 0, rate: fmtPct(summary?.dropout_rate) })}
        </p>
      )}

      {/* The archers behind the number */}
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">{t(m.listKey)} ({list.length})</h4>
      {loading ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.noData')}</p>
      ) : (
        <div className="space-y-1.5 max-h-[48vh] overflow-y-auto -mx-1 px-1">
          {list.slice(0, LIST_LIMIT).map((a) => <ArcherRow key={a.archer_id} a={a} showDays={m.key === 'dropout' || m.key === 'dropoutRate'} />)}
        </div>
      )}
      <ShowingNote shown={Math.min(LIST_LIMIT, list.length)} total={list.length} />
    </Modal>
  )
}

function TrendStat({ label, value, on }: { label: string; value: string | number; on: boolean }) {
  return (
    <div className={'flex-1 rounded-[var(--r-sm)] border p-2 text-center ' + (on ? 'border-primary bg-primary-soft/30' : 'border-line')}>
      <div className={'font-display font-bold text-xl tabular-nums ' + (on ? 'text-primary' : 'text-text')}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-text-faint mt-0.5">{label}</div>
    </div>
  )
}

function ArcherRow({ a, showDays }: { a: KpmRetentionArcher; showDays?: boolean }) {
  const { t } = useLanguage()
  const where = [a.school, a.pld, a.state].filter(Boolean).join(' · ')
  return (
    <div className="rounded-[var(--r-sm)] border border-line p-2.5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-text truncate">
          {a.archer_name ?? '—'}
          {a.archer_code && <span className="text-text-faint text-xs ml-1.5">{a.archer_code}</span>}
        </div>
        <div className="text-[11px] text-text-faint mt-0.5 truncate">{[where, a.age_group].filter(Boolean).join(' · ') || '—'}</div>
        <div className="text-[11px] text-text-dim mt-0.5">
          {t('archerDetail.lastActivity')}: {a.last_activity ? formatDate(a.last_activity) : t('kpm.retention.neverActive')}
        </div>
      </div>
      {showDays && (
        <div className="shrink-0">
          <Badge variant={a.days_inactive >= 180 ? 'danger' : 'warning'}>{t('kpm.retention.daysCount', { days: a.days_inactive })}</Badge>
        </div>
      )}
    </div>
  )
}

// ─── Inactivity bucket drill-down (who is not shooting) ───────────────────────

export function InactiveBucketModal({
  days, rows, loading, onClose,
}: {
  days: number | null
  rows: KpmInactiveArcherRow[]
  loading?: boolean
  onClose: () => void
}) {
  const { t } = useLanguage()
  if (days == null) return null

  return (
    <Modal open onClose={onClose} title={t('kpm.retention.inactiveBucketTitle', { days })} width="min(720px,100%)">
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-3">
        <span aria-hidden>💡 </span>{t('kpm.retention.inactiveBucketExplain', { days })}
      </p>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">
        {t('kpm.retention.whoInactive')} ({rows.length})
      </h4>

      {loading ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-success bg-success-soft rounded-[var(--r-sm)] px-3 py-2">✓ {t('kpm.retention.noInactive')}</p>
      ) : (
        <div className="space-y-1.5 max-h-[56vh] overflow-y-auto -mx-1 px-1">
          {rows.slice(0, LIST_LIMIT).map((r) => {
            const where = [r.school, r.pld, r.state].filter(Boolean).join(' · ')
            return (
              <div key={r.archer_id} className="rounded-[var(--r-sm)] border border-line p-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text truncate">
                    {r.archer_name ?? '—'}
                    {r.archer_code && <span className="text-text-faint text-xs ml-1.5">{r.archer_code}</span>}
                  </div>
                  <div className="text-[11px] text-text-faint mt-0.5 truncate">
                    {[where, r.age_group].filter(Boolean).join(' · ') || '—'}
                  </div>
                  <div className="text-[11px] text-text-dim mt-0.5">
                    {t('archerDetail.lastActivity')}: {r.last_activity ? formatDate(r.last_activity) : t('kpm.retention.neverActive')}
                  </div>
                </div>
                <div className="shrink-0">
                  <Badge variant={r.days_inactive >= 180 ? 'danger' : 'warning'}>
                    {t('kpm.retention.daysCount', { days: r.days_inactive })}
                  </Badge>
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

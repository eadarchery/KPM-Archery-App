import { useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate } from '@/utils/dates'
import type { KpmRetentionArcher } from '@/services/kpmMetrics'
import { ShowingNote, KpmBackendNotice } from './shared'

/**
 * The actual archers behind an Overview count (Registered / Active / New),
 * with cascading State → PLD → School filters so an admin can narrow to a
 * specific unit and pinpoint who's who.
 */

const LIST_LIMIT = 200

const distinct = (vals: (string | null)[]): string[] =>
  [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))

export function ArcherListModal({
  pick, archers, loading, error, onClose,
}: {
  pick: { title: string; value: React.ReactNode; howKey: string; filter: (a: KpmRetentionArcher) => boolean } | null
  archers: KpmRetentionArcher[]
  loading?: boolean
  error?: unknown
  onClose: () => void
}) {
  const { t } = useLanguage()
  const [st, setSt] = useState('')
  const [pl, setPl] = useState('')
  const [sc, setSc] = useState('')

  const base = useMemo(() => (pick ? archers.filter(pick.filter) : []), [pick, archers])

  const stateOpts = useMemo(() => distinct(base.map((a) => a.state)), [base])
  const pldOpts = useMemo(() => distinct(base.filter((a) => !st || a.state === st).map((a) => a.pld)), [base, st])
  const schoolOpts = useMemo(
    () => distinct(base.filter((a) => (!st || a.state === st) && (!pl || a.pld === pl)).map((a) => a.school)),
    [base, st, pl],
  )

  const list = useMemo(
    () => base.filter((a) => (!st || a.state === st) && (!pl || a.pld === pl) && (!sc || a.school === sc)),
    [base, st, pl, sc],
  )

  if (!pick) return null

  const opt = (label: string, values: string[]) => [
    { value: '', label },
    ...values.map((v) => ({ value: v, label: v })),
  ]

  return (
    <Modal open onClose={onClose} title={pick.title} width="min(720px,100%)">
      <div className="font-display font-bold text-3xl text-primary tabular-nums mb-2">{pick.value}</div>
      <p className="text-sm text-text-dim leading-relaxed bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-3">
        <span aria-hidden>💡 </span>{t(pick.howKey)}
      </p>

      {/* Cascading filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <Select label={t('common.state')} value={st}
          onChange={(e) => { setSt(e.target.value); setPl(''); setSc('') }}
          options={opt(t('common.allStates'), stateOpts)} />
        <Select label={t('common.pld')} value={pl}
          onChange={(e) => { setPl(e.target.value); setSc('') }}
          options={opt(t('common.allPlds'), pldOpts)} />
        <Select label={t('common.school')} value={sc}
          onChange={(e) => setSc(e.target.value)}
          options={opt(t('common.allSchools'), schoolOpts)} />
      </div>

      {error != null && <div className="mb-3"><KpmBackendNotice migrations="072" error={error} /></div>}

      <h4 className="text-xs font-semibold uppercase tracking-wide text-text-dim mb-2">{t('nav.archers')} ({list.length})</h4>

      {loading ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-text-faint bg-surface-soft rounded-[var(--r-sm)] px-3 py-2">{t('common.noData')}</p>
      ) : (
        <div className="space-y-1.5 max-h-[52vh] overflow-y-auto -mx-1 px-1">
          {list.slice(0, LIST_LIMIT).map((a) => {
            const where = [a.school, a.pld, a.state].filter(Boolean).join(' · ')
            return (
              <div key={a.archer_id} className="rounded-[var(--r-sm)] border border-line p-2.5 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text truncate">
                    {a.archer_name ?? '—'}
                    {a.archer_code && <span className="text-text-faint text-xs ml-1.5">{a.archer_code}</span>}
                  </div>
                  {where && <div className="text-[11px] text-text-faint truncate">{[where, a.age_group].filter(Boolean).join(' · ')}</div>}
                </div>
                <div className="text-right shrink-0">
                  <div className={'text-[11px] font-semibold ' + (a.active_current ? 'text-success' : 'text-text-faint')}>
                    {a.active_current ? t('kpm.retention.activeCurrent') : t('kpm.retention.neverActive')}
                  </div>
                  <div className="text-[11px] text-text-faint">
                    {a.last_activity ? formatDate(a.last_activity) : '—'}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <ShowingNote shown={Math.min(LIST_LIMIT, list.length)} total={list.length} />
    </Modal>
  )
}

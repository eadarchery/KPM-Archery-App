import { Avatar, Badge, EmptyState } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate } from '@/utils/dates'
import type { TalentRow } from '@/services/reports'

function ageGroupKey(age: number | null): string | null {
  if (age == null) return null
  if (age <= 14) return 'ageGroups.u14'
  if (age <= 18) return 'ageGroups.u18'
  if (age <= 21) return 'ageGroups.u21'
  return 'ageGroups.open'
}

/** Ranked shortlist of strong performers (best validated score). */
export function EmergingTalentList({ talents }: { talents: TalentRow[] }) {
  const { t } = useLanguage()
  if (!talents.length) {
    return (
      <EmptyState
        title={t('talents.empty')}
        description={t('talents.emptyHint')}
      />
    )
  }

  return (
    <div className="space-y-2">
      {talents.map((row, i) => (
        <div
          key={row.archer_id}
          className="flex items-center gap-3 p-3 rounded-[var(--r)] border border-line bg-surface"
        >
          <div className="w-6 text-center font-display font-semibold text-text-faint">
            {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
          </div>
          <Avatar name={row.name} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm text-text truncate">{row.name}</div>
            <div className="text-[11px] text-text-faint truncate">
              {[row.school, row.pld, row.state].filter(Boolean).join(' · ') || '—'}
            </div>
          </div>
          <div className="hidden sm:flex flex-col items-end gap-1 mr-1">
            <div className="flex gap-1">
              <Badge variant="neutral">{ageGroupKey(row.age) ? t(ageGroupKey(row.age)!) : '—'}</Badge>
              {row.bow_category && <Badge variant="neutral">{row.bow_category}</Badge>}
            </div>
            <div className="text-[10px] text-text-faint">
              {row.last_score_date ? `${t('talents.last')}: ${formatDate(row.last_score_date)}` : '—'}
            </div>
          </div>
          <div className="text-right">
            <div className="font-display font-semibold text-lg leading-none text-text">{row.best_score}</div>
            <div className="text-[10px] text-text-faint mt-0.5">
              {row.improvement > 0
                ? <span className="text-success">+{row.improvement} {t('talents.vsAvg')}</span>
                : `${row.approved_count} ${t('common.scores').toLowerCase()}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default EmergingTalentList

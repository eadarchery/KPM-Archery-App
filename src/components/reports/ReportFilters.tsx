import { Select } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters as Filters, DatePreset } from '@/services/reports'

/** Option list for a scope/value Select. */
export interface Opt { value: string; label: string }

// Option labels are translation keys, resolved via t() at render.
const DATE_OPTS: { value: DatePreset; labelKey: string }[] = [
  { value: '1d', labelKey: 'reportFilters.last24h' },
  { value: '1w', labelKey: 'reportFilters.last7d' },
  { value: '1m', labelKey: 'reportFilters.last30d' },
  { value: '3m', labelKey: 'reportFilters.last3m' },
  { value: '6m', labelKey: 'reportFilters.last6m' },
  { value: '1y', labelKey: 'reportFilters.lastYear' },
  { value: '3y', labelKey: 'reportFilters.last3y' },
  { value: '5y', labelKey: 'reportFilters.last5y' },
  { value: 'all', labelKey: 'reportFilters.allTime' },
]

const BOW_OPTS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'reportFilters.allBows' },
  { value: 'recurve', labelKey: 'bows.recurve' },
  { value: 'compound', labelKey: 'bows.compound' },
  { value: 'barebow', labelKey: 'bows.barebow' },
  { value: 'longbow', labelKey: 'bows.longbow' },
  { value: 'traditional', labelKey: 'bows.traditional' },
]

const AGE_OPTS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'common.allAges' },
  { value: 'u14', labelKey: 'ageGroups.u14' },
  { value: 'u18', labelKey: 'ageGroups.u18' },
  { value: 'u21', labelKey: 'ageGroups.u21' },
  { value: 'open', labelKey: 'ageGroups.open' },
]

// Canonical KPM bands (calendar-year, migration 061). Values are CASE-SENSITIVE
// in the KPM RPCs — 'U12'/'U15'/'U18'/'Open', matching core.kpm_age_group().
const KPM_AGE_OPTS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'common.allAges' },
  { value: 'U12', labelKey: 'ageGroups.u12' },
  { value: 'U15', labelKey: 'ageGroups.u15' },
  { value: 'U18', labelKey: 'ageGroups.u18' },
  { value: 'Open', labelKey: 'ageGroups.open' },
]

const GENDER_OPTS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'kpm.common.allGenders' },
  { value: 'male', labelKey: 'kpm.gender.male' },
  { value: 'female', labelKey: 'kpm.gender.female' },
]

/**
 * Role-aware report filter bar. Only the filters whose option lists are passed
 * (or whose boolean flags are set) render — so a coach/admin1 page never shows
 * filters it should not have. The date range is always shown.
 */
export function ReportFilters({
  value,
  onChange,
  states,
  plds,
  schools,
  showBow = true,
  showAge = true,
  showGender = false,
  ageScheme = 'legacy',
}: {
  value: Filters
  onChange: (next: Filters) => void
  states?: Opt[]
  plds?: Opt[]
  schools?: Opt[]
  showBow?: boolean
  showAge?: boolean
  showGender?: boolean
  /** 'kpm' emits canonical U12/U15/U18/Open values for the KPM RPCs. */
  ageScheme?: 'legacy' | 'kpm'
}) {
  const { t } = useLanguage()
  const set = (patch: Partial<Filters>) => onChange({ ...value, ...patch })
  const opts = (list: { value: string; labelKey: string }[]) =>
    list.map((o) => ({ value: o.value, label: t(o.labelKey) }))

  return (
    <div className="card mb-5 p-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <Select
          label={t('reports.dateRange')}
          value={value.preset ?? '3m'}
          onChange={(e) => set({ preset: e.target.value as DatePreset })}
          options={opts(DATE_OPTS)}
        />
        {states && (
          <Select
            label={t('common.state')}
            value={value.stateId ?? ''}
            onChange={(e) => set({ stateId: e.target.value || undefined, pldId: undefined, schoolId: undefined })}
            options={[{ value: '', label: t('common.allStates') }, ...states]}
          />
        )}
        {plds && (
          <Select
            label={t('common.pld')}
            value={value.pldId ?? ''}
            onChange={(e) => set({ pldId: e.target.value || undefined, schoolId: undefined })}
            options={[{ value: '', label: t('common.allPlds') }, ...plds]}
          />
        )}
        {schools && (
          <Select
            label={t('common.school')}
            value={value.schoolId ?? ''}
            onChange={(e) => set({ schoolId: e.target.value || undefined })}
            options={[{ value: '', label: t('common.allSchools') }, ...schools]}
          />
        )}
        {showBow && (
          <Select
            label={t('common.bowCategory')}
            value={value.bowCategory ?? ''}
            onChange={(e) => set({ bowCategory: e.target.value || undefined })}
            options={opts(BOW_OPTS)}
          />
        )}
        {showAge && (
          <Select
            label={t('common.ageGroup')}
            value={value.ageGroup ?? ''}
            onChange={(e) => set({ ageGroup: e.target.value || undefined })}
            options={opts(ageScheme === 'kpm' ? KPM_AGE_OPTS : AGE_OPTS)}
          />
        )}
        {showGender && (
          <Select
            label={t('kpm.common.gender')}
            value={value.gender ?? ''}
            onChange={(e) => set({ gender: (e.target.value || undefined) as Filters['gender'] })}
            options={opts(GENDER_OPTS)}
          />
        )}
      </div>
    </div>
  )
}

export default ReportFilters

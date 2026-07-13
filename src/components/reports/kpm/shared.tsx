import { useState, type ReactNode } from 'react'
import { Badge, Select } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'

/**
 * Shared bits for the KPM report sections (Admin 1 + Admin 2).
 *
 * GOLDEN RULE: nothing in this folder computes an official KPM metric. Every
 * number is rendered exactly as returned by the SECURITY INVOKER RPCs behind
 * src/services/kpmMetrics.ts (migrations 061–068). The only client-side work
 * allowed here is formatting, translating labels, sorting/slicing for display
 * and picking which backend rows to show.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

// ─── FORMATTING (display only — values arrive pre-computed from the DB) ──────

export const fmtPct = (v: number | null | undefined): string => (v == null ? '—' : `${v}%`)
export const fmtNum = (v: number | null | undefined): string | number => (v == null ? '—' : v)
/** Improvement in percentage points, signed. */
export const fmtPp = (v: number | null | undefined): string =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v} pp`

/** 'YYYY-MM-DD' month bucket → 'Jan 2026' (display formatting only). */
export function monthLabel(bucket: string): string {
  const d = new Date(bucket)
  if (Number.isNaN(d.getTime())) return bucket
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

// ─── LABEL MAPS (DB enum/slug → translation key, safe fallback to raw) ───────

const SESSION_TYPES = new Set(['indoor', 'outdoor', 'field', '3d', 'virtual'])
export const sessionTypeLabel = (t: Translate, v: string | null): string =>
  v == null ? '—' : SESSION_TYPES.has(v) ? t(`kpm.session.${v}`) : v

const ROUND_CATS = new Set(['training', 'practice', 'tournament', 'selection'])
export const roundCatLabel = (t: Translate, v: string | null): string =>
  v == null ? '—' : ROUND_CATS.has(v) ? t(`kpm.roundCat.${v}`) : v

const CERT_STATUSES = new Set(['certified', 'expiring', 'expired', 'uncertified'])
export const certStatusLabel = (t: Translate, v: string | null): string =>
  v == null ? '—' : CERT_STATUSES.has(v) ? t(`kpm.certStatus.${v}`) : v

const BAND_KEYS: Record<string, string> = {
  'Beginner': 'beginner', 'Developing': 'developing', 'Intermediate': 'intermediate',
  'Advanced': 'advanced', 'Talent Pool': 'talentPool',
}
export const bandLabel = (t: Translate, v: string | null): string =>
  v == null ? '—' : BAND_KEYS[v] ? t(`kpm.band.${BAND_KEYS[v]}`) : v

const REASON_KEYS: Record<string, string> = {
  'Top Performer': 'topPerformer', 'Fast Improver': 'fastImprover',
  'Consistent Archer': 'consistentArcher', 'Tournament Ready': 'tournamentReady',
  'Hidden Talent': 'hiddenTalent', 'Band Promotion': 'bandPromotion',
  'Achievement Milestone': 'achievementMilestone',
}
export const talentReasonLabel = (t: Translate, v: string): string =>
  REASON_KEYS[v] ? t(`kpm.reason.${REASON_KEYS[v]}`) : v

const DQ_CATEGORIES = new Set(['profile', 'score', 'training', 'coach', 'organisation', 'equipment'])
export const dqCategoryLabel = (t: Translate, v: string | null): string =>
  v == null ? '—' : DQ_CATEGORIES.has(v) ? t(`kpm.dqcat.${v}`) : v

/** Known DQ issue slugs (migration 068) — translated; unknown slugs fall back to the DB message. */
const DQ_ISSUE_TYPES = new Set([
  'missing_name', 'missing_gender', 'missing_birth_date', 'missing_state', 'missing_school',
  'missing_pld', 'missing_bow_category', 'missing_coach_link', 'unapproved_profile',
  'no_equipment_setup', 'equipment_missing_bow', 'equipment_missing_arrow',
  'total_gt_max', 'invalid_max_score', 'max_mismatch', 'tournament_no_proof',
  'missing_snapshot', 'pending_score', 'rejected_score',
  'zero_arrows', 'suspicious_arrows', 'missing_session_type', 'missing_coach',
  'coach_no_profile', 'coach_no_valid_cert', 'coach_cert_flag_mismatch', 'coach_cert_expired',
  'coach_cert_expiring_90', 'coach_no_linked_archers', 'coach_pending_links',
  'school_missing_pld', 'inactive_school_with_archers', 'active_school_no_coach',
  'active_school_no_recent_activity',
])
export const issueTypeLabel = (t: Translate, issueType: string, fallback?: string): string =>
  DQ_ISSUE_TYPES.has(issueType) ? t(`kpm.issue.${issueType}`) : (fallback ?? issueType)

// ─── BADGES ──────────────────────────────────────────────────────────────────

export function SeverityBadge({ severity }: { severity: string }) {
  const { t } = useLanguage()
  const variant = severity === 'critical' ? 'danger' : severity === 'warning' ? 'warning' : 'neutral'
  const key = severity === 'critical' || severity === 'warning' || severity === 'info'
    ? t(`kpm.severity.${severity}`) : severity
  return <Badge variant={variant}>{key}</Badge>
}

export function HealthBadge({ status }: { status: string }) {
  const { t } = useLanguage()
  const variant = status === 'Green' ? 'success' : status === 'Yellow' ? 'warning' : status === 'Red' ? 'danger' : 'neutral'
  const key = status === 'Green' || status === 'Yellow' || status === 'Red'
    ? t(`kpm.health.${status.toLowerCase()}`) : status
  return <Badge variant={variant} dot>{key}</Badge>
}

export function CertStatusBadge({ status }: { status: string | null }) {
  const { t } = useLanguage()
  if (!status) return <span className="text-text-faint">—</span>
  const variant =
    status === 'certified' ? 'success'
    : status === 'expiring' ? 'warning'
    : status === 'expired' ? 'danger'
    : 'neutral'
  return <Badge variant={variant}>{certStatusLabel(t, status)}</Badge>
}

// ─── CAPTIONS & NOTICES ──────────────────────────────────────────────────────

/**
 * Mandatory disclaimer for internal (non-official) classifications — talent
 * development bands and Green/Yellow/Red health. Must stay clearly visible.
 */
export function InternalNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs text-text-dim bg-surface-soft border border-line rounded-[var(--r-sm)] px-3 py-2 mb-4 flex items-start gap-2">
      <span aria-hidden className="shrink-0">ⓘ</span>
      <span>{children}</span>
    </p>
  )
}

/**
 * Collapsible "How to read this" explainer — plain-language help shown at the
 * top of a report section so a non-analyst understands what they're looking at.
 * Closed by default (unobtrusive); open it with one click. Pass defaultOpen for
 * the sections that most need explaining (Health, Data Quality).
 */
export function ExplainBox({
  children, title, defaultOpen = false,
}: {
  children: ReactNode
  title?: string
  defaultOpen?: boolean
}) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mb-4 rounded-[var(--r-sm)] border border-line bg-surface-soft/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-surface-soft transition-colors"
      >
        <span aria-hidden>💡</span>
        <span className="flex-1 text-xs font-semibold text-text">{title ?? t('kpm.explain.howToRead')}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
          strokeLinecap="round" strokeLinejoin="round"
          className={cn('text-text-faint transition-transform duration-200', open && 'rotate-180')}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-0.5 text-xs text-text-dim leading-relaxed space-y-1.5 border-t border-line">
          {children}
        </div>
      )}
    </div>
  )
}

/** A coloured status word for the plain-language legends (Green/Yellow/Red…). */
export function StatusWord({ tone, children }: { tone: 'success' | 'warning' | 'danger' | 'neutral'; children: ReactNode }) {
  const c = tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-text'
  return <strong className={c}>{children}</strong>
}

/** Shown when a section's RPCs fail — usually the migration was not applied yet. */
export function KpmBackendNotice({ migrations, error }: { migrations: string; error?: unknown }) {
  const { t } = useLanguage()
  const detail = error instanceof Error ? error.message : undefined
  return (
    <div className="text-sm text-warning bg-warning-soft rounded-[var(--r-sm)] px-3 py-2.5 mb-4">
      <p>{t('kpm.common.backendMissing', { migrations })}</p>
      {detail && <p className="text-xs opacity-80 mt-1 break-words">{detail}</p>}
    </div>
  )
}

/** "Showing first N of M rows" hint under sliced display lists. */
export function ShowingNote({ shown, total }: { shown: number; total: number }) {
  const { t } = useLanguage()
  if (total <= shown) return null
  return (
    <p className="text-[11px] text-text-faint mt-2">
      {t('kpm.common.showingFirst', { shown, total })}
    </p>
  )
}

// ─── CONTROLS ────────────────────────────────────────────────────────────────

/** Small labelled group-by selector used above breakdown tables. */
export function GroupBySelect<V extends string>({
  value, onChange, options, label,
}: {
  value: V
  onChange: (v: V) => void
  options: { value: V; labelKey: string }[]
  label?: string
}) {
  const { t } = useLanguage()
  return (
    <div className="max-w-[240px] mb-3">
      <Select
        label={label ?? t('kpm.common.groupBy')}
        value={value}
        onChange={(e) => onChange(e.target.value as V)}
        options={options.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
      />
    </div>
  )
}

/** Inline percentage bar (pure display of a DB-provided percentage). */
export function PctBar({ pct }: { pct: number | null }) {
  const width = Math.max(0, Math.min(100, pct ?? 0))
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-surface-soft overflow-hidden">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
      <span className="text-xs tabular-nums text-text-dim w-12 text-right">{fmtPct(pct)}</span>
    </div>
  )
}

/** Group-by option lists shared by several sections. */
export const ORG_DIMS = [
  { value: 'state' as const,  labelKey: 'common.state' },
  { value: 'pld' as const,    labelKey: 'common.pld' },
  { value: 'school' as const, labelKey: 'common.school' },
]
export const DEMO_DIMS = [
  { value: 'age_group' as const,    labelKey: 'common.ageGroup' },
  { value: 'gender' as const,       labelKey: 'kpm.common.gender' },
  { value: 'bow_category' as const, labelKey: 'common.bowCategory' },
]

/** Translate a breakdown row's group label for demographic dimensions. */
export function groupRowLabel(
  t: Translate,
  groupBy: string,
  raw: string | null,
): string {
  if (raw == null || raw === '') return t('kpm.common.unspecified')
  if (groupBy === 'session_type')   return sessionTypeLabel(t, raw)
  if (groupBy === 'round_category') return roundCatLabel(t, raw)
  if (groupBy === 'gender') {
    if (raw === 'male') return t('kpm.gender.male')
    if (raw === 'female') return t('kpm.gender.female')
    return t('kpm.common.unspecified')
  }
  if (groupBy === 'certification_status') return certStatusLabel(t, raw)
  if (groupBy === 'distance') return /^\d+$/.test(raw) ? `${raw}m` : raw
  return raw
}

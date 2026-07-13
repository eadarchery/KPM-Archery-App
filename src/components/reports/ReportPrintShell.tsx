import type { ReactNode } from 'react'
import { Button } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { useBrandingValue } from '@/hooks/useBranding'
import { useAuth } from '@/hooks/useAuth'
import type { DatePreset, ReportFilters } from '@/services/reports'

/**
 * Print / Save-as-PDF layout for report pages (Admin 1 + Admin 2).
 *
 * Follows the proven StateReport pattern: the on-screen page is untouched;
 * a print stylesheet isolates `#printable-report`, and a print-only header
 * and footer are added around the existing report content. Exporting is
 * therefore just `window.print()` → "Save as PDF" — no new dependencies,
 * no change to filters or dashboard data.
 *
 * The printed document includes: report title, generated timestamp, the
 * selected date range, the filters used, summary/tables/charts (the wrapped
 * children), prepared-by information and app branding — in the admin's
 * current language (EN / BM).
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const PRESET_LABEL_KEYS: Record<DatePreset, string> = {
  '1d': 'reportFilters.last24h',
  '1w': 'reportFilters.last7d',
  '1m': 'reportFilters.last30d',
  '3m': 'reportFilters.last3m',
  '6m': 'reportFilters.last6m',
  '1y': 'reportFilters.lastYear',
  '3y': 'reportFilters.last3y',
  '5y': 'reportFilters.last5y',
  all:  'reportFilters.allTime',
}

/** Human summary of the active filters, e.g. "State: Melaka · Bow: Recurve". */
export function describeReportFilters(
  t: Translate,
  filters: ReportFilters,
  names: { state?: string; pld?: string; school?: string },
): string {
  const parts: string[] = []
  if (names.state)  parts.push(`${t('common.state')}: ${names.state}`)
  if (names.pld)    parts.push(`${t('common.pld')}: ${names.pld}`)
  if (names.school) parts.push(`${t('common.school')}: ${names.school}`)
  if (filters.bowCategory) parts.push(`${t('common.bowCategory')}: ${filters.bowCategory}`)
  if (filters.ageGroup)    parts.push(`${t('common.ageGroup')}: ${filters.ageGroup}`)
  if (filters.roundType)   parts.push(`${t('common.roundType')}: ${filters.roundType}`)
  return parts.length ? parts.join(' · ') : t('reportPdf.noFilters')
}

export function rangeLabel(t: Translate, filters: ReportFilters): string {
  return t(PRESET_LABEL_KEYS[filters.preset ?? '3m'])
}

/** "Print / Save as PDF" action — pairs with <ReportPrintShell>. */
export function PrintReportButton({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const { t } = useLanguage()
  return (
    <Button variant="outline" size={size} onClick={() => window.print()}>
      {t('reportPdf.printButton')}
    </Button>
  )
}

export function ReportPrintShell({
  title,
  range,
  filtersSummary,
  children,
}: {
  /** Printed report title (already translated). */
  title: string
  /** Selected date-range label (already translated). */
  range: string
  /** Human summary of the filters used (already translated). */
  filtersSummary: string
  children: ReactNode
}) {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const brandName = useBrandingValue<string>('brand_name', 'EAD Archery Scene Monitor')

  return (
    <>
      {/* Print isolation — only the report document is visible when printing. */}
      <style>{`@media print {
        body * { visibility: hidden; }
        #printable-report, #printable-report * { visibility: visible; }
        #printable-report { position: absolute; left: 0; top: 0; width: 100%; }
        @page { margin: 14mm; }
      }`}</style>

      <div id="printable-report">
        {/* Print-only header: branding · title · generated · range · filters · prepared by */}
        <div className="hidden print:block border-b border-line pb-4 mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-faint">{brandName}</p>
          <h1 className="font-display font-bold text-2xl text-text mt-1">{title}</h1>
          <div className="mt-2 space-y-0.5 text-sm text-text-dim">
            <p><span className="font-semibold text-text">{t('reportPdf.generated')}:</span> {new Date().toLocaleString()}</p>
            <p><span className="font-semibold text-text">{t('reportPdf.dateRange')}:</span> {range}</p>
            <p><span className="font-semibold text-text">{t('reportPdf.filtersUsed')}:</span> {filtersSummary}</p>
            {profile && (
              <p>
                <span className="font-semibold text-text">{t('reportPdf.preparedBy')}:</span>{' '}
                {profile.name} ({t(`roles.${profile.role}`)})
              </p>
            )}
          </div>
        </div>

        {children}

        {/* Print-only footer: branding + methodology note */}
        <div className="hidden print:block border-t border-line pt-3 mt-8 text-[10px] text-text-faint">
          <p>{t('reportPdf.footerNote', { brand: brandName })}</p>
        </div>
      </div>
    </>
  )
}

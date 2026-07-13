import { type ReactNode } from 'react'
import { EmptyState } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  /** Hide below this breakpoint to keep mobile tables readable. */
  hide?: 'sm' | 'md' | 'lg'
}

/**
 * Generic responsive breakdown table: a real table on desktop, stacked cards
 * on mobile. Used for the state / PLD / school activity breakdowns.
 */
export function BreakdownTable<T>({
  columns,
  rows,
  getKey,
  primaryKey,
  emptyTitle,
  emptyDescription,
  onRowClick,
}: {
  columns: Column<T>[]
  rows: T[]
  getKey: (row: T) => string
  /** Column key used as the bold heading on mobile cards. Defaults to first. */
  primaryKey?: string
  emptyTitle?: string
  emptyDescription?: string
  /** When set, each row/card is clickable (pointer cursor + onClick). */
  onRowClick?: (row: T) => void
}) {
  const { t } = useLanguage()
  if (!rows.length) {
    return <EmptyState title={emptyTitle ?? t('common.noData')} description={emptyDescription} />
  }

  const hideClass = (hide?: 'sm' | 'md' | 'lg') =>
    hide === 'sm' ? 'hidden sm:table-cell'
    : hide === 'md' ? 'hidden md:table-cell'
    : hide === 'lg' ? 'hidden lg:table-cell'
    : ''

  const primary = primaryKey ?? columns[0]?.key
  const primaryCol = columns.find((c) => c.key === primary) ?? columns[0]
  const restCols = columns.filter((c) => c.key !== primaryCol?.key)

  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block table-wrap">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-soft">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong whitespace-nowrap',
                    c.align === 'right' ? 'text-right' : 'text-left',
                    hideClass(c.hide),
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-line last:border-0 hover:bg-surface-soft transition-colors',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-3 py-2.5 text-text-dim',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      hideClass(c.hide),
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2.5">
        {rows.map((row) => (
          <div
            key={getKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(
              'rounded-[var(--r)] border border-line bg-surface p-3',
              onRowClick && 'cursor-pointer active:bg-surface-soft',
            )}
          >
            <div className="font-semibold text-sm text-text mb-2">{primaryCol?.render(row)}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              {restCols.map((c) => (
                <div key={c.key} className="flex justify-between gap-2">
                  <span className="text-text-faint">{c.header}</span>
                  <span className="text-text-dim font-medium text-right">{c.render(row)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export default BreakdownTable

import { cn } from '@/utils/cn'

/**
 * Shimmering placeholder used while data loads. Colours are driven by the
 * design tokens in globals.css, so it adapts to light/dark automatically and
 * freezes gracefully under `prefers-reduced-motion`.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('skeleton rounded-[var(--r-sm)]', className)} />
}

/**
 * Placeholder that mirrors the desktop admin data tables (avatar + two-line
 * identity in the first column, value bars in the rest). Sits inside the same
 * `card` shell the real table uses so the swap to loaded content is seamless.
 */
export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  const valueCols = Math.max(1, cols - 1)
  return (
    <div aria-hidden="true" className="card p-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 bg-surface-soft border-b border-line-strong px-4 py-3">
        <Skeleton className="h-3 w-28 shrink-0" />
        {Array.from({ length: valueCols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1 max-w-[80px]" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            <div className="flex items-center gap-2.5 w-40 shrink-0">
              <Skeleton className="w-8 h-8 rounded-full shrink-0" />
              <div className="flex-1 flex flex-col gap-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-2.5 w-2/3" />
              </div>
            </div>
            {Array.from({ length: valueCols }).map((_, c) => (
              <Skeleton key={c} className="h-3 flex-1 max-w-[70px]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Placeholder for the bordered row-card lists (Audit log, States, PLDs,
 * Schools) — a stack of rows with a label block and a trailing action chip.
 */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="border border-line rounded-[var(--r-md)] p-4 flex items-center justify-between gap-3"
        >
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-2.5 w-2/3 max-w-[420px]" />
          </div>
          <Skeleton className="h-8 w-16 rounded-[8px] shrink-0" />
        </div>
      ))}
    </div>
  )
}

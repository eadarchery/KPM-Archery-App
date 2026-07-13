import { type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /** `danger` tints the card for load errors; `neutral` (default) for empty content. */
  tone?: 'neutral' | 'danger'
  className?: string
}

export function EmptyState({ icon, title, description, action, tone = 'neutral', className }: EmptyStateProps) {
  const danger = tone === 'danger'
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-12 px-6 rounded-[var(--r)] border border-dashed',
        danger ? 'border-danger-soft bg-danger-soft' : 'border-line-strong bg-surface-soft',
        className,
      )}
    >
      <div
        className={cn(
          'mb-4 [&>svg]:w-10 [&>svg]:h-10',
          danger ? 'text-danger opacity-80' : 'text-text-faint opacity-40',
        )}
      >
        {icon ?? (danger ? <DefaultDangerIcon /> : <DefaultEmptyIcon />)}
      </div>
      <p className={cn('font-display font-semibold text-sm', danger ? 'text-danger' : 'text-text-dim')}>{title}</p>
      {description && <p className="text-text-faint text-xs mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function DefaultEmptyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-5.5l-1.8 2.6a1 1 0 0 1-.8.4h-3.8a1 1 0 0 1-.8-.4L7.5 12H2" />
      <path d="M5.6 5.4 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.6-6.6A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.7 1.4z" />
    </svg>
  )
}

function DefaultDangerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" y1="9" x2="12" y2="13.5" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

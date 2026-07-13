import { type ReactNode } from 'react'
import { cn } from '@/utils/cn'

interface PageWrapperProps {
  children: ReactNode
  className?: string
  narrow?: boolean
}

export function PageWrapper({ children, className, narrow }: PageWrapperProps) {
  return (
    <main
      className={cn(
        'max-w-[1240px] mx-auto px-4 pt-6 pb-10 md:pb-10 pb-[calc(96px+env(safe-area-inset-bottom,0px))]',
        narrow && 'max-w-[760px]',
        className,
      )}
    >
      {children}
    </main>
  )
}

interface PageHeadProps {
  title: string
  description?: string
  action?: ReactNode
  pill?: ReactNode
  className?: string
}

export function PageHead({ title, description, action, pill, className }: PageHeadProps) {
  return (
    <div className={cn('flex items-end justify-between gap-4 mb-5 flex-wrap', className)}>
      <div className="min-w-0">
        <h2 className="text-[27px] tracking-[-0.015em]">{title}</h2>
        {description && (
          <p className="text-sm text-text-dim mt-0.5 max-w-[760px]">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {pill}
        {action}
      </div>
    </div>
  )
}

// ─── SECTION CARD ─────────────────────────────────────────────────────────────

interface SectionCardProps {
  title?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}

export function SectionCard({ title, children, action, className }: SectionCardProps) {
  return (
    <div className={cn('card', className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-4">
          {title && (
            <h3 className="text-[15.5px] font-display font-semibold flex items-center gap-2">
              {title}
            </h3>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

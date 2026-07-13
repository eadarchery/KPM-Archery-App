import { cn } from '@/utils/cn'

interface RedDotProps {
  count?: number
  show?: boolean
  className?: string
  pulse?: boolean
}

export function RedDot({ count, show = true, className, pulse }: RedDotProps) {
  if (!show && (count === undefined || count === 0)) return null
  if (count === 0) return null

  return (
    <span
      aria-label={count ? `${count} unread` : 'New'}
      className={cn(
        'inline-flex items-center justify-center rounded-full bg-danger text-white font-bold leading-none',
        pulse && 'animate-[pulse-dot_2s_ease-in-out_infinite]',
        count !== undefined
          ? 'min-w-[16px] h-4 text-[9px] px-1'
          : 'w-2 h-2',
        className,
      )}
    >
      {count !== undefined && count > 0 ? (count > 99 ? '99+' : count) : ''}
    </span>
  )
}

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger' | 'success' | 'warning'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
}

const variantStyles: Record<Variant, string> = {
  primary:   'bg-primary text-primary-on hover:bg-primary-hover',
  secondary: 'bg-text text-bg hover:opacity-90',
  ghost:     'bg-section text-text-dim hover:bg-surface-soft hover:text-text',
  outline:   'bg-transparent border border-line-strong text-text-dim hover:border-primary hover:text-primary',
  danger:    'bg-danger-soft text-danger hover:bg-danger hover:text-white',
  success:   'bg-success-soft text-success hover:bg-success hover:text-white',
  warning:   'bg-warning-soft text-warning hover:bg-warning hover:text-white',
}

const sizeStyles: Record<Size, string> = {
  sm: 'text-xs px-3 py-1.5 min-h-[36px] gap-1.5 rounded-[8px]',
  md: 'text-sm px-4 py-2.5 min-h-[44px] gap-2 rounded-[var(--r-sm)]',
  lg: 'text-base px-5 py-3 min-h-[52px] gap-2.5 rounded-[var(--r)]',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      icon,
      iconRight,
      children,
      disabled,
      className,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={cn(
          'inline-flex items-center justify-center font-display font-semibold border border-transparent',
          'transition-all duration-150 ease-[var(--ease-out)] touch-manipulation',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          'active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {loading ? (
          <svg
            className="animate-spin shrink-0"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
            />
          </svg>
        ) : icon ? (
          <span className="shrink-0 w-[17px] h-[17px] flex items-center justify-center">{icon}</span>
        ) : null}
        {children}
        {iconRight && (
          <span className="shrink-0 w-[17px] h-[17px] flex items-center justify-center">{iconRight}</span>
        )}
      </button>
    )
  },
)

Button.displayName = 'Button'

export { Button, type ButtonProps, type Variant as ButtonVariant, type Size as ButtonSize }

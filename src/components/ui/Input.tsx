import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  wrapperClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, wrapperClassName, className, id, ...props }, ref) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-[12px] font-semibold text-text-dim block">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          // Focused number inputs respond to the mouse wheel, silently changing
          // the value while the user thinks they are scrolling the page (e.g. a
          // badge's round max drifting 360 → 357). Blur instead so the wheel
          // scrolls the page and the value stays put.
          onWheel={props.type === 'number' ? (e) => e.currentTarget.blur() : undefined}
          className={cn(
            'field',
            error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--danger-soft)]',
            className,
          )}
          {...props}
        />
        {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
        {hint && !error && <p className="text-[12px] text-text-faint">{hint}</p>}
      </div>
    )
  },
)
Input.displayName = 'Input'

// ─── TEXTAREA ────────────────────────────────────────────────────────────────

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  hint?: string
  wrapperClassName?: string
  minRows?: number
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, wrapperClassName, minRows = 3, className, id, ...props }, ref) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={inputId} className="text-[12px] font-semibold text-text-dim block">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          rows={minRows}
          className={cn(
            'field resize-y',
            error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--danger-soft)]',
            className,
          )}
          {...props}
        />
        {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
        {hint && !error && <p className="text-[12px] text-text-faint">{hint}</p>}
      </div>
    )
  },
)
Textarea.displayName = 'Textarea'

// ─── SELECT ──────────────────────────────────────────────────────────────────

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  hint?: string
  wrapperClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, hint, wrapperClassName, className, id, children, ...props }, ref) => {
    const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
        {label && (
          <label htmlFor={selectId} className="text-[12px] font-semibold text-text-dim block">
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              'field appearance-none pr-8',
              error && 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--danger-soft)]',
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-text-faint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        {error && <p className="text-[12px] text-danger font-medium">{error}</p>}
        {hint && !error && <p className="text-[12px] text-text-faint">{hint}</p>}
      </div>
    )
  },
)
Select.displayName = 'Select'

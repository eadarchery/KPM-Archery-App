import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'

/**
 * Inline "?" help tip for complex or risky admin controls.
 *
 * Opens on hover (desktop) or tap (mobile); Escape / outside-click closes.
 * Structured fields keep every tip consistent:
 *   • what        — what the control does
 *   • who         — who it affects
 *   • reversible  — whether the action can be undone
 *   • warning     — anything to know BEFORE clicking (rendered in warning tone)
 *
 * All text is passed in already translated (callers use t('helpTips.…')),
 * so tips work in both English and Bahasa Malaysia.
 */
export interface HelpTipProps {
  /** Short bold title shown at the top of the popover (usually the control name). */
  title?: string
  what?: string
  who?: string
  reversible?: string
  warning?: string
  /** Free-form extra line, when the structured fields don't fit. */
  note?: string
  className?: string
  /** Popover alignment relative to the trigger. */
  align?: 'left' | 'right'
}

export function HelpTip({ title, what, who, reversible, warning, note, className, align = 'left' }: HelpTipProps) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <span
      ref={ref}
      className={cn('relative inline-flex align-middle', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={t('helpTips.whatIsThis')}
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className="w-4 h-4 rounded-full border border-line text-text-faint hover:text-primary hover:border-primary inline-flex items-center justify-center text-[10px] font-bold leading-none flex-shrink-0"
      >
        ?
      </button>
      {open && (
        <span
          role="dialog"
          className={cn(
            'absolute z-[130] top-full mt-1.5 w-[min(280px,80vw)] rounded-[var(--r)] border border-line bg-surface shadow-card-lg p-3 text-left space-y-1.5 animate-menu-in block',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {title && <span className="block font-display font-semibold text-xs text-text">{title}</span>}
          {what && (
            <span className="block text-[11px] text-text-dim leading-relaxed">
              <span className="font-semibold text-text">{t('helpTips.what')}: </span>{what}
            </span>
          )}
          {who && (
            <span className="block text-[11px] text-text-dim leading-relaxed">
              <span className="font-semibold text-text">{t('helpTips.who')}: </span>{who}
            </span>
          )}
          {reversible && (
            <span className="block text-[11px] text-text-dim leading-relaxed">
              <span className="font-semibold text-text">{t('helpTips.reversible')}: </span>{reversible}
            </span>
          )}
          {note && <span className="block text-[11px] text-text-dim leading-relaxed">{note}</span>}
          {warning && (
            <span className="block text-[11px] text-warning leading-relaxed">
              <span className="font-semibold">⚠ {t('helpTips.warning')}: </span>{warning}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/utils/cn'

/**
 * Compact row-actions menu: a single ⋮ trigger that opens a dropdown of actions.
 *
 * Built for dense tables where a row of inline buttons overflows — especially at
 * large / XL font sizes. The dropdown is portalled to <body> and positioned by
 * the trigger's rect, so it is never clipped by the table's horizontal scroll
 * container and never forces the row wider.
 */

export interface ActionItem {
  label: string
  onClick: () => void
  tone?: 'default' | 'success' | 'danger' | 'warning'
  /** Omit the item entirely when false. */
  show?: boolean
  disabled?: boolean
}

const toneClass: Record<NonNullable<ActionItem['tone']>, string> = {
  default: 'text-text hover:bg-surface-soft',
  success: 'text-success hover:bg-success-soft',
  danger:  'text-danger hover:bg-danger-soft',
  warning: 'text-warning hover:bg-warning-soft',
}

export function ActionMenu({
  items, label = 'Actions', align = 'right', note,
}: {
  items: ActionItem[]
  /** Accessible label for the trigger. */
  label?: string
  align?: 'right' | 'left'
  /** Optional muted footnote shown at the bottom of the menu (e.g. a permission hint). */
  note?: string
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const visible = items.filter((i) => i.show !== false)

  useEffect(() => {
    if (!open) return
    const el = triggerRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos(align === 'right'
        ? { top: r.bottom + 6, right: window.innerWidth - r.right }
        : { top: r.bottom + 6, left: r.left })
    }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, align])

  if (visible.length === 0 && !note) return null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center justify-center w-8 h-8 rounded-[var(--r-sm)] border border-line',
          'text-text-dim hover:text-text hover:bg-surface-soft transition-colors',
          open && 'bg-surface-soft text-text',
        )}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
        </svg>
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[200] min-w-[168px] max-w-[calc(100vw-24px)] bg-surface border border-line rounded-[var(--r-lg)] shadow-card-lg p-1.5 animate-menu-in"
          style={{ top: pos.top, left: pos.left, right: pos.right }}
        >
          {visible.map((item, i) => (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick() }}
              className={cn(
                'w-full text-left px-3 py-2.5 rounded-[var(--r-sm)] text-sm font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none',
                toneClass[item.tone ?? 'default'],
              )}
            >
              {item.label}
            </button>
          ))}
          {note && (
            <p className="px-3 py-2 text-[11px] text-text-faint border-t border-line mt-1">{note}</p>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

export default ActionMenu

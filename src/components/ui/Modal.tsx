import { useEffect, type ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { useLanguage } from '@/contexts/LanguageContext'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  width?: string
  className?: string
  noPadding?: boolean
}

export function Modal({ open, onClose, title, children, width = 'min(680px,100%)', className, noPadding }: ModalProps) {
  const { t } = useLanguage()
  // Lock body scroll when modal is open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 pb-[calc(1rem+var(--safe-b))] animate-scrim-in"
      style={{ background: 'var(--scrim)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={cn(
          'relative max-h-[90vh] overflow-auto rounded-[var(--r-xl)] shadow-card-lg',
          'bg-surface border border-line animate-modal-in',
          className,
        )}
        style={{ width }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className={cn(
            'sticky top-0 float-right mt-3 mr-3 z-10',
            'w-9 h-9 rounded-[11px] border border-line bg-surface text-text-dim',
            'inline-flex items-center justify-center',
            'hover:text-text hover:border-line-strong hover:-translate-y-px transition-all duration-150',
            'active:scale-90',
          )}
        >
          <XIcon />
        </button>

        {!noPadding ? (
          <div className="px-6 pb-7 pt-5">
            {title && <h2 className="text-xl mb-4">{title}</h2>}
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  )
}

// ─── SMALL ICON ──────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ─── CONFIRM DIALOG ──────────────────────────────────────────────────────────

interface ConfirmProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  loading?: boolean
}

export function ConfirmDialog({
  open, onClose, onConfirm, title, message,
  confirmLabel,
  destructive = false,
  loading = false,
}: ConfirmProps) {
  const { t } = useLanguage()
  return (
    <Modal open={open} onClose={onClose} title={title} width="min(400px,100%)">
      <p className="text-sm text-text-dim leading-relaxed">{message}</p>
      <div className="flex gap-2 justify-end mt-5">
        <button
          onClick={onClose}
          className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-[var(--r-sm)] bg-section text-text-dim hover:bg-surface-soft transition-colors"
        >
          {t('common.cancel')}
        </button>
        <button
          onClick={onConfirm}
          disabled={loading}
          className={cn(
            'inline-flex items-center px-4 py-2 text-sm font-semibold rounded-[var(--r-sm)] transition-colors disabled:opacity-50',
            destructive
              ? 'bg-danger-soft text-danger hover:bg-danger hover:text-white'
              : 'bg-primary text-primary-on hover:bg-primary-hover',
          )}
        >
          {loading ? t('common.processing') : (confirmLabel ?? t('common.confirm'))}
        </button>
      </div>
    </Modal>
  )
}

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { cn } from '@/utils/cn'

type ToastKind = 'default' | 'ok' | 'err' | 'warn'

interface ToastItem {
  id: string
  message: string
  detail?: string
  kind: ToastKind
}

export interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void
  ok:    (message: string, detail?: string) => void
  err:   (message: string, detail?: string) => void
  warn:  (message: string, detail?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((message: string, kind: ToastKind, detail?: string) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev.slice(-2), { id, message, detail, kind }])
    const timeout = kind === 'err' ? 6000 : 3500
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), timeout)
  }, [])

  const toast = useCallback((message: string, kind: ToastKind = 'default') => push(message, kind), [push])
  const ok    = useCallback((message: string, detail?: string) => push(message, 'ok',   detail), [push])
  const err   = useCallback((message: string, detail?: string) => push(message, 'err',  detail), [push])
  const warn  = useCallback((message: string, detail?: string) => push(message, 'warn', detail), [push])

  return (
    <ToastContext.Provider value={{ toast, ok, err, warn }}>
      {children}
      <div
        aria-live="polite"
        className="fixed left-1/2 -translate-x-1/2 bottom-[calc(20px+var(--safe-b,0px))] z-[200] flex flex-col items-center gap-2 pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto text-sm font-medium px-4 py-2.5 rounded-xl shadow-card-lg max-w-[90vw] text-center',
              'animate-spring-in',
              t.kind === 'ok'      && 'bg-success text-white',
              t.kind === 'err'     && 'bg-danger text-white',
              t.kind === 'warn'    && 'bg-warning text-[#1a1206]',
              t.kind === 'default' && 'bg-text text-bg',
            )}
          >
            <span>{t.message}</span>
            {t.detail && <span className="opacity-75 ml-1.5 text-[0.82em]">{t.detail}</span>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}

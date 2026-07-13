import { cn } from '@/utils/cn'
import { useLanguage } from '@/contexts/LanguageContext'
import type { SyncStatus } from '@/types'

const config: Record<SyncStatus, { labelKey: string; colorClass: string }> = {
  local:   { labelKey: 'sync.savedLocally', colorClass: 'text-text-faint bg-section' },
  pending: { labelKey: 'sync.pendingSync',  colorClass: 'text-warning bg-warning-soft' },
  synced:  { labelKey: 'sync.synced',       colorClass: 'text-success bg-success-soft' },
  failed:  { labelKey: 'sync.syncFailed',   colorClass: 'text-danger bg-danger-soft' },
}

interface SyncStatusBadgeProps {
  status: SyncStatus
  onRetry?: () => void
  className?: string
}

export function SyncStatusBadge({ status, onRetry, className }: SyncStatusBadgeProps) {
  const { t } = useLanguage()
  const { labelKey, colorClass } = config[status]

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full', colorClass, className)}>
      <StatusIcon status={status} />
      {t(labelKey)}
      {status === 'failed' && onRetry && (
        <button
          onClick={onRetry}
          className="ml-1 underline text-[11px] hover:no-underline"
        >
          {t('sync.retry')}
        </button>
      )}
    </span>
  )
}

function StatusIcon({ status }: { status: SyncStatus }) {
  if (status === 'synced') return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
  if (status === 'failed') return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
  if (status === 'pending') return (
    <svg className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  )
  return <span className="w-2 h-2 rounded-full bg-current inline-block" />
}

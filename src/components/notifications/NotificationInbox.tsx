import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, Modal, EmptyState } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { useLanguage } from '@/contexts/LanguageContext'
import { timeAgo, formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { Notification, NotificationCategory, NotificationPriority } from '@/types'

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function categoryVariant(cat: NotificationCategory | undefined): 'success' | 'warning' | 'danger' | 'primary' | 'neutral' {
  switch (cat) {
    case 'score':      return 'success'
    case 'reminder':   return 'warning'
    case 'system':     return 'danger'
    case 'tournament': return 'primary'
    default:           return 'neutral'
  }
}

function priorityVariant(p: NotificationPriority | undefined): 'danger' | 'warning' | null {
  if (p === 'urgent') return 'danger'
  if (p === 'high')   return 'warning'
  return null
}

/** Category → translation key ('notifCategory.*'); resolved via t() at render. */
function categoryLabelKey(cat: NotificationCategory | undefined): string {
  return `notifCategory.${cat ?? 'announcement'}`
}

// ─── COMPONENT ───────────────────────────────────────────────────────────────

interface Props {
  profileId: string
}

export function NotificationInbox({ profileId }: Props) {
  const { t } = useLanguage()
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Notification | null>(null)
  const now = new Date().toISOString()

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['notifications', profileId],
    enabled: !!profileId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*, notification_reads!left(read_at)')
        .not('published_at', 'is', null)
        .lte('published_at', now)
        .or(`expires_at.is.null,expires_at.gt.${now}`)
        .order('published_at', { ascending: false })
        .limit(100)
      if (error) { console.warn('Notifications query failed:', error.message); return [] }
      return (data ?? []).map((n: any) => ({
        ...n,
        is_read: (n.notification_reads ?? []).length > 0,
      })) as Notification[]
    },
  })

  const markRead = useMutation({
    mutationFn: async (notifId: string) => {
      await supabase.from('notification_reads').upsert({
        notification_id: notifId,
        profile_id: profileId,
        read_at: new Date().toISOString(),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications', profileId] })
      void qc.invalidateQueries({ queryKey: ['nav-unread-notifications'] })
    },
  })

  const markAllRead = useMutation({
    mutationFn: async () => {
      const unread = notifications.filter((n) => !n.is_read)
      if (unread.length === 0) return
      const rows = unread.map((n) => ({
        notification_id: n.id,
        profile_id: profileId,
        read_at: new Date().toISOString(),
      }))
      await supabase.from('notification_reads').upsert(rows)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications', profileId] })
      void qc.invalidateQueries({ queryKey: ['nav-unread-notifications'] })
    },
  })

  const unreadCount = notifications.filter((n) => !n.is_read).length

  function openNotif(n: Notification) {
    setSelected(n)
    if (!n.is_read) markRead.mutate(n.id)
  }

  const cardTitle = unreadCount > 0
    ? `${t('notifications.title')} (${unreadCount} ${t('notifInbox.unread')})`
    : t('notifications.title')

  return (
    <>
      <SectionCard
        title={cardTitle}
        action={
          unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAllRead.mutate()}
              loading={markAllRead.isPending}
            >
              {t('notifications.markAllRead')}
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <div className="py-10 text-center text-text-faint text-sm">{t('common.loading')}</div>
        ) : notifications.length === 0 ? (
          <EmptyState
            title={t('notifications.empty')}
            description={t('notifInbox.caughtUp')}
          />
        ) : (
          <div className="divide-y divide-line">
            {notifications.map((n) => {
              const pvBadge = priorityVariant(n.priority)
              return (
                <button
                  key={n.id}
                  onClick={() => openNotif(n)}
                  className={cn(
                    'w-full text-left px-4 py-4 flex gap-3 transition-colors hover:bg-surface-soft',
                    !n.is_read && 'bg-primary-soft/30',
                  )}
                >
                  <div className="flex-shrink-0 pt-1.5">
                    {!n.is_read
                      ? <span className="w-2 h-2 rounded-full bg-primary block" />
                      : <span className="w-2 h-2 rounded-full bg-line-strong block" />
                    }
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                        {n.category && n.category !== 'announcement' && (
                          <Badge variant={categoryVariant(n.category)} className="text-[9px] shrink-0">
                            {t(categoryLabelKey(n.category))}
                          </Badge>
                        )}
                        {pvBadge && (
                          <Badge variant={pvBadge} className="text-[9px] shrink-0">
                            {t(`notifPriority.${n.priority}`)}
                          </Badge>
                        )}
                        <span className={cn(
                          'font-semibold text-sm leading-tight truncate',
                          !n.is_read ? 'text-text' : 'text-text-dim',
                        )}>
                          {n.title}
                        </span>
                      </div>
                      <div className="text-[11px] text-text-faint flex-shrink-0">
                        {n.published_at ? timeAgo(n.published_at) : ''}
                      </div>
                    </div>
                    <p className="text-xs text-text-dim mt-1 leading-relaxed line-clamp-2">
                      {n.body}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Detail modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.title}
        width="min(520px,100%)"
      >
        {selected && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {selected.category && selected.category !== 'announcement' && (
                <Badge variant={categoryVariant(selected.category)} className="text-[10px]">
                  {t(categoryLabelKey(selected.category))}
                </Badge>
              )}
              {priorityVariant(selected.priority) && (
                <Badge variant={priorityVariant(selected.priority)!} className="text-[10px]">
                  {t(`notifPriority.${selected.priority}`)}
                </Badge>
              )}
              <span className="ml-auto text-xs text-text-faint">
                {selected.published_at ? formatDate(selected.published_at) : ''}
              </span>
            </div>
            {(selected as { image_url?: string | null }).image_url && (
              <img
                src={(selected as { image_url?: string | null }).image_url!}
                alt=""
                className="w-full max-h-64 object-cover rounded-[var(--r-sm)] border border-line"
              />
            )}
            <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">{selected.body}</p>
          </div>
        )}
      </Modal>
    </>
  )
}

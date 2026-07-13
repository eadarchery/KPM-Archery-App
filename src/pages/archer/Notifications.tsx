import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { EmptyState } from '@/components/ui/EmptyState'
import { RedDot } from '@/components/ui/RedDot'
import { useAuth } from '@/hooks/useAuth'
import { useRuleValue } from '@/hooks/useSystemRules'
import { isOperationalAdmin } from '@/lib/permissions'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { supabase } from '@/services/supabase'
import { useLanguage } from '@/contexts/LanguageContext'
import { timeAgo } from '@/utils/dates'
import type { Notification } from '@/types'
import { cn } from '@/utils/cn'

export default function ArcherNotifications() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const qc = useQueryClient()
  const moduleEnabled = useRuleValue<boolean>('module_notifications_enabled', true)

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['notifications', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select(`*, notification_reads!left(read_at)`)
        .not('published_at', 'is', null)
        .order('published_at', { ascending: false })

      if (error) { console.warn('Notifications query failed:', error.message); return [] }

      return (data ?? []).map((n: any) => ({
        ...n,
        is_read: n.notification_reads?.length > 0,
      })) as Notification[]
    },
  })

  const markRead = useMutation({
    mutationFn: async (notifId: string) => {
      await supabase.from('notification_reads').upsert({
        notification_id: notifId,
        profile_id: profile!.id,
        read_at: new Date().toISOString(),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications', profile?.id] })
      void qc.invalidateQueries({ queryKey: ['nav-unread-notifications'] })
    },
  })

  const unreadCount = notifications.filter((n) => !n.is_read).length

  if (!moduleEnabled && !isOperationalAdmin(profile?.role)) {
    return (
      <FeatureUnavailable
        title={t('notifPage.unavailable')}
        message={t('notifPage.unavailableHint')}
      />
    )
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('notifications.title')}
        pill={unreadCount > 0 ? (
          <span className="text-xs font-semibold text-primary bg-primary-soft px-2.5 py-1 rounded-full">
            {unreadCount} {t('notifInbox.unread')}
          </span>
        ) : undefined}
      />

      <SectionCard>
        {isLoading ? (
          <div className="py-10 text-center text-text-faint text-sm">{t('common.loading')}</div>
        ) : notifications.length ? (
          <div className="divide-y divide-line">
            {notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.is_read && markRead.mutate(n.id)}
                className={cn(
                  'w-full text-left px-4 py-4 flex gap-3 transition-colors hover:bg-surface-soft',
                  !n.is_read && 'bg-primary-soft/40',
                )}
              >
                <div className="flex-shrink-0 pt-0.5">
                  {!n.is_read ? (
                    <RedDot show className="mt-1" />
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-line-strong mt-1" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className={cn('font-semibold text-sm', !n.is_read ? 'text-text' : 'text-text-dim')}>
                      {n.title}
                    </div>
                    <div className="text-[11px] text-text-faint flex-shrink-0">
                      {n.published_at ? timeAgo(n.published_at) : ''}
                    </div>
                  </div>
                  <p className="text-xs text-text-dim mt-0.5 leading-relaxed line-clamp-2">{n.body}</p>
                  {(n as { image_url?: string | null }).image_url && (
                    <img
                      src={(n as { image_url?: string | null }).image_url!}
                      alt=""
                      className="mt-2 w-full max-h-44 object-cover rounded-[var(--r-sm)] border border-line"
                    />
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState title={t('notifPage.empty')} description={t('notifPage.emptyHint')} />
        )}
      </SectionCard>
    </PageWrapper>
  )
}

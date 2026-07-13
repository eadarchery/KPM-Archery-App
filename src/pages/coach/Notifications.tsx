import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import { NotificationInbox } from '@/components/notifications/NotificationInbox'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import { isOperationalAdmin } from '@/lib/permissions'

export default function CoachNotifications() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const moduleEnabled = useRuleValue<boolean>('module_notifications_enabled', true)

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
        description={t('notifPage.coachDescription')}
      />
      {profile?.id && <NotificationInbox profileId={profile.id} />}
    </PageWrapper>
  )
}

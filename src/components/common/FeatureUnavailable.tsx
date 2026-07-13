import { PageWrapper, SectionCard } from '@/components/layout/PageWrapper'
import { EmptyState } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'

/**
 * Reusable "this module is turned off" state. Rendered when a `module_*`
 * system rule is disabled. Default copy is translated (BM default + EN);
 * callers may override with a specific title/message.
 */
export function FeatureUnavailable({
  title,
  message,
}: {
  title?: string
  message?: string
}) {
  const { t } = useLanguage()
  return (
    <PageWrapper>
      <SectionCard>
        <EmptyState title={title ?? t('feature.title')} description={message ?? t('feature.message')} />
      </SectionCard>
    </PageWrapper>
  )
}

export default FeatureUnavailable

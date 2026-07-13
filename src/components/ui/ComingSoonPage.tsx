import { useNavigate } from 'react-router-dom'
import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import { useLanguage } from '@/contexts/LanguageContext'

interface ComingSoonPageProps {
  title: string
  description?: string
  icon?: string
  backPath?: string
  backLabel?: string
}

export function ComingSoonPage({
  title,
  description,
  icon = '🚧',
  backPath,
  backLabel,
}: ComingSoonPageProps) {
  const navigate = useNavigate()
  const { t } = useLanguage()

  return (
    <PageWrapper narrow>
      <PageHead title={title} description={description} />
      <div className="card flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="text-5xl select-none">{icon}</div>
        <div>
          <p className="text-[17px] font-display font-semibold text-text">{t('comingSoon.badge')}</p>
          <p className="text-sm text-text-dim mt-1 max-w-[340px]">
            {t('comingSoon.description')}
          </p>
        </div>
        {backPath && (
          <button
            onClick={() => navigate(backPath)}
            className="mt-2 px-4 py-2 rounded-[var(--r)] bg-primary text-primary-on text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            {backLabel ?? t('comingSoon.goBack')}
          </button>
        )}
      </div>
    </PageWrapper>
  )
}

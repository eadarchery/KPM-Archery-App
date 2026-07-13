import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import type { Role } from '@/types'

const DEFAULT_PATHS: Record<Role, string> = {
  archer:      '/archer/dashboard',
  coach:       '/coach/dashboard',
  admin1:      '/admin1/overview',
  admin2:      '/admin2/centre',
  super_admin: '/super-admin/settings',
}

export default function NotFound() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()

  const home = profile ? DEFAULT_PATHS[profile.role] : '/login'

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="text-[80px] font-display font-bold text-text-faint opacity-20 leading-none mb-4">
        404
      </div>
      <h2 className="text-2xl mb-2">{t('notFound.title')}</h2>
      <p className="text-sm text-text-dim mb-6 max-w-sm">
        {t('notFound.message')}
      </p>
      <Button onClick={() => navigate(home)} variant="primary">
        {t('notFound.goDashboard')}
      </Button>
    </div>
  )
}

import { useNavigate } from 'react-router-dom'
import { PageWrapper } from '@/components/layout/PageWrapper'
import { Button } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { getHomePath } from '@/lib/permissions'

interface AccessDeniedProps {
  /** Optional override of the default copy (e.g. a page-specific reason). */
  title?: string
  message?: string
  /** Show a "Go back" button in addition to the dashboard button. Default true. */
  showBack?: boolean
}

/**
 * Friendly access-denied screen. Use this for page-level or action-level
 * permission failures where a silent redirect would be confusing
 * (e.g. a deep link a role may not open). Top-level section guards in
 * src/App.tsx still redirect to the role's own dashboard.
 *
 * Default copy is translated (BM default + EN). Callers may still pass a
 * specific `title`/`message`; those are shown verbatim.
 */
export function AccessDenied({ title, message, showBack = true }: AccessDeniedProps) {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const home = getHomePath(profile?.role)

  return (
    <PageWrapper narrow>
      <div className="flex flex-col items-center justify-center text-center py-20 gap-4">
        <div
          className="w-16 h-16 rounded-[18px] flex items-center justify-center"
          style={{ background: 'var(--danger-soft)' }}
        >
          <LockIcon />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-2xl font-display font-semibold text-text">{title ?? t('access.title')}</h2>
          <p className="text-text-dim text-sm max-w-sm mx-auto leading-relaxed">{message ?? t('access.message')}</p>
        </div>

        <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
          <Button variant="primary" onClick={() => navigate(home)}>
            {t('access.goDashboard')}
          </Button>
          {showBack && (
            <Button variant="ghost" onClick={() => navigate(-1)}>
              {t('access.goBack')}
            </Button>
          )}
        </div>
      </div>
    </PageWrapper>
  )
}

function LockIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--danger)"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      <circle cx="12" cy="16" r="1" />
    </svg>
  )
}

export default AccessDenied

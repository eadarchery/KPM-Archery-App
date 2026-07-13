import { useSignOut } from '@/hooks/useAuth'
import { Button } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'

/**
 * Full-screen maintenance notice. Shown to non-admin users (archer, coach,
 * Admin 1) when the `maintenance_mode` system rule is on. Admin 2 and Super
 * Admin keep full access (handled by the caller in AppLayout).
 *
 * Copy is translated (BM default + EN).
 */
export function MaintenanceMode() {
  const signOut = useSignOut()
  const { t } = useLanguage()

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'var(--bg)' }}
    >
      <div className="max-w-md text-center space-y-4">
        <div
          className="w-16 h-16 mx-auto rounded-[18px] flex items-center justify-center"
          style={{ background: 'var(--warning-soft)' }}
        >
          <WrenchIcon />
        </div>
        <h1 className="text-2xl font-display font-semibold text-text">{t('maintenance.title')}</h1>
        <p className="text-text-dim text-sm leading-relaxed">
          {t('maintenance.message')}
        </p>
        <Button variant="ghost" onClick={() => signOut()}>
          {t('maintenance.logout')}
        </Button>
      </div>
    </div>
  )
}

function WrenchIcon() {
  return (
    <svg
      width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.3L3 18l3 3 6.4-6.3a4 4 0 0 0 5.3-5.4l-2.6 2.6-2.3-.6-.6-2.3 2.5-2.7z" />
    </svg>
  )
}

export default MaintenanceMode

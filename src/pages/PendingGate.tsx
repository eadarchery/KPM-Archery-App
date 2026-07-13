import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui'
import { AccountStatusBadge, RoleBadge } from '@/components/ui/Badge'
import { useAuth, useSignOut } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'

export default function PendingGate() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const signOut = useSignOut()

  if (!profile) return null

  const isRejected = profile.status === 'rejected'

  return (
    <AuthLayout>
      <div className="w-full max-w-[480px]">
        <div className="card text-center py-10 px-8">
          {/* Icon */}
          <div
            className={`w-16 h-16 rounded-full mx-auto mb-5 flex items-center justify-center ${isRejected ? 'bg-danger-soft' : 'bg-warning-soft'}`}
          >
            {isRejected ? (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-danger">
                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            ) : (
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            )}
          </div>

          <h2 className="text-xl mb-2">
            {isRejected ? t('pendingGate.rejectedTitle') : t('pendingGate.pendingTitle')}
          </h2>

          <p className="text-sm text-text-dim mb-4">
            {t('pendingGate.signedInAs')} <span className="font-semibold text-text">{profile.email}</span>
          </p>

          <div className="flex items-center justify-center gap-2 mb-5">
            <AccountStatusBadge status={profile.status} />
            <RoleBadge role={profile.role} />
          </div>

          {isRejected ? (
            <p className="text-sm text-text-dim leading-relaxed">
              {t('pendingGate.rejectedBody')}
              {profile.rejection_reason && (
                <span className="block mt-2 p-3 bg-danger-soft text-danger text-xs rounded-[var(--r-sm)] text-left">
                  <span className="font-semibold">{t('common.reason')}: </span>{profile.rejection_reason}
                </span>
              )}
              <span className="block mt-2">
                {t('pendingGate.contactAdmin')}
              </span>
            </p>
          ) : (
            <div className="text-sm text-text-dim leading-relaxed text-left space-y-3">
              <p>{t('pendingGate.pendingBody')}</p>
              {profile.role === 'archer' && (
                <p>{t('pendingGate.archerHint')}</p>
              )}
              {profile.role === 'coach' && (
                <p>{t('pendingGate.coachHint')}</p>
              )}
              {['admin1', 'admin2'].includes(profile.role) && (
                <p>{t('pendingGate.adminHint')}</p>
              )}
              <p className="text-xs text-text-faint">{t('pendingGate.checkBack')}</p>
            </div>
          )}

          <Button
            variant="ghost"
            onClick={signOut}
            className="mt-6 w-full"
          >
            {t('pendingGate.signOut')}
          </Button>
        </div>
      </div>
    </AuthLayout>
  )
}

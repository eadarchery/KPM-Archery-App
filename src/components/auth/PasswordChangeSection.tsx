import { useState } from 'react'
import { Button, useToast } from '@/components/ui'
import { PasswordChangeModal } from './PasswordChangeModal'
import { updatePassword, sendPasswordResetEmail } from '@/services/auth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useAuth } from '@/hooks/useAuth'

interface PasswordChangeSectionProps {
  className?: string
}

export function PasswordChangeSection({ className = '' }: PasswordChangeSectionProps) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const { profile } = useAuth()
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [showForgotModal, setShowForgotModal] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)

  const handlePasswordChange = async (newPassword: string) => {
    if (!newPassword.trim()) {
      throw new Error('Password is required')
    }
    await updatePassword(newPassword)
  }

  const handleForgotPassword = async () => {
    if (!profile?.email) {
      err('Email not found')
      return
    }

    setForgotLoading(true)
    try {
      await sendPasswordResetEmail(profile.email)
      ok('Password reset link sent to your email')
      setShowForgotModal(false)
    } catch (error) {
      err((error as Error).message || 'Failed to send reset email')
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <>
      <div className={`card space-y-4 ${className}`}>
        <div>
          <h3 className="text-base font-semibold text-text mb-1">Password & Security</h3>
          <p className="text-sm text-text-dim">Manage your account password and security settings</p>
        </div>

        <div className="border-t border-line pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">Change Password</p>
              <p className="text-xs text-text-faint mt-0.5">Update your password regularly for better security</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPasswordModal(true)}
            >
              Change Password
            </Button>
          </div>
        </div>

        <div className="border-t border-line pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text">Forgot Password?</p>
              <p className="text-xs text-text-faint mt-0.5">Reset your password via email</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleForgotPassword}
              loading={forgotLoading}
            >
              Send Reset Link
            </Button>
          </div>
        </div>

        <div className="bg-primary-soft rounded-[var(--r-sm)] px-3 py-2.5 text-xs text-primary">
          <p className="font-semibold mb-1">🔒 Security Tips:</p>
          <ul className="space-y-1 text-primary/90">
            <li>• Use a strong password with uppercase, lowercase, numbers, and special characters</li>
            <li>• Never share your password with anyone</li>
            <li>• Change your password if you suspect unauthorized access</li>
            <li>• Use a unique password not used on other websites</li>
          </ul>
        </div>
      </div>

      <PasswordChangeModal
        open={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        onSubmit={handlePasswordChange}
        isAdmin={false}
        showForgotPassword={true}
        onForgotPasswordClick={handleForgotPassword}
      />
    </>
  )
}

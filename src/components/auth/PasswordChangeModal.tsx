import { useState } from 'react'
import { Button, Modal, Input, useToast } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'

interface PasswordChangeModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (password: string) => Promise<void>
  isAdmin?: boolean
  userName?: string
  userEmail?: string
  showForgotPassword?: boolean
  onForgotPasswordClick?: () => void
}

const validatePassword = (pwd: string): string[] => {
  const errors: string[] = []
  if (pwd.length < 8) errors.push('At least 8 characters')
  if (!/[A-Z]/.test(pwd)) errors.push('One uppercase letter')
  if (!/[a-z]/.test(pwd)) errors.push('One lowercase letter')
  if (!/[0-9]/.test(pwd)) errors.push('One number')
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(pwd)) errors.push('One special character')
  return errors
}

export function PasswordChangeModal({
  open, onClose, onSubmit, isAdmin = false, userName, userEmail, showForgotPassword = false, onForgotPasswordClick,
}: PasswordChangeModalProps) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false)

  const passwordErrors = validatePassword(password)
  const passwordsMatch = password === passwordConfirm && password.length > 0
  const isValid = passwordErrors.length === 0 && passwordsMatch

  const handleSubmit = async () => {
    if (!password.trim()) {
      err('Password is required')
      return
    }

    if (passwordErrors.length > 0) {
      err('Password does not meet requirements')
      return
    }

    if (!passwordsMatch) {
      err('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await onSubmit(password)
      ok(isAdmin ? 'Password reset successfully' : 'Password changed successfully')
      setPassword('')
      setPasswordConfirm('')
      onClose()
    } catch (error) {
      err((error as Error).message || 'Failed to update password')
    } finally {
      setLoading(false)
    }
  }

  const onOpenChange = (opened: boolean) => {
    if (!opened) {
      setPassword('')
      setPasswordConfirm('')
      onClose()
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => onOpenChange(false)}
      title={isAdmin ? `Reset Password${userName ? ` - ${userName}` : ''}` : 'Change Password'}
      width="min(480px,100%)"
    >
      <div className="space-y-4">
        {isAdmin && (
          <div className="space-y-2">
            <div className="bg-warning-soft text-warning text-sm rounded-[var(--r-sm)] px-3 py-2">
              <p className="font-semibold mb-1">🔐 Admin Password Reset</p>
              <p className="text-xs leading-relaxed">
                Enter a new password below. The user will see this password and must use it to log in.
                For security, consider sending them a password reset email instead (user sets their own password).
              </p>
            </div>
            {userEmail && (
              <div className="bg-primary-soft text-primary text-xs rounded-[var(--r-sm)] px-3 py-2 flex items-start gap-2">
                <span className="mt-0.5">ℹ️</span>
                <span>
                  <strong>Email on file:</strong> {userEmail}
                </span>
              </div>
            )}
          </div>
        )}

        {showForgotPassword && !isAdmin && (
          <div className="bg-primary-soft text-primary text-xs rounded-[var(--r-sm)] px-3 py-2">
            <p>
              <button
                type="button"
                onClick={onForgotPasswordClick}
                className="font-semibold underline hover:opacity-80"
              >
                Forgot your password?
              </button>
              {' '}You can reset it via email instead.
            </p>
          </div>
        )}

        <div>
          <label className="text-sm font-semibold text-text-dim mb-2 block">
            New Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter new password"
              className="field w-full pr-10"
              autoComplete={isAdmin ? 'off' : 'new-password'}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text text-sm"
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>

          {password && passwordErrors.length > 0 && (
            <ul className="mt-2 text-xs text-danger space-y-1">
              {passwordErrors.map((err, i) => (
                <li key={i}>❌ {err}</li>
              ))}
            </ul>
          )}

          {password && passwordErrors.length === 0 && (
            <p className="mt-2 text-xs text-success">✓ Password meets requirements</p>
          )}
        </div>

        <div>
          <label className="text-sm font-semibold text-text-dim mb-2 block">
            Confirm Password
          </label>
          <div className="relative">
            <input
              type={showPasswordConfirm ? 'text' : 'password'}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              placeholder="Re-enter password"
              className="field w-full pr-10"
              autoComplete={isAdmin ? 'off' : 'new-password'}
            />
            <button
              type="button"
              onClick={() => setShowPasswordConfirm(!showPasswordConfirm)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-dim hover:text-text text-sm"
            >
              {showPasswordConfirm ? '🙈' : '👁️'}
            </button>
          </div>

          {password && passwordConfirm && !passwordsMatch && (
            <p className="mt-2 text-xs text-danger">❌ Passwords do not match</p>
          )}

          {passwordsMatch && (
            <p className="mt-2 text-xs text-success">✓ Passwords match</p>
          )}
        </div>

        <div className="bg-surface-soft rounded-[var(--r-sm)] px-3 py-2.5">
          <p className="text-xs font-semibold text-text-dim mb-2">Password Requirements:</p>
          <ul className="text-xs text-text-dim space-y-1">
            <li className={passwordErrors.includes('At least 8 characters') ? 'text-danger' : 'text-success'}>
              {passwordErrors.includes('At least 8 characters') ? '❌' : '✓'} Minimum 8 characters
            </li>
            <li className={passwordErrors.includes('One uppercase letter') ? 'text-danger' : 'text-success'}>
              {passwordErrors.includes('One uppercase letter') ? '❌' : '✓'} At least one uppercase letter (A-Z)
            </li>
            <li className={passwordErrors.includes('One lowercase letter') ? 'text-danger' : 'text-success'}>
              {passwordErrors.includes('One lowercase letter') ? '❌' : '✓'} At least one lowercase letter (a-z)
            </li>
            <li className={passwordErrors.includes('One number') ? 'text-danger' : 'text-success'}>
              {passwordErrors.includes('One number') ? '❌' : '✓'} At least one number (0-9)
            </li>
            <li className={passwordErrors.includes('One special character') ? 'text-danger' : 'text-success'}>
              {passwordErrors.includes('One special character') ? '❌' : '✓'} At least one special character (!@#$%^&*...)
            </li>
          </ul>
        </div>

        <div className="flex gap-2 justify-end pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            disabled={!isValid}
            onClick={handleSubmit}
          >
            {isAdmin ? 'Reset Password' : 'Change Password'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

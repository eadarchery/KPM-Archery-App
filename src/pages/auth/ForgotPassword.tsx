import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui/Input'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { isEmailRateLimitError } from '@/services/auth'
import { CaptchaWidget, captchaEnabled } from '@/components/auth/CaptchaWidget'
import { useCooldown } from '@/hooks/useCooldown'

const isValidEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

/** Detect Supabase CAPTCHA verification failures without leaking raw errors. */
function isCaptchaError(error: unknown): boolean {
  const msg = ((error as { message?: string } | null)?.message ?? '').toLowerCase()
  return msg.includes('captcha')
}

export default function ForgotPassword() {
  const { t } = useLanguage()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  // 60s between requests on this device; server-side limits still apply on top.
  const cooldown = useCooldown('forgot-password', 60)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!email.trim()) { setError(t('auth.validation.emailRequired')); return }
    if (!isValidEmail(email)) { setError(t('auth.validation.emailInvalid')); return }
    if (cooldown.active) { setError(t('auth.forgotPassword.tooManyAttempts')); return }
    if (captchaEnabled() && !captchaToken) { setError(t('auth.captcha.required')); return }

    setLoading(true)
    try {
      // Supabase does not reveal whether the email exists; we always show the
      // same safe message on success regardless.
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          redirectTo: `${window.location.origin}/reset-password`,
          ...(captchaToken ? { captchaToken } : {}),
        },
      )
      if (resetError) throw resetError
      cooldown.start()
      setSent(true)
    } catch (err) {
      // Map to friendly, non-revealing messages. Never surface raw auth errors
      // or confirm account existence.
      if (isEmailRateLimitError(err)) {
        setError(t('auth.forgotPassword.tooManyAttempts'))
      } else if (isCaptchaError(err)) {
        setError(t('auth.captcha.failed'))
        setCaptchaToken(null)
      } else {
        setError(t('auth.forgotPassword.genericError'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-[440px] rounded-[var(--r-xl)] shadow-card-lg bg-surface border border-line p-7 sm:p-8">
        <h1 className="text-xl font-display font-semibold text-text mb-1.5">{t('auth.forgotPassword.title')}</h1>
        <p className="text-sm text-text-dim mb-6 leading-relaxed">{t('auth.forgotPassword.description')}</p>

        {sent ? (
          <div className="space-y-5">
            <div className="bg-success-soft text-success text-sm font-medium px-4 py-3 rounded-[var(--r-sm)] leading-relaxed">
              {t('auth.forgotPassword.safeSuccess')}
            </div>
            <Link to="/login" className="block">
              <Button variant="primary" size="lg" className="w-full">{t('auth.forgotPassword.backToLogin')}</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {error && (
              <div className="bg-danger-soft text-danger text-sm font-medium px-3 py-2.5 rounded-[var(--r-sm)]">{error}</div>
            )}

            <Input
              label={t('auth.forgotPassword.email')}
              type="email"
              placeholder="name@email.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <CaptchaWidget onToken={setCaptchaToken} />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              disabled={cooldown.active}
              className="w-full"
            >
              {cooldown.active
                ? t('auth.forgotPassword.waitCooldown', { seconds: cooldown.remaining })
                : t('auth.forgotPassword.sendResetLink')}
            </Button>
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-line flex flex-col items-center gap-2 text-sm">
          <Link to="/login" className="text-text-dim hover:text-text transition-colors">
            {t('auth.forgotPassword.backToLogin')}
          </Link>
          <Link to="/forgot-email" className="text-primary font-medium hover:underline">
            {t('auth.forgotPassword.forgotEmailLink')}
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}

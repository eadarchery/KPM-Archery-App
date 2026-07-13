import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button, useToast } from '@/components/ui'
import { Input } from '@/components/ui/Input'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'

type Phase = 'checking' | 'ready' | 'invalid' | 'done'

/**
 * Reset Password — the destination of the Supabase recovery email link.
 *
 * This route is intentionally NOT wrapped in RequireGuest: Supabase establishes
 * a PASSWORD_RECOVERY session from the link (detectSessionInUrl), which would
 * otherwise be treated as "logged in" and redirected away. We detect that
 * recovery session here, let the user set a new password via updateUser, then
 * sign out so they log in fresh with the new password.
 */
export default function ResetPassword() {
  const { t } = useLanguage()
  const { ok } = useToast()
  const navigate = useNavigate()

  const [phase, setPhase] = useState<Phase>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Detect the recovery session created from the email link.
  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) setPhase((p) => (p === 'done' ? p : 'ready'))
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setPhase((p) => (p === 'done' ? p : 'ready'))
      }
    })

    // If no session has appeared shortly after load, the link is invalid/expired.
    const timer = setTimeout(() => {
      setPhase((p) => (p === 'checking' ? 'invalid' : p))
    }, 2500)

    return () => { mounted = false; subscription.unsubscribe(); clearTimeout(timer) }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!password) { setError(t('auth.validation.passwordRequired')); return }
    if (password.length < 8) { setError(t('auth.validation.passwordTooShort')); return }
    if (!confirm) { setError(t('auth.validation.confirmPasswordRequired')); return }
    if (password !== confirm) { setError(t('auth.validation.passwordMismatch')); return }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      ok(t('auth.resetPassword.success'))
      // Sign out the recovery session so the user logs in fresh with the new password.
      await supabase.auth.signOut().catch(() => {})
      setPhase('done')
    } catch {
      setError(t('auth.resetPassword.invalidOrExpired'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout>
      <div className="w-full max-w-[440px] rounded-[var(--r-xl)] shadow-card-lg bg-surface border border-line p-7 sm:p-8">
        <h1 className="text-xl font-display font-semibold text-text mb-1.5">{t('auth.resetPassword.title')}</h1>
        <p className="text-sm text-text-dim mb-6 leading-relaxed">{t('auth.resetPassword.description')}</p>

        {phase === 'checking' && (
          <div className="py-10 text-center text-sm text-text-faint">{t('auth.resetPassword.checking')}</div>
        )}

        {phase === 'invalid' && (
          <div className="space-y-5">
            <div className="bg-danger-soft text-danger text-sm font-medium px-4 py-3 rounded-[var(--r-sm)] leading-relaxed">
              {t('auth.resetPassword.invalidOrExpired')}
            </div>
            <Link to="/forgot-password" className="block">
              <Button variant="primary" size="lg" className="w-full">{t('auth.resetPassword.requestNewLink')}</Button>
            </Link>
          </div>
        )}

        {phase === 'done' && (
          <div className="space-y-5">
            <div className="bg-success-soft text-success text-sm font-medium px-4 py-3 rounded-[var(--r-sm)] leading-relaxed">
              {t('auth.resetPassword.success')}
            </div>
            <Button variant="primary" size="lg" className="w-full" onClick={() => navigate('/login', { replace: true })}>
              {t('auth.resetPassword.backToLogin')}
            </Button>
          </div>
        )}

        {phase === 'ready' && (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {error && (
              <div className="bg-danger-soft text-danger text-sm font-medium px-3 py-2.5 rounded-[var(--r-sm)]">{error}</div>
            )}

            <Input
              label={t('auth.resetPassword.newPassword')}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={t('auth.resetPassword.passwordHelp')}
              required
            />
            <Input
              label={t('auth.resetPassword.confirmPassword')}
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />

            <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
              {t('auth.resetPassword.updatePassword')}
            </Button>
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-line text-center text-sm">
          <Link to="/login" className="text-text-dim hover:text-text transition-colors">
            {t('auth.resetPassword.backToLogin')}
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}

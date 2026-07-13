import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button, Textarea } from '@/components/ui'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useLanguage } from '@/contexts/LanguageContext'
import { submitAccountRecoveryRequest } from '@/services/accountRecovery'
import { useCooldown } from '@/hooks/useCooldown'

const EMPTY = {
  fullName: '', role: '', phone: '', archerId: '',
  school: '', state: '', pld: '', coachName: '', notes: '',
}

export default function ForgotEmail() {
  const { t } = useLanguage()
  const [form, setForm] = useState({ ...EMPTY })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  // 2 minutes between requests on this device; the DB trigger (migration 055)
  // enforces the real per-IP + global limits server-side.
  const cooldown = useCooldown('forgot-email', 120)

  const set = (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))

  const roleOptions = [
    { value: 'archer', label: t('roles.archer') },
    { value: 'coach', label: t('roles.coach') },
    { value: 'admin1', label: t('roles.admin1') },
    { value: 'admin2', label: t('roles.admin2') },
  ]

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!form.fullName.trim()) { setError(t('auth.validation.fullNameRequired')); return }
    if (!form.role) { setError(t('auth.validation.roleRequired')); return }
    if (!form.phone.trim()) { setError(t('auth.validation.contactRequired')); return }
    if (cooldown.active) { setError(t('auth.forgotPassword.tooManyAttempts')); return }

    setLoading(true)
    try {
      await submitAccountRecoveryRequest(form)
      cooldown.start()
      setSubmitted(true)
    } catch (e) {
      // Map the DB rate-limit trigger's sentinel to a friendly message; never
      // reveal whether the account exists or any stored data.
      const msg = ((e as Error | null)?.message ?? '').toLowerCase()
      if (msg.includes('rate_limited') || msg.includes('rate limit')) {
        setError(t('auth.forgotPassword.tooManyAttempts'))
      } else {
        setError(t('auth.forgotPassword.genericError'))
      }
    } finally {
      setLoading(false)
    }
  }

  const optional = `(${t('auth.forgotEmail.optional')})`

  return (
    <AuthLayout>
      <div className="w-full max-w-[560px] rounded-[var(--r-xl)] shadow-card-lg bg-surface border border-line p-7 sm:p-8">
        <h1 className="text-xl font-display font-semibold text-text mb-1.5">{t('auth.forgotEmail.title')}</h1>
        <p className="text-sm text-text-dim mb-6 leading-relaxed">{t('auth.forgotEmail.description')}</p>

        {submitted ? (
          <div className="space-y-5">
            <div className="bg-success-soft text-success text-sm font-medium px-4 py-3 rounded-[var(--r-sm)] leading-relaxed">
              {t('auth.forgotEmail.safeSuccess')}
            </div>
            <Link to="/login" className="block">
              <Button variant="primary" size="lg" className="w-full">{t('auth.forgotEmail.backToLogin')}</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
            {error && (
              <div className="bg-danger-soft text-danger text-sm font-medium px-3 py-2.5 rounded-[var(--r-sm)]">{error}</div>
            )}

            <Input label={t('auth.forgotEmail.fullName')} value={form.fullName} onChange={set('fullName')} required />

            <div className="grid sm:grid-cols-2 gap-4">
              <Select
                label={t('auth.forgotEmail.role')}
                options={roleOptions}
                placeholder="—"
                value={form.role}
                onChange={set('role')}
                required
              />
              <Input label={t('auth.forgotEmail.phone')} type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} required />
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <Input label={`${t('auth.forgotEmail.archerId')} ${optional}`} value={form.archerId} onChange={set('archerId')} />
              <Input label={`${t('auth.forgotEmail.coachName')} ${optional}`} value={form.coachName} onChange={set('coachName')} />
            </div>

            <Input label={`${t('auth.forgotEmail.school')} ${optional}`} value={form.school} onChange={set('school')} />

            <div className="grid sm:grid-cols-2 gap-4">
              <Input label={`${t('auth.forgotEmail.state')} ${optional}`} value={form.state} onChange={set('state')} />
              <Input label={`${t('auth.forgotEmail.pld')} ${optional}`} value={form.pld} onChange={set('pld')} />
            </div>

            <Textarea label={`${t('auth.forgotEmail.notes')} ${optional}`} value={form.notes} onChange={set('notes')} minRows={2} />

            <p className="text-xs text-text-faint">{t('auth.forgotEmail.contactHint')}</p>

            <Button type="submit" variant="primary" size="lg" loading={loading} disabled={cooldown.active} className="w-full">
              {cooldown.active
                ? t('auth.forgotPassword.waitCooldown', { seconds: cooldown.remaining })
                : t('auth.forgotEmail.submit')}
            </Button>
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-line text-center text-sm">
          <Link to="/login" className="text-text-dim hover:text-text transition-colors">
            {t('auth.forgotEmail.backToLogin')}
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}

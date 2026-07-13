import { useState, useEffect, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { z } from 'zod'
import { AuthLayout } from '@/layouts/AuthLayout'
import { Button } from '@/components/ui'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useLanguage } from '@/contexts/LanguageContext'
import { useBrandingValue } from '@/hooks/useBranding'
import {
  resolveSchoolCode, claimSchoolCode,
  storePendingSchoolCode, clearPendingSchoolCode,
} from '@/services/schoolRegistration'
import { signIn, signUp, resendConfirmationEmail, isEmailRateLimitError } from '@/services/auth'
import { CaptchaWidget, captchaEnabled } from '@/components/auth/CaptchaWidget'
import { useAuthStore } from '@/store/authStore'
import { getDefaultPermissions } from '@/services/permissions'
import type { Role, Profile } from '@/types'

type Mode = 'signin' | 'register'

// Registration lifecycle — drives the form vs. the "check your email" screen.
type RegStatus =
  | 'idle'
  | 'submitting'
  | 'signupSuccessAwaitingEmail'
  | 'resending'
  | 'resendSuccess'
  | 'rateLimited'
  | 'error'

const RESEND_COOLDOWN_SECONDS = 60

type Translate = (key: string, vars?: Record<string, string | number>) => string

const buildSignInSchema = (t: Translate) => z.object({
  email: z.string().email(t('login.errEmail')),
  password: z.string().min(6, t('login.errPassword')),
})

const buildRegisterSchema = (t: Translate) => buildSignInSchema(t).extend({
  name: z.string().min(2, t('login.errName')),
  role: z.enum(['archer', 'coach'] as const, { required_error: t('login.errRole') }),
  // NEW accounts need ≥8 chars. Sign-in stays at 6 so existing accounts
  // created under the old rule can still log in (and then reset).
  password: z.string().min(8, t('login.errPassword8')),
})

const ROLE_OPTION_KEYS = [
  { value: 'archer', labelKey: 'login.roleArcher' },
  { value: 'coach',  labelKey: 'login.roleCoach' },
]

// ─── DEV BYPASS ──────────────────────────────────────────────────────────────
// Only active in dev builds (import.meta.env.DEV). Stripped in production.

const DEV_ROLES: { role: Role; label: string; path: string; color: string }[] = [
  { role: 'archer',      label: 'Archer',      path: '/archer/dashboard',   color: '#2563eb' },
  { role: 'coach',       label: 'Coach',       path: '/coach/dashboard',    color: '#7c3aed' },
  { role: 'admin1',      label: 'Admin 1',     path: '/admin1/overview',    color: '#059669' },
  { role: 'admin2',      label: 'Admin 2',     path: '/admin2/centre',      color: '#d97706' },
  { role: 'super_admin', label: 'Super Admin', path: '/super-admin/settings', color: '#dc2626' },
]

function DevBypass() {
  const { t } = useLanguage()
  const { setProfile, setPermissions, setLoading, setInitialized } = useAuthStore()
  const navigate = useNavigate()

  function loginAs(role: Role, path: string) {
    const fakeProfile: Profile = {
      id:         `dev-${role}`,
      email:      `${role}@dev.local`,
      name:       `Dev ${role.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}`,
      role,
      status:     'approved',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setProfile(fakeProfile)
    setPermissions(getDefaultPermissions(role))
    setLoading(false)
    setInitialized(true)
    navigate(path, { replace: true })
  }

  return (
    <div className="mt-5 pt-4 border-t border-dashed border-line">
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-faint mb-2.5 text-center">
        ⚡ {t('login.devMode')}
      </p>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {DEV_ROLES.map(({ role, label, path, color }) => (
          <button
            key={role}
            onClick={() => loginAs(role, path)}
            className="py-1.5 px-2 rounded-[var(--r-sm)] text-[11px] font-semibold text-white transition-all hover:opacity-90 active:scale-95"
            style={{ background: color }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN LOGIN ──────────────────────────────────────────────────────────────

export default function Login() {
  const navigate = useNavigate()
  const { t } = useLanguage()

  // Branding (Super Admin → Branding) — falls back to the built-in identity
  // when unset or unreadable (e.g. anonymous visitors without RLS access).
  const brandName       = useBrandingValue<string>('brand_name', 'Archery Scene Monitor')
  const loginSubheading = useBrandingValue<string>(
    'brand_login_subheading',
    'Archer development tracking for school archery programmes, coach supervision, and national reporting.',
  )
  const tagline     = useBrandingValue<string>('brand_tagline', "Bring archers' next step further")
  const showTagline = useBrandingValue<boolean>('brand_show_tagline', true)

  const [mode, setMode] = useState<Mode>('signin')
  const [status, setStatus] = useState<RegStatus>('idle')
  const [error, setError] = useState('')

  // Set once sign-up succeeds and email confirmation is pending → show the
  // "check your email" screen for this address.
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  const [fields, setFields] = useState({
    email: '',
    password: '',
    name: '',
    role: '' as Role | '',
    schoolCode: '',
  })

  const [schoolName, setSchoolName] = useState<string | null>(null)
  // Solved CAPTCHA token (null until solved). Only relevant when the
  // VITE_TURNSTILE_SITE_KEY env is configured — see CaptchaWidget.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const [checkingCode, setCheckingCode] = useState(false)

  const loading = status === 'submitting'

  const set = (key: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }))

  // Resend cooldown countdown. Only decrements a counter — never auto-resends.
  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  // Resolve the school code to its name for confirmation (no school list is exposed).
  async function checkCode() {
    const code = fields.schoolCode.trim()
    if (!code) { setSchoolName(null); return }
    setCheckingCode(true)
    setSchoolName(await resolveSchoolCode(code))
    setCheckingCode(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    // When Supabase Auth CAPTCHA is enabled, every auth call needs a solved
    // token — block early with a clear message instead of a raw auth error.
    if (captchaEnabled() && !captchaToken) {
      setError(t('auth.captcha.required')); setStatus('error'); return
    }

    try {
      if (mode === 'signin') {
        const parsed = buildSignInSchema(t).safeParse(fields)
        if (!parsed.success) { setError(parsed.error.errors[0].message); setStatus('error'); return }
        setStatus('submitting')
        await signIn(fields.email, fields.password, captchaToken ?? undefined)
        // Auth state change listener in useAuthInit will navigate automatically
        return
      }

      // ── Register ──
      const parsed = buildRegisterSchema(t).safeParse(fields)
      if (!parsed.success) { setError(parsed.error.errors[0].message); setStatus('error'); return }

      const email = fields.email.trim().toLowerCase()
      let code = ''
      // Archers AND coaches register with their school's code — for archers it
      // routes them to the coach's approval queue; for coaches it tells the
      // approving admin which school the applicant claims, without the admin
      // having to verify with the school manually.
      if (fields.role === 'archer' || fields.role === 'coach') {
        code = fields.schoolCode.trim()
        if (!code) { setError(t('login.enterSchoolCode')); setStatus('error'); return }
        setStatus('submitting')
        // Confirm the code resolves to a real school before creating the account.
        const resolved = await resolveSchoolCode(code)
        if (!resolved) {
          setError(fields.role === 'archer'
            ? t('login.codeNotFoundCoach')
            : t('login.codeNotFoundSchool'))
          setStatus('idle')
          return
        }
      } else {
        setStatus('submitting')
      }

      const result = await signUp(email, fields.password, fields.role as Role, fields.name, code || undefined, captchaToken ?? undefined)

      // Stash the school code so it is claimed on the archer's first sign-in
      // (there is no session yet when email confirmation is pending).
      if (fields.role === 'archer' && code) storePendingSchoolCode(code)

      if (result.needsEmailConfirmation) {
        // Supabase already sent one confirmation email at sign-up → start cooldown.
        setRegisteredEmail(email)
        setStatus('signupSuccessAwaitingEmail')
        setCooldown(RESEND_COOLDOWN_SECONDS)
        return
      }

      // Email confirmation disabled (a session exists) — claim now, then enter.
      if (fields.role === 'archer' && code) {
        try {
          await claimSchoolCode(code)
          clearPendingSchoolCode()
        } catch (claimErr) {
          // Non-blocking: the account exists; a coach/admin can still link the
          // archer. Surfaced in dev; never silently swallowed.
          if (import.meta.env.DEV) console.error('[register] school-code claim failed:', claimErr)
        }
      }
      navigate('/pending', { replace: true })
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error('[register] sign-up failed:', err)
      if (isEmailRateLimitError(err)) {
        setError(t('login.rateLimited'))
      } else {
        setError(err instanceof Error ? err.message : t('login.somethingWrong'))
      }
      setStatus('error')
    }
  }

  const handleResend = async () => {
    // Double-click / spam guard: ignore while cooling down or already sending.
    if (!registeredEmail || cooldown > 0 || status === 'resending') return
    setError('')
    setStatus('resending')
    const outcome = await resendConfirmationEmail(registeredEmail)
    if (outcome.ok) {
      setStatus('resendSuccess')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } else if (outcome.rateLimited) {
      setStatus('rateLimited')
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } else {
      setError(t('login.resendFailed'))
      setStatus('error')
    }
  }

  const backToSignIn = () => {
    setRegisteredEmail(null)
    setMode('signin')
    setStatus('idle')
    setError('')
    setCooldown(0)
  }

  const switchMode = (m: Mode) => { setMode(m); setStatus('idle'); setError('') }

  return (
    <AuthLayout>
      <div
        className="w-full overflow-hidden rounded-[var(--r-xl)] shadow-card-lg bg-surface border border-line"
        style={{ maxWidth: 820 }}
      >
        <div className="grid md:grid-cols-[0.95fr_1.05fr]">
          {/* Hero panel */}
          <div
            className="flex flex-col justify-between p-8"
            style={{ background: 'linear-gradient(150deg, var(--primary), var(--primary-hover))', color: 'var(--on-primary)' }}
          >
            {/* Logo mark */}
            <div>
              <div
                className="w-11 h-11 rounded-[13px] flex items-center justify-center mb-5"
                style={{ background: 'rgba(28,18,8,.16)' }}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--on-primary)' }}>
                  <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/>
                </svg>
              </div>

              <h1 className="text-[28px] md:text-[32px] leading-tight mb-3" style={{ color: 'var(--on-primary)' }}>
                {brandName}
              </h1>
              <p className="text-sm leading-relaxed" style={{ color: 'rgba(28,18,8,.78)' }}>
                {loginSubheading}
              </p>
              {showTagline && tagline && (
                <p className="mt-3 text-xs font-semibold tracking-widest uppercase" style={{ color: 'rgba(28,18,8,.55)' }}>
                  {tagline}
                </p>
              )}
            </div>

            <div>
              <div className="h-px mb-4" style={{ background: 'rgba(28,18,8,.18)' }} />
              <p className="text-xs" style={{ color: 'rgba(28,18,8,.72)' }}>
                {t('login.pendingNote')}
              </p>
              <div className="mt-4 text-xs font-semibold" style={{ color: 'rgba(28,18,8,.55)' }}>
                {t('login.partnership')}
              </div>
            </div>
          </div>

          {/* Form panel */}
          <div className="p-8 flex flex-col">
            {registeredEmail ? (
              <ConfirmationPanel
                email={registeredEmail}
                status={status}
                cooldown={cooldown}
                error={error}
                onResend={handleResend}
                onBackToSignIn={backToSignIn}
              />
            ) : (
            <>
            <h2 className="text-lg mb-1">{mode === 'signin' ? t('login.signInTitle') : t('login.createTitle')}</h2>
            <p className="text-xs text-text-dim mb-5">
              {mode === 'signin'
                ? `${t('login.noAccount')} `
                : `${t('login.haveAccount')} `}
              <button
                type="button"
                onClick={() => switchMode(mode === 'signin' ? 'register' : 'signin')}
                className="text-primary font-semibold hover:underline"
              >
                {mode === 'signin' ? t('login.register') : t('login.signIn')}
              </button>
            </p>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 flex-1">
              {/* Error */}
              {error && (
                <div className="bg-danger-soft text-danger text-sm font-medium px-3 py-2.5 rounded-[var(--r-sm)]">
                  {error}
                </div>
              )}

              {mode === 'register' && (
                <Input
                  label={t('login.fullName')}
                  type="text"
                  placeholder={t('login.nricNamePlaceholder')}
                  hint={t('login.nricHint')}
                  autoComplete="name"
                  value={fields.name}
                  onChange={set('name')}
                  required
                />
              )}

              <Input
                label={t('login.emailAddress')}
                type="email"
                placeholder="name@email.com"
                autoComplete="email"
                value={fields.email}
                onChange={set('email')}
                required
              />

              <Input
                label={t('login.password')}
                type="password"
                placeholder={mode === 'register' ? t('login.passwordPlaceholderReg') : t('login.passwordPlaceholder')}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={fields.password}
                onChange={set('password')}
                required
              />

              {mode === 'signin' && (
                <div className="flex items-center justify-between text-xs -mt-1">
                  <Link to="/forgot-password" className="text-primary font-medium hover:underline">
                    {t('auth.login.forgotPassword')}
                  </Link>
                  <Link to="/forgot-email" className="text-text-dim hover:text-text transition-colors">
                    {t('auth.login.forgotEmail')}
                  </Link>
                </div>
              )}

              {mode === 'register' && (
                <Select
                  label={t('common.role')}
                  options={ROLE_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
                  placeholder={t('login.selectRole')}
                  value={fields.role}
                  onChange={set('role')}
                  required
                  hint={t('login.roleHint')}
                />
              )}

              {mode === 'register' && (fields.role === 'archer' || fields.role === 'coach') && (
                <Input
                  label={t('login.schoolCode')}
                  type="text"
                  placeholder={fields.role === 'archer' ? t('login.codeFromCoach') : t('login.yourSchoolCode')}
                  value={fields.schoolCode}
                  onChange={set('schoolCode')}
                  onBlur={checkCode}
                  required
                  error={!checkingCode && fields.schoolCode.trim() !== '' && !schoolName ? t('login.codeNotFound') : undefined}
                  hint={checkingCode ? t('login.checking')
                    : schoolName ? `✓ ${schoolName}`
                    : fields.role === 'archer'
                      ? t('login.codeHintArcher')
                      : t('login.codeHintCoach')}
                />
              )}

              <CaptchaWidget onToken={setCaptchaToken} />

              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading}
                className="w-full mt-auto"
              >
                {mode === 'signin' ? t('login.signIn') : t('login.createAccount')}
              </Button>
            </form>

            <p className="text-[11px] text-text-faint text-center mt-5">
              {t('login.termsNote')}
            </p>

            {import.meta.env.DEV && <DevBypass />}
            </>
            )}
          </div>
        </div>
      </div>
    </AuthLayout>
  )
}

// ─── CONFIRMATION PANEL ───────────────────────────────────────────────────────
// Shown after a successful sign-up while email confirmation is pending.

function ConfirmationPanel({
  email, status, cooldown, error, onResend, onBackToSignIn,
}: {
  email: string
  status: RegStatus
  cooldown: number
  error: string
  onResend: () => void
  onBackToSignIn: () => void
}) {
  const { t } = useLanguage()
  const resendDisabled = cooldown > 0 || status === 'resending'
  const resendLabel =
    status === 'resending' ? t('login.sending')
    : cooldown > 0 ? t('login.resendIn', { seconds: cooldown })
    : t('login.resendEmail')

  // Fallback guidance is shown once the user has tried resending.
  const showFallback = status === 'resendSuccess' || status === 'rateLimited'

  return (
    <div className="flex flex-col flex-1">
      {/* Icon */}
      <div
        className="w-12 h-12 rounded-[14px] flex items-center justify-center mb-4"
        style={{ background: 'var(--primary-soft)' }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
        </svg>
      </div>

      <h2 className="text-lg mb-1">{t('login.checkEmail')}</h2>
      <p className="text-sm text-text-dim mb-1">
        {t('login.accountCreated')}
      </p>
      <p className="text-sm font-semibold text-text mb-3 break-all">{email}</p>
      <p className="text-xs text-text-faint mb-5">
        {t('login.checkSpam')}
      </p>

      {/* Resend result messaging */}
      {status === 'resendSuccess' && (
        <div className="bg-success-soft text-success text-sm font-medium px-3 py-2.5 rounded-[var(--r-sm)] mb-4">
          {t('login.resendSuccess')}
        </div>
      )}
      {status === 'rateLimited' && (
        <div className="bg-warning-soft text-warning text-sm font-medium px-3 py-2.5 rounded-[var(--r-sm)] mb-4">
          {t('login.rateLimited')}
        </div>
      )}
      {status === 'error' && error && (
        <div className="bg-danger-soft text-danger text-sm font-medium px-3 py-2.5 rounded-[var(--r-sm)] mb-4">
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="primary"
        size="lg"
        onClick={onResend}
        disabled={resendDisabled}
        loading={status === 'resending'}
        className="w-full"
      >
        {resendLabel}
      </Button>

      {/* Fallback guidance after a resend attempt */}
      {showFallback && (
        <div className="mt-5 text-xs text-text-dim">
          <p className="font-semibold text-text mb-1.5">{t('login.stillNotSeeing')}</p>
          <ul className="list-disc pl-4 space-y-1">
            <li>{t('login.fallbackSpam')}</li>
            <li>{t('login.fallbackTyped')}</li>
            <li>{t('login.fallbackLater')}</li>
            <li>{t('login.fallbackContact')}</li>
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onBackToSignIn}
        className="text-primary font-semibold hover:underline text-sm mt-6 self-start"
      >
        ← {t('login.backToSignIn')}
      </button>
    </div>
  )
}

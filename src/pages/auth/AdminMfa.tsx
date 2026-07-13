import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { Button, Input } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { getHomePath } from '@/lib/permissions'
import { supabase } from '@/services/supabase'

interface Enrollment {
  factorId: string
  qrCode: string
  secret: string
}

const ADMIN_ROLES = new Set(['admin1', 'admin2', 'super_admin'])
const MFA_ISSUER = 'KPM Archery'
const MFA_FRIENDLY_NAME = 'KPM Admin Authenticator'

function buildTotpUri(secret: string, accountName: string) {
  const label = `${encodeURIComponent(MFA_ISSUER)}:${encodeURIComponent(accountName)}`
  const params = new URLSearchParams({
    secret,
    issuer: MFA_ISSUER,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

export default function AdminMfa() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [verified, setVerified] = useState(false)
  const [factorId, setFactorId] = useState<string | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const startedRef = useRef(false)
  useEffect(() => {
    // ponytail: StrictMode double-invokes this effect in dev; without a guard,
    // two concurrent enroll() calls race on the same second-precision friendly
    // name and one loses with a "already exists" error while the winner's QR
    // gets discarded by the unmount check below.
    if (startedRef.current) return
    startedRef.current = true
    async function prepare() {
      setLoading(true)
      setError('')
      try {
        const assurance = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (assurance.error) throw assurance.error
        if (assurance.data.currentLevel === 'aal2') {
          setVerified(true)
          return
        }

        const factors = await supabase.auth.mfa.listFactors()
        if (factors.error) throw factors.error

        // A half-finished enrollment cannot be verified because Supabase only
        // returns the secret/QR at creation time. Remove those first so the
        // admin can start setup again instead of getting stuck on a duplicate
        // friendly-name error.
        const staleIds = new Set(
          [...factors.data.all, ...factors.data.totp]
            .filter(f => f.factor_type === 'totp' && f.status === 'unverified')
            .map(f => f.id),
        )
        const cleanup = await Promise.all(
          [...staleIds].map(factorId => supabase.auth.mfa.unenroll({ factorId })),
        )
        const cleanupError = cleanup.find(result => result.error)?.error
        if (cleanupError) throw cleanupError

        const existing = factors.data.totp.find(f => f.status === 'verified')
        if (existing) {
          setFactorId(existing.id)
          return
        }

        // Never log or persist the returned secret/QR code.
        const enrolled = await supabase.auth.mfa.enroll({
          factorType: 'totp',
          friendlyName: `${MFA_FRIENDLY_NAME} ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
        })
        if (enrolled.error) throw enrolled.error
        setFactorId(enrolled.data.id)
        setEnrollment({
          factorId: enrolled.data.id,
          qrCode: `data:image/svg+xml;utf-8,${encodeURIComponent(enrolled.data.totp.qr_code)}`,
          secret: enrolled.data.totp.secret,
        })
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : t('adminMfa.loadError'))
      } finally {
        setLoading(false)
      }
    }
    void prepare()
  }, [t])

  if (!profile || !ADMIN_ROLES.has(profile.role)) return <Navigate to="/" replace />

  const destination = typeof (location.state as { from?: string } | null)?.from === 'string'
    ? (location.state as { from: string }).from
    : getHomePath(profile.role)
  const accountName = profile.email || profile.name || profile.id || 'admin'

  if (verified) return <Navigate to={destination} replace />

  async function verify() {
    if (!factorId || code.trim().length !== 6) return
    setSubmitting(true)
    setError('')
    try {
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: code.trim(),
      })
      if (result.error) throw result.error
      navigate(destination, { replace: true })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('adminMfa.verifyError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-[var(--r-lg)] border border-line bg-surface p-6 shadow-sm">
        <h1 className="font-display text-xl font-bold text-text">{t('adminMfa.title')}</h1>
        <p className="text-sm text-text-dim mt-2">{t('adminMfa.description')}</p>

        {loading ? (
          <p className="text-sm text-text-faint py-10 text-center">{t('common.loading')}</p>
        ) : (
          <div className="space-y-4 mt-5">
            {enrollment && (
              <div className="space-y-3 rounded-[var(--r)] bg-section p-4">
                <p className="text-sm font-semibold text-text">{t('adminMfa.enrolTitle')}</p>
                <div className="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center" aria-label={t('adminMfa.qrAlt')}>
                  <QRCodeSVG
                    value={buildTotpUri(enrollment.secret, accountName)}
                    size={176}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <img src={enrollment.qrCode} alt="" className="hidden" aria-hidden="true" />
                <p className="text-xs text-text-dim">{t('adminMfa.manualSecret')}</p>
                <code className="block break-all rounded bg-surface px-3 py-2 text-xs select-all">
                  {enrollment.secret}
                </code>
              </div>
            )}

            {!enrollment && factorId && (
              <p className="text-sm text-text-dim">{t('adminMfa.challengeHint')}</p>
            )}

            <Input
              label={t('adminMfa.codeLabel')}
              value={code}
              onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
            />
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <Button
              className="w-full"
              onClick={verify}
              loading={submitting}
              disabled={!factorId || code.length !== 6}
            >
              {t('adminMfa.verify')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

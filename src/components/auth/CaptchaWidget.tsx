import { useEffect, useRef } from 'react'
import { useLanguage } from '@/contexts/LanguageContext'

/**
 * Cloudflare Turnstile CAPTCHA widget (Supabase Auth's supported provider).
 *
 * Fully optional: it activates only when `VITE_TURNSTILE_SITE_KEY` is set in the
 * environment AND the matching secret is configured in Supabase Dashboard →
 * Auth → Attack protection → CAPTCHA. When the key is absent the widget renders
 * nothing and `captchaEnabled()` is false, so forms behave exactly as before —
 * zero impact until the project owner turns CAPTCHA on.
 *
 * The token produced here is passed to Supabase auth calls as
 * `options.captchaToken` (see services/auth.ts) and verified server-side by
 * Supabase — the client never decides pass/fail.
 */

const SITE_KEY: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** True when the app is configured to require CAPTCHA on auth forms. */
export function captchaEnabled(): boolean {
  return !!SITE_KEY
}

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => { scriptPromise = null; reject(new Error('captcha script failed to load')) }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

/**
 * Renders the Turnstile challenge and reports tokens upward.
 * `onToken(token)` fires on success; `onToken(null)` on expiry/error/reset so the
 * caller can require a fresh solve before submitting again.
 */
export function CaptchaWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const { language, t } = useLanguage()
  const hostRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!SITE_KEY) return
    let cancelled = false

    loadScript()
      .then(() => {
        if (cancelled || !hostRef.current || !window.turnstile) return
        widgetIdRef.current = window.turnstile.render(hostRef.current, {
          sitekey: SITE_KEY,
          language: language === 'ms' ? 'ms' : 'en',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        })
      })
      .catch(() => onTokenRef.current(null))

    return () => {
      cancelled = true
      if (widgetIdRef.current && window.turnstile) {
        try { window.turnstile.remove(widgetIdRef.current) } catch { /* already gone */ }
      }
      widgetIdRef.current = null
    }
  }, [language])

  if (!SITE_KEY) return null

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={hostRef} />
      <p className="text-[11px] text-text-faint">{t('auth.captcha.hint')}</p>
    </div>
  )
}

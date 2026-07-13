import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useOnboardingStore } from '@/store/onboardingStore'
import type { Role } from '@/types'
import { cn } from '@/utils/cn'

/**
 * First-login walkthrough (Task 5, post-launch readiness).
 *
 * Opens automatically the first time a user reaches the app shell (per-user
 * localStorage flag), walks through the screens that matter for their role,
 * and can be skipped at any point. Re-openable anytime from the account
 * menu → "App tour". All copy lives in `onboarding.*` (English + BM).
 *
 * Purely additive: renders nothing once completed/skipped, touches no
 * existing pages, no database impact.
 */

const STORAGE_PREFIX = 'asm-onboarding-v1:'

// Steps per role — icon + i18n sub-key under `onboarding.<group>.<key>`.
type Step = { icon: string; key: string }

const STEPS: Record<Role, { group: string; steps: Step[] }> = {
  archer: {
    group: 'archer',
    steps: [
      { icon: '👋', key: 'welcome' },
      { icon: '🏠', key: 'dashboard' },
      { icon: '🎯', key: 'scores' },
      { icon: '🏅', key: 'achievements' },
      { icon: '🏹', key: 'equipment' },
      { icon: '👤', key: 'profile' },
      { icon: '💬', key: 'help' },
    ],
  },
  coach: {
    group: 'coach',
    steps: [
      { icon: '👋', key: 'welcome' },
      { icon: '🏠', key: 'dashboard' },
      { icon: '✅', key: 'validation' },
      { icon: '🧑‍🤝‍🧑', key: 'students' },
      { icon: '📈', key: 'performance' },
      { icon: '👤', key: 'profile' },
      { icon: '💬', key: 'help' },
    ],
  },
  admin1: {
    group: 'admin1',
    steps: [
      { icon: '👋', key: 'welcome' },
      { icon: '🏠', key: 'dashboard' },
      { icon: '✅', key: 'approvals' },
      { icon: '📊', key: 'reports' },
      { icon: '💬', key: 'help' },
    ],
  },
  admin2: {
    group: 'admin2',
    steps: [
      { icon: '👋', key: 'welcome' },
      { icon: '🗂️', key: 'centre' },
      { icon: '🧑‍💼', key: 'users' },
      { icon: '🏫', key: 'orgImport' },
      { icon: '📊', key: 'reports' },
      { icon: '💬', key: 'help' },
    ],
  },
  super_admin: {
    group: 'superAdmin',
    steps: [
      { icon: '👋', key: 'welcome' },
      { icon: '⚙️', key: 'rules' },
      { icon: '🛡️', key: 'permissions' },
      { icon: '🎨', key: 'branding' },
      { icon: '💬', key: 'help' },
    ],
  },
}

export function OnboardingTour() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { open, openTour, closeTour } = useOnboardingStore()
  const [idx, setIdx] = useState(0)

  const storageKey = profile ? `${STORAGE_PREFIX}${profile.id}` : null

  // First login: auto-open once per user on this device.
  useEffect(() => {
    if (!storageKey) return
    if (!localStorage.getItem(storageKey)) openTour()
  }, [storageKey, openTour])

  // Restart from the first step every time the tour opens.
  useEffect(() => { if (open) setIdx(0) }, [open])

  const finish = (status: 'done' | 'skipped') => {
    if (storageKey) localStorage.setItem(storageKey, status)
    closeTour()
  }

  // Escape = skip (same as the Skip button).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish('skipped') }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storageKey])

  if (!open || !profile) return null

  const conf = STEPS[profile.role]
  if (!conf) return null
  const { group, steps } = conf
  const step = steps[idx]
  const last = idx === steps.length - 1

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px] print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={t('onboarding.title')}
    >
      <div className="w-[min(460px,100%)] bg-surface border border-line rounded-[var(--r-lg)] shadow-card-lg p-6 animate-menu-in">
        {/* Progress */}
        <div className="flex items-center justify-between mb-5">
          <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-text-faint">
            {t('onboarding.stepOf', { n: idx + 1, total: steps.length })}
          </span>
          <button
            type="button"
            onClick={() => finish('skipped')}
            className="text-[12px] font-semibold text-text-faint hover:text-text transition-colors"
          >
            {t('onboarding.skip')}
          </button>
        </div>

        {/* Step content */}
        <div className="text-center">
          <div className="text-4xl mb-3" aria-hidden>{step.icon}</div>
          <h2 className="font-display font-bold text-lg text-text">
            {t(`onboarding.${group}.${step.key}.title`)}
          </h2>
          <p className="text-sm text-text-dim leading-relaxed mt-2 min-h-[60px]">
            {t(`onboarding.${group}.${step.key}.body`)}
          </p>
        </div>

        {/* Dots */}
        <div className="flex items-center justify-center gap-1.5 my-5">
          {steps.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setIdx(i)}
              aria-label={t('onboarding.stepOf', { n: i + 1, total: steps.length })}
              className={cn(
                'h-1.5 rounded-full transition-all duration-200',
                i === idx ? 'w-5 bg-primary' : 'w-1.5 bg-line hover:bg-text-faint',
              )}
            />
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
            ← {t('onboarding.back')}
          </Button>
          {last ? (
            <Button variant="primary" size="sm" onClick={() => finish('done')}>
              {t('onboarding.done')} ✓
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => setIdx(idx + 1)}>
              {t('onboarding.next')} →
            </Button>
          )}
        </div>

        <p className="text-[11px] text-text-faint text-center mt-4">{t('onboarding.reopenHint')}</p>
      </div>
    </div>,
    document.body,
  )
}

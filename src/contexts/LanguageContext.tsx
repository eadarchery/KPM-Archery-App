import { createContext, useContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  type Language,
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  isLanguage,
  translate,
} from '@/i18n'
import { supabase } from '@/services/supabase'
import { useAuthStore } from '@/store/authStore'

interface LanguageContextValue {
  language: Language
  setLanguage: (lang: Language) => void
  toggleLanguage: () => void
  /** Translate a dot-path key with the ms → en → key fallback chain. */
  t: (key: string, vars?: Record<string, string | number>) => string
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined)

/** Read the persisted language once, defaulting to Bahasa Malaysia. */
function readInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (isLanguage(stored)) return stored
  } catch {
    /* localStorage unavailable (private mode / SSR) — fall through to default */
  }
  return DEFAULT_LANGUAGE
}

/** Save the choice on the user's profile so it follows their account across
 *  devices (migration 058). Fire-and-forget: a pre-058 database or a dev-bypass
 *  session simply keeps the localStorage-only behaviour. */
function persistLanguageToProfile(lang: Language) {
  const profile = useAuthStore.getState().profile
  if (!profile || profile.id.startsWith('dev-')) return
  void supabase
    .from('profiles')
    .update({ preferred_language: lang })
    .eq('id', profile.id)
    .then(({ error }) => {
      if (error && import.meta.env.DEV) console.warn('[i18n] profile language save failed:', error.message)
    })
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readInitialLanguage)
  const profile = useAuthStore((s) => s.profile)

  // Reflect the active language on <html lang>. We intentionally do NOT persist
  // here — only an explicit user choice is saved (see setLanguage below), so
  // DEFAULT_LANGUAGE always governs visitors who have never picked a language.
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  // Account-level preference (migration 058): when a profile loads with a saved
  // language, adopt it on this device. If the account has no preference yet but
  // this device holds an explicit past choice, push that up to the account so
  // the preference starts following the user.
  useEffect(() => {
    if (!profile) return
    const pref = profile.preferred_language
    if (isLanguage(pref)) {
      if (pref !== language) {
        try { localStorage.setItem(LANGUAGE_STORAGE_KEY, pref) } catch { /* ignore */ }
        setLanguageState(pref)
      }
    } else {
      try {
        const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY)
        if (isLanguage(stored)) persistLanguageToProfile(stored)
      } catch { /* ignore */ }
    }
    // Only re-run when a (different) profile finishes loading — not on every
    // language flip, which would fight the user mid-toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const setLanguage = useCallback((lang: Language) => {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, lang)
    } catch {
      /* ignore persistence failures */
    }
    persistLanguageToProfile(lang)
    setLanguageState(lang)
  }, [])
  const toggleLanguage = useCallback(
    () => setLanguage(language === 'ms' ? 'en' : 'ms'),
    [language, setLanguage],
  )

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t: (key, vars) => translate(language, key, vars),
    }),
    [language, setLanguage, toggleLanguage],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

/** Access the current language and translation helper. */
export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}

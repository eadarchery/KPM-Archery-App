/**
 * Lightweight, dependency-free i18n core for fixed UI text.
 *
 * Design goals:
 *   • No heavy library (no i18next) — just nested dictionaries + a resolver.
 *   • Default language is Bahasa Malaysia (ms); English (en) is secondary.
 *   • Safe missing-key behaviour: ms → en → the key string. Never throws.
 *
 * Usage is via the LanguageContext hook:  const { t } = useLanguage()
 *   t('common.save')                       → 'Simpan' / 'Save'
 *   t('rolePermissions.resetToDefault', { role: 'Admin 2' })
 */
import { ms } from './ms'
import { en } from './en'

export type Language = 'ms' | 'en'

// English first so it leads the switcher (it is now the default language).
export const SUPPORTED_LANGUAGES: Language[] = ['en', 'ms']
export const DEFAULT_LANGUAGE: Language = 'en'
// Bumped from 'kpm.language' so the previously auto-persisted default ('ms') is
// dropped and the new English default actually applies to existing users. Only an
// explicit user choice is persisted now (see LanguageContext).
export const LANGUAGE_STORAGE_KEY = 'kpm.language.v2'

/** Recursive shape of a translation dictionary. */
export type TranslationDict = { [key: string]: string | TranslationDict }

const DICTIONARIES: Record<Language, TranslationDict> = { ms, en }

/** Walk a dot-path (e.g. "common.save") and return the string, or undefined. */
function resolve(dict: TranslationDict, key: string): string | undefined {
  let cur: string | TranslationDict | undefined = dict
  for (const part of key.split('.')) {
    if (cur == null || typeof cur === 'string') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

/** Replace {placeholders} with provided values; unknown placeholders are kept. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name) =>
    vars[name] != null ? String(vars[name]) : `{${name}}`,
  )
}

/**
 * Resolve a key for a language with the ms → en → key fallback chain.
 * Pure function — the React layer (LanguageContext) binds `language` for `t`.
 */
export function translate(
  language: Language,
  key: string,
  vars?: Record<string, string | number>,
): string {
  let found = resolve(DICTIONARIES[language], key)
  if (found == null && language !== 'en') found = resolve(DICTIONARIES.en, key) // English backstop
  if (found == null) return key // last resort: show the key, never crash
  return interpolate(found, vars)
}

export function isLanguage(value: unknown): value is Language {
  return value === 'ms' || value === 'en'
}

/** Short display labels for the switcher (order comes from SUPPORTED_LANGUAGES). */
export const LANGUAGE_LABELS: Record<Language, string> = { ms: 'BM', en: 'EN' }
export const LANGUAGE_NAMES: Record<Language, string> = { ms: 'Bahasa Malaysia', en: 'English' }

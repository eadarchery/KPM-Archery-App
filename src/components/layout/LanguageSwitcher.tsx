import { useLanguage } from '@/contexts/LanguageContext'
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_NAMES } from '@/i18n'
import { cn } from '@/utils/cn'

/**
 * Compact EN / BM language toggle. Order follows SUPPORTED_LANGUAGES — English
 * leads because it is now the default language. Styled to match the header's
 * segmented controls so it stays small on both desktop and mobile (it never
 * overflows the header or the BottomTabBar — it lives in the header's right-hand tools).
 */
export function LanguageSwitcher({ className }: { className?: string }) {
  const { language, setLanguage } = useLanguage()

  return (
    <div
      className={cn('flex items-center bg-section rounded-[10px] p-0.5 gap-0.5', className)}
      role="group"
      aria-label="Language"
    >
      {SUPPORTED_LANGUAGES.map((lang) => {
        const active = language === lang
        return (
          <button
            key={lang}
            type="button"
            onClick={() => setLanguage(lang)}
            aria-pressed={active}
            title={LANGUAGE_NAMES[lang]}
            className={cn(
              'px-2 h-7 rounded-[8px] text-[11px] font-display font-semibold transition-all duration-150',
              active ? 'bg-surface text-text shadow-sm' : 'text-text-faint hover:text-text',
            )}
          >
            {LANGUAGE_LABELS[lang]}
          </button>
        )
      })}
    </div>
  )
}

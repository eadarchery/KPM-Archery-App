import { type ReactNode } from 'react'
import { useTheme } from '@/hooks/useTheme'
import { useLanguage } from '@/contexts/LanguageContext'

interface AuthLayoutProps {
  children: ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  const { theme, toggleTheme } = useTheme()
  const { t } = useLanguage()

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* Minimal header with theme toggle */}
      <div className="flex justify-end p-4">
        <button
          onClick={toggleTheme}
          aria-label={t('menu.toggleDarkMode')}
          className="w-10 h-10 rounded-[11px] border border-line bg-surface text-text-dim inline-flex items-center justify-center hover:text-text hover:border-line-strong transition-all"
        >
          {theme === 'dark' ? (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>
            </svg>
          ) : (
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8z"/>
            </svg>
          )}
        </button>
      </div>

      {/* Centered content */}
      <div className="flex items-center justify-center min-h-[calc(100vh-80px)] px-4 pb-6">
        {children}
      </div>
    </div>
  )
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Theme, FontSize, BadgeCount } from '@/types'

interface UiState {
  theme: Theme
  fontSize: FontSize
  badges: BadgeCount
  sidebarOpen: boolean

  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setFontSize: (size: FontSize) => void
  setBadges: (badges: Partial<BadgeCount>) => void
  setSidebarOpen: (open: boolean) => void
}

const defaultBadges: BadgeCount = {
  notifications: 0,
  achievements: 0,
  pendingValidations: 0,
  pendingApprovals: 0,
  failedSyncs: 0,
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      fontSize: 'normal',
      badges: defaultBadges,
      sidebarOpen: false,

      setTheme: (theme) => {
        set({ theme })
        document.documentElement.setAttribute('data-theme', theme)
        const meta = document.querySelector('meta[name="theme-color"]:not([media])')
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#141310' : '#f4f2ee')
      },

      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        get().setTheme(next)
      },

      setFontSize: (size) => {
        set({ fontSize: size })
        const root = document.documentElement
        root.setAttribute('data-font-size', size)
      },

      setBadges: (partial) => set((s) => ({ badges: { ...s.badges, ...partial } })),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'asm-ui-prefs',
      partialize: (s) => ({ theme: s.theme, fontSize: s.fontSize }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Apply persisted theme/fontSize to DOM immediately on load
          document.documentElement.setAttribute('data-theme', state.theme)
          document.documentElement.setAttribute('data-font-size', state.fontSize)
        }
      },
    },
  ),
)

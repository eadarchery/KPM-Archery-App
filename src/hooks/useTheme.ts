import { useUiStore } from '@/store/uiStore'
import type { Theme } from '@/types'

export function useTheme(): { theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void } {
  const theme = useUiStore((s) => s.theme)
  const toggleTheme = useUiStore((s) => s.toggleTheme)
  const setTheme = useUiStore((s) => s.setTheme)
  return { theme, toggleTheme, setTheme }
}

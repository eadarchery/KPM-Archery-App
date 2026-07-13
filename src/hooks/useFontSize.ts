import { useUiStore } from '@/store/uiStore'
import type { FontSize } from '@/types'

export function useFontSize(): { fontSize: FontSize; setFontSize: (size: FontSize) => void } {
  const fontSize = useUiStore((s) => s.fontSize)
  const setFontSize = useUiStore((s) => s.setFontSize)
  return { fontSize, setFontSize }
}

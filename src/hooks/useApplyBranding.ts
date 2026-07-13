import { useEffect } from 'react'
import { usePublicBranding } from './useBranding'

/**
 * Applies saved branding (Super Admin → Branding) to the live document:
 *   • document.title            ← brand_name
 *   • favicon                   ← brand_favicon (or brand_icon)
 *   • --primary/-hover/-soft    ← brand_primary_color
 *   • --success/--warning/--danger (+ -soft) ← their brand colors
 * Values are set as inline styles on <html>, so they win over both the light
 * and dark stylesheet variables — one brand color across themes.
 * Missing/invalid values leave the stylesheet defaults untouched.
 */

const HEX_RE = /^#[0-9a-f]{6}$/i

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function darken(hex: string, factor = 0.85): string {
  const c = (i: number) => Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)
  return `rgb(${c(1)}, ${c(3)}, ${c(5)})`
}

const COLOR_VARS: { key: string; cssVar: string; softAlpha: number }[] = [
  { key: 'brand_primary_color', cssVar: 'primary', softAlpha: 0.13 },
  { key: 'brand_success_color', cssVar: 'success', softAlpha: 0.13 },
  { key: 'brand_warning_color', cssVar: 'warning', softAlpha: 0.13 },
  { key: 'brand_danger_color',  cssVar: 'danger',  softAlpha: 0.12 },
]

export function useApplyBranding() {
  const { data } = usePublicBranding()

  useEffect(() => {
    if (!data?.length) return
    const get = (key: string): string => {
      const v = data.find((s) => s.key === key)?.value
      return typeof v === 'string' ? v.trim() : ''
    }

    // Browser tab title
    const name = get('brand_name')
    if (name) document.title = name

    // Favicon
    const fav = get('brand_favicon') || get('brand_icon')
    if (fav) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = fav
    }

    // Theme colors
    const root = document.documentElement
    for (const { key, cssVar, softAlpha } of COLOR_VARS) {
      const hex = get(key)
      if (!HEX_RE.test(hex)) continue
      root.style.setProperty(`--${cssVar}`, hex)
      root.style.setProperty(`--${cssVar}-soft`, hexToRgba(hex, softAlpha))
      if (cssVar === 'primary') {
        root.style.setProperty('--primary-hover', darken(hex))
      }
    }
  }, [data])
}

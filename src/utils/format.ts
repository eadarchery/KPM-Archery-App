// ─── STRINGS ─────────────────────────────────────────────────────────────────

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'
}

export function esc(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] ?? m),
  )
}

// ─── IDS ─────────────────────────────────────────────────────────────────────
// (Archer IDs are generated server-side by public.handle_new_user — migration 036.)

export function uid(prefix = 'id'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}${Date.now().toString(36).slice(-3).toUpperCase()}`
}

// ─── SCORE ───────────────────────────────────────────────────────────────────

export function scoreDisplay(score: number, maxScore: number): string {
  return `${score}/${maxScore}`
}

export function scorePct(score: number, maxScore: number): number {
  if (!maxScore) return 0
  return Math.round((score / maxScore) * 100)
}

export function trendLabel(pct: number): { label: string; direction: 'up' | 'down' | 'steady' } {
  if (pct >= 3) return { label: `▲ +${pct}%`, direction: 'up' }
  if (pct <= -3) return { label: `▼ ${pct}%`, direction: 'down' }
  return { label: `▬ ${pct >= 0 ? '+' : ''}${pct}%`, direction: 'steady' }
}

// ─── NUMBERS ─────────────────────────────────────────────────────────────────

export function compact(n: number): string {
  return new Intl.NumberFormat('en-MY', { notation: 'compact' }).format(n)
}

// ─── BOW CATEGORIES ──────────────────────────────────────────────────────────

export const BOW_CATEGORIES = [
  'Recurve',
  'Compound',
  'Barebow',
  'Traditional',
  'Longbow',
]

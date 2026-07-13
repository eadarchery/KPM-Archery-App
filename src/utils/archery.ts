import type { ArrowValue, ScoreSubmission } from '@/types'

// ─── ARROW VALUE PARSING ─────────────────────────────────────────────────────

export function parseArrowValue(raw: string): ArrowValue | null {
  const s = raw.trim().toUpperCase()
  if (s === 'M') return 'M'
  if (s === 'X') return 'X'
  const n = Number(s)
  if (Number.isInteger(n) && n >= 1 && n <= 10) return n as ArrowValue
  return null
}

export function arrowToNumber(v: ArrowValue): number {
  if (v === 'M') return 0
  if (v === 'X') return 10
  return v
}

export function validateArrowInput(raw: string): { value: ArrowValue; numeric: number } | null {
  const parsed = parseArrowValue(raw)
  if (parsed === null) return null
  return { value: parsed, numeric: arrowToNumber(parsed) }
}

// ─── SCORE CALCULATIONS ──────────────────────────────────────────────────────

export function calcTotalFromArrows(arrows: ArrowValue[]): number {
  return arrows.reduce((sum, v) => sum + arrowToNumber(v), 0)
}

export function scorePct(score: number, maxScore: number): number {
  if (!maxScore) return 0
  return Math.round((score / maxScore) * 100)
}

// ─── IMPROVEMENT TREND ───────────────────────────────────────────────────────
// Uses rolling average: compare the last 3 sessions vs the first 3 sessions
// within the chosen time window. Returns percentage point difference.

export function calcImprovementTrend(
  submissions: ScoreSubmission[],
  days?: number,
): number {
  const sorted = [...submissions].sort((a, b) => a.date.localeCompare(b.date))

  let window = sorted
  if (days) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)
    cutoff.setHours(0, 0, 0, 0)
    window = sorted.filter((s) => new Date(s.date + 'T12:00:00') >= cutoff)
  }

  if (window.length < 2) return 0

  const sample = Math.min(3, Math.floor(window.length / 2))
  const first = window.slice(0, sample).map((s) => scorePct(s.total_score, s.max_score))
  const last = window.slice(-sample).map((s) => scorePct(s.total_score, s.max_score))

  const avg = (arr: number[]) => arr.reduce((x, y) => x + y, 0) / arr.length
  return Math.round(avg(last) - avg(first))
}

// ─── GROUP SPREAD (from plotted arrow positions) ─────────────────────────────
// plot_data = { face: slug, arrows: [{ s, x, y }] } with x/y in cm from the
// face centre. Spread = mean distance of arrows from the GROUP centre (not the
// face centre), so it measures consistency independent of aim bias.

export interface PlotData {
  face?: string
  arrows?: { s: string | number; x: number; y: number }[]
}

export function computeGroupSpreadCm(plot: PlotData | null | undefined): number | null {
  const arrows = plot?.arrows
  if (!arrows || arrows.length < 2) return null
  const cx = arrows.reduce((s, a) => s + a.x, 0) / arrows.length
  const cy = arrows.reduce((s, a) => s + a.y, 0) / arrows.length
  const mean = arrows.reduce((s, a) => s + Math.hypot(a.x - cx, a.y - cy), 0) / arrows.length
  return Math.round(mean * 10) / 10
}

// ─── EXCEL VALIDATION ────────────────────────────────────────────────────────

export function validateExcelArrowCell(cell: unknown): ArrowValue | null {
  if (cell === null || cell === undefined || cell === '') return null
  return parseArrowValue(String(cell))
}

// ─── ROUND HELPERS ───────────────────────────────────────────────────────────

export function eligibleRounds(age: number, rounds: { min_age: number; max_age: number; active: boolean; id: string }[]) {
  return rounds.filter((r) => r.active && age >= r.min_age && age <= r.max_age)
}

// ─── PRACTICE ACHIEVEMENT MILESTONES ─────────────────────────────────────────

export const PRACTICE_MILESTONES = [100, 1_000, 5_000, 10_000, 50_000, 100_000]

export const SCORE_MILESTONES = [200, 250, 290, 300, 310, 320, 330, 350]

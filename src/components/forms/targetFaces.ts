/**
 * Target face library — every face is pure data; the plotter renders whatever
 * config it is given. Ring sizes are entered in REAL cm so plotted arrows can
 * be converted to physical offsets (cm from centre) for the future
 * spread-monitor analytics, regardless of which face was shot.
 *
 * Corrections applied to the supplied spec (obvious typos):
 *   • WA 122cm X ring: 6.1cm (half the 10-ring, WA standard) not 6.2.
 *   • WA 40cm: overall Ø 40cm; score-2 ring Ø 36cm (was "54").
 * Multi-spot faces (3×20 vertical / Vegas triangle) render all three spots via
 * spotGeometry(); an arrow scores against whichever spot it lands nearest to,
 * and plotted positions are stored in cm relative to that spot's centre so
 * spread analytics treat every spot as one target. Anything outside the lowest
 * ring scores M.
 */

export type PlotArrowVal = 'M' | 'X' | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface FaceRing {
  /** Outer radius in SVG units (500×500 viewBox, centre 250, outer ring 240). */
  r: number
  score: PlotArrowVal
  fill: string
  stroke: string
}

export interface FaceConfig {
  slug: string
  name: string
  /** Physical diameter (cm) of the outermost scoring ring. */
  diameterCm: number
  /** Rings outer→inner. An 'X' entry (if any) must be last. */
  rings: FaceRing[]
  /** Spot layout — informational until multi-spot rendering lands. */
  layout?: 'single' | 'vertical-3' | 'triangle-3'
}

export type Band = 'white' | 'black' | 'blue' | 'red' | 'yellow'

/** Ring fill/stroke for the plotter SVG, plus a readable text color for use
 *  wherever a score value is shown against its band as a solid chip/button
 *  (matches the real WA target face printed-outline convention: only the
 *  white band gets an outline, via `stroke`). Single source of truth for
 *  "what color is this score" across the plotter AND the score-entry UI. */
export const BAND_STYLE: Record<Band, { fill: string; stroke: string; text: string }> = {
  white:  { fill: '#f8f8f4', stroke: '#333333', text: '#1b1b1b' },
  black:  { fill: '#2b2b2b', stroke: '#f8f8f4', text: '#f8f8f4' },
  blue:   { fill: '#2563eb', stroke: '#1b1b1b', text: '#ffffff' },
  red:    { fill: '#dc2626', stroke: '#1b1b1b', text: '#ffffff' },
  yellow: { fill: '#facc15', stroke: '#1b1b1b', text: '#1b1b1b' },
}

/**
 * WA 10-zone scoring → 5-color band. Every face in this file uses the same
 * mapping (1-2 white, 3-4 black, 5-6 blue, 7-8 red, 9-10-X yellow) regardless
 * of face size, so this is independent of any specific FaceConfig. 'M' (a
 * total miss) has no ring/band — callers handle it as a separate UI case.
 */
export function scoreBand(v: Exclude<PlotArrowVal, 'M'>): Band {
  if (v === 'X' || v === 10 || v === 9) return 'yellow'
  if (v === 8 || v === 7) return 'red'
  if (v === 6 || v === 5) return 'blue'
  if (v === 4 || v === 3) return 'black'
  return 'white' // 1, 2
}

const OUTER_R = 240

/** Build a FaceConfig from real-cm ring specs (outer → inner). */
function makeFace(
  slug: string,
  name: string,
  rings: [score: PlotArrowVal, outerDiameterCm: number, band: Band][],
  layout: FaceConfig['layout'] = 'single',
): FaceConfig {
  const diameterCm = rings[0][1]
  return {
    slug,
    name,
    diameterCm,
    layout,
    rings: rings.map(([score, dCm, band]) => ({
      r: Math.round((dCm / diameterCm) * OUTER_R * 100) / 100,
      score,
      // X ring renders as an outline over the innermost colour band.
      fill: score === 'X' ? 'none' : BAND_STYLE[band].fill,
      stroke: BAND_STYLE[band].stroke,
    })),
  }
}

export const TARGET_FACES: FaceConfig[] = [
  makeFace('wa-122', 'WA 122cm', [
    [1, 122, 'white'], [2, 109.8, 'white'],
    [3, 97.6, 'black'], [4, 85.4, 'black'],
    [5, 73.2, 'blue'],  [6, 61, 'blue'],
    [7, 48.8, 'red'],   [8, 36.6, 'red'],
    [9, 24.4, 'yellow'], [10, 12.2, 'yellow'],
    ['X', 6.1, 'yellow'],
  ]),
  makeFace('wa-80', 'WA 80cm', [
    [1, 80, 'white'], [2, 72, 'white'],
    [3, 64, 'black'], [4, 56, 'black'],
    [5, 48, 'blue'],  [6, 40, 'blue'],
    [7, 32, 'red'],   [8, 24, 'red'],
    [9, 16, 'yellow'], [10, 8, 'yellow'],
    ['X', 4, 'yellow'],
  ]),
  makeFace('wa-60', 'WA 60cm', [
    [1, 60, 'white'], [2, 54, 'white'],
    [3, 48, 'black'], [4, 42, 'black'],
    [5, 36, 'blue'],  [6, 30, 'blue'],
    [7, 24, 'red'],   [8, 18, 'red'],
    [9, 12, 'yellow'], [10, 6, 'yellow'],
    ['X', 3, 'yellow'],
  ]),
  makeFace('wa-40', 'WA 40cm', [
    [1, 40, 'white'], [2, 36, 'white'],
    [3, 32, 'black'], [4, 28, 'black'],
    [5, 24, 'blue'],  [6, 20, 'blue'],
    [7, 16, 'red'],   [8, 12, 'red'],
    [9, 8, 'yellow'], [10, 4, 'yellow'],
    ['X', 2, 'yellow'],
  ]),
  makeFace('wa-80-6ring', 'WA 80cm 6-ring', [
    [5, 48, 'blue'], [6, 40, 'blue'],
    [7, 32, 'red'],  [8, 24, 'red'],
    [9, 16, 'yellow'], [10, 8, 'yellow'],
    ['X', 4, 'yellow'],
  ]),
  makeFace('wa-3x20-vertical', 'WA 3×20cm Vertical', [
    [6, 20, 'blue'],
    [7, 16, 'red'], [8, 12, 'red'],
    [9, 8, 'yellow'], [10, 4, 'yellow'],
    ['X', 2, 'yellow'],
  ], 'vertical-3'),
  makeFace('wa-3x20-compound', 'WA 3×20cm Compound', [
    [6, 20, 'blue'],
    [7, 16, 'red'], [8, 12, 'red'],
    [9, 8, 'yellow'], [10, 2, 'yellow'],   // compound: inner-10 only, no X
  ], 'vertical-3'),
  makeFace('wa-3x20-recurve', 'WA 3×20cm Recurve', [
    [6, 20, 'blue'],
    [7, 16, 'red'], [8, 12, 'red'],
    [9, 8, 'yellow'], [10, 4, 'yellow'],   // recurve 3-spot: no X ring
  ], 'vertical-3'),
  makeFace('wa-3x20-vegas', 'WA 3×20cm Vegas', [
    [6, 20, 'blue'],
    [7, 16, 'red'], [8, 12, 'red'],
    [9, 8, 'yellow'], [10, 4, 'yellow'],
    ['X', 2, 'yellow'],
  ], 'triangle-3'),
]

export const DEFAULT_FACE_SLUG = 'wa-122'

export function getFace(slug?: string | null): FaceConfig {
  return TARGET_FACES.find((f) => f.slug === slug) ?? TARGET_FACES[0]
}

export const FACE_OPTIONS = TARGET_FACES.map((f) => ({ value: f.slug, label: f.name }))

/** Real-world cm per SVG unit at full spot size (scale 1) — converts plotted
 *  positions (stored relative to a spot's centre) to physical cm. */
export function cmPerUnit(face: FaceConfig): number {
  return face.diameterCm / 2 / OUTER_R
}

// ── Multi-spot layout geometry ────────────────────────────────────────────────

export interface SpotGeometry {
  /** Spot centres in the 500×500 viewBox. */
  centers: { x: number; y: number }[]
  /** Ring radii are multiplied by this so all spots fit the viewBox. */
  scale: number
}

/** Where each spot sits on the plotter canvas for this face's layout. */
export function spotGeometry(face: FaceConfig): SpotGeometry {
  switch (face.layout) {
    case 'vertical-3': // three 20cm spots stacked, as on the WA vertical card
      return {
        centers: [{ x: 250, y: 86 }, { x: 250, y: 250 }, { x: 250, y: 414 }],
        scale: 78 / OUTER_R,
      }
    case 'triangle-3': // Vegas: one up, two down
      return {
        centers: [{ x: 250, y: 130 }, { x: 134, y: 360 }, { x: 366, y: 360 }],
        scale: 105 / OUTER_R,
      }
    default:
      // Slightly under full size so a visible "off the face" band surrounds the
      // rings — tapping there records a miss (M). cm conversion divides by this
      // scale, so plotted physical positions are unaffected.
      return { centers: [{ x: 250, y: 250 }], scale: 205 / OUTER_R }
  }
}

/** The spot centre closest to a viewBox point. */
export function nearestSpotCenter(geo: SpotGeometry, x: number, y: number) {
  let best = geo.centers[0]
  let bestD = Infinity
  for (const c of geo.centers) {
    const d = Math.hypot(x - c.x, y - c.y)
    if (d < bestD) { bestD = d; best = c }
  }
  return best
}

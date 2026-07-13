import { useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { useLanguage } from '@/contexts/LanguageContext'
import { getFace, cmPerUnit, spotGeometry, nearestSpotCenter, type FaceConfig, type PlotArrowVal, type SpotGeometry } from './targetFaces'

/** One plotted arrow in real-world units: score + cm offset from face centre. */
export interface PlottedArrowCm { s: PlotArrowVal; x: number; y: number }

/**
 * Archery Arrow Plotter — drag on the target face to aim, release to plot.
 *
 * Touch UX: the plot marker sits OFFSET from your thumb (up-left), so your
 * finger never hides the point you are placing — drag to aim with the marker
 * tip, lift to commit. With a mouse the cursor is precise already, so click
 * places directly and the offset is skipped.
 *
 * Existing arrows can be re-aimed by dragging them (same offset rule).
 *
 * Faces come from ./targetFaces (pure data). Arrows are plotted end by end —
 * the header shows which end and which arrow within it you are on.
 */

export type { PlotArrowVal }

function scoreAt(face: FaceConfig, geo: SpotGeometry, x: number, y: number): PlotArrowVal {
  // Score against the nearest spot (single-spot faces have one centre).
  const c = nearestSpotCenter(geo, x, y)
  const d = Math.hypot(x - c.x, y - c.y)
  // Innermost ring containing the point wins (rings are outer→inner).
  for (let i = face.rings.length - 1; i >= 0; i--) {
    if (d <= face.rings[i].r * geo.scale) return face.rings[i].score
  }
  return 'M'
}

function arrowValue(v: PlotArrowVal): number {
  if (v === 'M') return 0
  if (v === 'X') return 10
  return v
}

// Marker offset from the thumb (SVG units), up-left so the finger never
// covers the plot point.
const THUMB_OFFSET = { dx: -46, dy: -46 }

// ─── COMPONENT ───────────────────────────────────────────────────────────────

interface PlottedArrow {
  id: number
  x: number
  y: number
  score: PlotArrowVal
}

interface Aiming {
  /** Arrow being re-aimed, or null when placing a new one. */
  arrowId: number | null
  /** Marker tip position (already offset for touch). */
  x: number
  y: number
  /** Raw thumb position — used to draw the thumb→tip link. */
  thumbX: number
  thumbY: number
  touch: boolean
}

interface ArrowPlotterProps {
  totalArrows: number
  onChange: (arrows: PlotArrowVal[], total: number) => void
  face?: FaceConfig
  /** End format — arrows are plotted in ends of this size (e.g. 6 or 3). */
  arrowsPerEnd?: number
  /** Positions in cm from centre — for spread analytics (plot_data). */
  onPlotData?: (arrows: PlottedArrowCm[]) => void
}

export function ArrowPlotter({ totalArrows, onChange, face = getFace(), arrowsPerEnd, onPlotData }: ArrowPlotterProps) {
  const { t } = useLanguage()
  const svgRef = useRef<SVGSVGElement>(null)
  const [arrows, setArrows] = useState<PlottedArrow[]>([])
  const [aiming, setAiming] = useState<Aiming | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  // Which end is shown on the face. null = follow the end currently being shot;
  // a number = the archer tapped a previous end to review/adjust it.
  const [viewEndOverride, setViewEndOverride] = useState<number | null>(null)

  const geo = spotGeometry(face)
  const total = arrows.reduce((s, a) => s + arrowValue(a.score), 0)
  const full = arrows.length >= totalArrows

  // ── End structure ── the face shows ONE end at a time.
  const ape = arrowsPerEnd && arrowsPerEnd > 0 ? arrowsPerEnd : totalArrows
  const endCount = Math.max(1, Math.ceil(totalArrows / ape))
  const activeEnd = Math.min(Math.floor(arrows.length / ape), endCount - 1)
  const displayedEnd = viewEndOverride ?? activeEnd
  const endStart = displayedEnd * ape
  const displayedArrows = arrows
    .map((a, i) => ({ ...a, globalIndex: i }))
    .filter((a) => a.globalIndex >= endStart && a.globalIndex < endStart + ape)
  const canPlaceHere = displayedEnd === activeEnd && !full

  const endSubtotal = (end: number) =>
    arrows.slice(end * ape, end * ape + ape).reduce((s, a) => s + arrowValue(a.score), 0)

  function emit(next: PlottedArrow[]) {
    setArrows(next)
    onChange(next.map((a) => a.score), next.reduce((s, a) => s + arrowValue(a.score), 0))
    if (onPlotData) {
      // cm per on-screen unit: spots are drawn scaled, positions are stored
      // relative to the nearest spot's centre at real size.
      const k = cmPerUnit(face) / geo.scale
      onPlotData(next.map((a) => {
        const c = nearestSpotCenter(geo, a.x, a.y)
        return {
          s: a.score,
          x: Math.round((a.x - c.x) * k * 10) / 10,
          y: Math.round((a.y - c.y) * k * 10) / 10,
        }
      }))
    }
  }

  function clamp(v: number) { return Math.max(0, Math.min(500, v)) }

  function svgPoint(e: React.PointerEvent): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    if (!m) return null
    const p = pt.matrixTransform(m.inverse())
    return { x: clamp(p.x), y: clamp(p.y) }
  }

  function tipFor(p: { x: number; y: number }, touch: boolean) {
    return touch
      ? { x: clamp(p.x + THUMB_OFFSET.dx), y: clamp(p.y + THUMB_OFFSET.dy) }
      : p
  }

  function startAim(e: React.PointerEvent, arrowId: number | null) {
    const p = svgPoint(e)
    if (!p) return
    // New arrows may only be added to the end currently being shot.
    if (arrowId === null && !canPlaceHere) return
    const touch = e.pointerType !== 'mouse'
    const tip = tipFor(p, touch)
    svgRef.current?.setPointerCapture(e.pointerId)
    setAiming({ arrowId, x: tip.x, y: tip.y, thumbX: p.x, thumbY: p.y, touch })
  }

  function handleDown(e: React.PointerEvent) {
    startAim(e, null)
  }

  function handleMove(e: React.PointerEvent) {
    const p = svgPoint(e)
    if (!p) return
    if (aiming) {
      const tip = tipFor(p, aiming.touch)
      setAiming({ ...aiming, x: tip.x, y: tip.y, thumbX: p.x, thumbY: p.y })
    } else if (e.pointerType === 'mouse') {
      setHover(p)
    }
  }

  function handleUp() {
    if (!aiming) return
    const score = scoreAt(face, geo, aiming.x, aiming.y)
    if (aiming.arrowId != null) {
      emit(arrows.map((a) => (a.id === aiming.arrowId ? { ...a, x: aiming.x, y: aiming.y, score } : a)))
    } else {
      emit([...arrows, { id: Date.now(), x: aiming.x, y: aiming.y, score }])
      setViewEndOverride(null) // follow the shooting end again
    }
    setAiming(null)
  }

  function undo() { emit(arrows.slice(0, -1)); setViewEndOverride(null) }
  function clearAll() { emit([]); setViewEndOverride(null) }

  const size = Math.round(320 * zoom)
  const liveScore = aiming ? scoreAt(face, geo, aiming.x, aiming.y) : hover ? scoreAt(face, geo, hover.x, hover.y) : null

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(z + 0.25, 2.5))}>{t('plotter.zoomIn')}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.75))}>{t('plotter.zoomOut')}</Button>
        <Button type="button" variant="ghost" size="sm" onClick={undo} disabled={!arrows.length}>{t('plotter.undo')}</Button>
        <Button type="button" variant="danger" size="sm" onClick={clearAll} disabled={!arrows.length}>{t('common.clear')}</Button>
        <span className="text-xs text-text-faint ml-auto">
          {face.name}
          {endCount > 1 && !full
            ? ` · ${t('plotter.endProgress', { end: activeEnd + 1, ends: endCount, arrow: (arrows.length % ape) + 1, arrows: ape })}`
            : ` · ${arrows.length}/${totalArrows}`}
          {liveScore != null ? ` · ${t('plotter.at')} ${liveScore}` : ''}
        </span>
      </div>

      {/* End selector — face shows one end at a time; tap to review an earlier end */}
      {endCount > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: endCount }, (_, e) => {
            const started = arrows.length > e * ape
            const isShooting = e === activeEnd && !full
            const isViewed = e === displayedEnd
            return (
              <button
                key={e}
                type="button"
                disabled={!started && !isShooting}
                onClick={() => setViewEndOverride(e === activeEnd ? null : e)}
                className={[
                  'px-2.5 py-1.5 rounded-[9px] text-xs font-semibold border transition-colors',
                  isViewed
                    ? 'bg-primary text-primary-on border-primary'
                    : started || isShooting
                      ? 'bg-surface border-line text-text-dim hover:border-line-strong'
                      : 'bg-surface border-line text-text-faint opacity-40 cursor-not-allowed',
                ].join(' ')}
              >
                {t('plotter.end')} {e + 1}{started ? ` · ${endSubtotal(e)}` : ''}
              </button>
            )
          })}
        </div>
      )}

      {displayedEnd !== activeEnd && (
        <p className="text-xs text-warning">
          {t('plotter.reviewingEnd', { viewed: displayedEnd + 1, active: activeEnd + 1 })}
        </p>
      )}

      {/* Target */}
      <div className="overflow-auto rounded-[var(--r-md)] border border-line bg-section p-2" style={{ touchAction: 'none', maxHeight: 440 }}>
        <svg
          ref={svgRef}
          width={size}
          height={size}
          viewBox="0 0 500 500"
          className="block mx-auto select-none"
          style={{ touchAction: 'none', cursor: !canPlaceHere && !aiming ? 'not-allowed' : 'crosshair' }}
          onPointerDown={handleDown}
          onPointerMove={handleMove}
          onPointerUp={handleUp}
          onPointerCancel={() => setAiming(null)}
          onPointerLeave={() => setHover(null)}
        >
          {/* Miss-zone boundary: everything outside this dashed edge scores M. */}
          {geo.centers.map((c, ci) => (
            <circle
              key={`miss-${ci}`}
              cx={c.x} cy={c.y}
              r={face.rings[0].r * geo.scale + 5}
              fill="none" stroke="#9ca3af" strokeWidth={1} strokeDasharray="5 5" opacity={0.7}
            />
          ))}
          <text x={10} y={22} fontSize={13} fontWeight={600} fill="#9ca3af">
            {t('plotter.outsideFace')}
          </text>

          {geo.centers.map((c, ci) =>
            face.rings.map((ring) => (
              <circle key={`${ci}-${ring.r}`} cx={c.x} cy={c.y} r={ring.r * geo.scale}
                fill={ring.fill} stroke={ring.stroke} strokeWidth={ring.score === 'X' ? 1.5 : 1} />
            )),
          )}

          {/* Arrows of the DISPLAYED end only — draggable to re-aim.
              Numbering restarts each end (1…arrows-per-end). */}
          {displayedArrows.map((a) => (
            <g key={a.id} opacity={aiming?.arrowId === a.id ? 0.3 : 1}>
              <circle
                cx={a.x} cy={a.y} r={7}
                fill={a.score === 'M' ? '#dc2626' : '#ffffff'} stroke="#1b1b1b" strokeWidth={2}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => { e.stopPropagation(); startAim(e, a.id) }}
              />
              <text x={a.x + 10} y={a.y - 10} fontSize={14} fontWeight={700}
                fill="#1b1b1b" stroke="#f8f8f4" strokeWidth={3} paintOrder="stroke" pointerEvents="none">
                {a.globalIndex - endStart + 1}
              </text>
            </g>
          ))}

          {/* Aiming marker: dot at the tip, dashed link back to the thumb */}
          {aiming && (
            <g pointerEvents="none">
              {aiming.touch && (
                <>
                  <line
                    x1={aiming.thumbX} y1={aiming.thumbY} x2={aiming.x} y2={aiming.y}
                    stroke="#3730a3" strokeWidth={3} strokeDasharray="7 5"
                  />
                  <circle cx={aiming.thumbX} cy={aiming.thumbY} r={26} fill="none" stroke="#22d3ee" strokeWidth={2.5} />
                </>
              )}
              <circle cx={aiming.x} cy={aiming.y} r={5} fill="#ff6a18" stroke="#1b1b1b" strokeWidth={1.5} />
              <line x1={aiming.x - 14} y1={aiming.y} x2={aiming.x + 14} y2={aiming.y} stroke="#ff6a18" strokeWidth={1.5} />
              <line x1={aiming.x} y1={aiming.y - 14} x2={aiming.x} y2={aiming.y + 14} stroke="#ff6a18" strokeWidth={1.5} />
              <text x={aiming.x + 12} y={aiming.y - 12} fontSize={16} fontWeight={800}
                fill="#ff6a18" stroke="#1b1b1b" strokeWidth={0.6}>
                {String(liveScore)}
              </text>
            </g>
          )}

          {/* Mouse hover crosshair */}
          {!aiming && hover && canPlaceHere && (
            <g pointerEvents="none">
              <line x1={hover.x - 14} y1={hover.y} x2={hover.x + 14} y2={hover.y} stroke="#ff6a18" strokeWidth={1.5} />
              <line x1={hover.x} y1={hover.y - 14} x2={hover.x} y2={hover.y + 14} stroke="#ff6a18" strokeWidth={1.5} />
            </g>
          )}
        </svg>
      </div>

      <p className="text-xs text-text-faint">
        {t('plotter.hint')} <strong className="text-text-dim">{t('plotter.missedQ')}</strong> {t('plotter.missedHint')}
        {geo.centers.length > 1 && ` ${t('plotter.threeSpotHint')}`}
      </p>

      {/* Scorecard — one row per end with its subtotal */}
      {arrows.length > 0 && (
        <div className="space-y-1">
          {Array.from({ length: endCount }, (_, e) => {
            const endArrows = arrows.slice(e * ape, e * ape + ape)
            if (!endArrows.length) return null
            return (
              <div
                key={e}
                className={[
                  'flex items-center gap-2 rounded-[8px] px-2 py-1',
                  e === displayedEnd ? 'bg-primary-soft' : '',
                ].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => setViewEndOverride(e === activeEnd ? null : e)}
                  className="text-xs font-semibold text-text-dim w-12 text-left shrink-0 hover:text-text"
                >
                  {t('plotter.end')} {e + 1}
                </button>
                <div className="flex flex-wrap gap-1 flex-1">
                  {endArrows.map((a) => (
                    <span key={a.id} className="px-1.5 py-0.5 rounded-[6px] text-xs font-mono font-bold border bg-surface border-line text-text-dim">
                      {a.score}
                    </span>
                  ))}
                </div>
                <span className="text-xs font-bold text-text shrink-0">= {endSubtotal(e)}</span>
              </div>
            )
          })}
          <div className="flex justify-end px-2">
            <span className="text-sm font-bold text-primary">{t('common.total')} = {total}</span>
          </div>
        </div>
      )}
    </div>
  )
}

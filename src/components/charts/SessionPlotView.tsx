import { getFace, cmPerUnit } from '@/components/forms/targetFaces'
import { useLanguage } from '@/contexts/LanguageContext'
import type { PlotData } from '@/utils/archery'
import { computeGroupSpreadCm } from '@/utils/archery'

/**
 * Read-only replay of a plotted session: every arrow of the session (all ends
 * together) drawn on the target face it was shot on, plus the group centre and
 * a dashed circle at the mean spread radius — so a wide (worse) group is
 * immediately visible.
 */
export function SessionPlotView({ plot, size = 320 }: { plot: PlotData; size?: number }) {
  const { t } = useLanguage()
  const face = getFace(plot.face)
  const arrows = plot.arrows ?? []
  const unitsPerCm = 1 / cmPerUnit(face) // SVG units per real cm
  const C = 250

  const pts = arrows.map((a) => ({
    x: C + a.x * unitsPerCm,
    y: C + a.y * unitsPerCm,
    s: a.s,
  }))

  const spread = computeGroupSpreadCm(plot)
  const cx = pts.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : C
  const cy = pts.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : C
  const spreadR = spread != null ? spread * unitsPerCm : null

  return (
    <div>
      <svg width={size} height={size} viewBox="0 0 500 500" className="block mx-auto select-none">
        {face.rings.map((ring) => (
          <circle key={ring.r} cx={C} cy={C} r={ring.r}
            fill={ring.fill} stroke={ring.stroke} strokeWidth={ring.score === 'X' ? 1.5 : 1} />
        ))}

        {/* Mean-spread disc around the group centre — bigger disc = worse.
            Fully tinted in the same green from the ✚ out to the dashed edge,
            so the average-spread area reads as one solid zone. */}
        {spreadR != null && spreadR > 1 && (
          <circle cx={cx} cy={cy} r={spreadR}
            fill="#16a34a" fillOpacity={0.5}
            stroke="#16a34a" strokeWidth={2} strokeDasharray="6 5" strokeOpacity={0.7} />
        )}

        {/* Group centre — low-opacity green ✚ */}
        {pts.length >= 2 && (
          <g stroke="#16a34a" strokeWidth={2.5} opacity={0.55}>
            <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} />
            <line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} />
          </g>
        )}

        {/* Arrows */}
        {pts.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={6} fill="#ffffff" stroke="#1b1b1b" strokeWidth={1.8} />
            <text x={p.x + 8} y={p.y - 8} fontSize={12} fontWeight={700}
              fill="#1b1b1b" stroke="#f8f8f4" strokeWidth={2.5} paintOrder="stroke">
              {String(p.s)}
            </text>
          </g>
        ))}
      </svg>

      <div className="flex items-center justify-between mt-2 px-1 text-xs">
        <span className="text-text-dim">
          {face.name} · {arrows.length} {t('scoreEntry.arrows')}
          {face.layout && face.layout !== 'single' ? ` · ${t('sessionDetail.spotsOverlaid')}` : ''}
        </span>
        {spread != null && (
          <span className="font-semibold text-text">
            {t('sessionDetail.groupSpread')}: <span className="text-primary">{spread} cm</span>
            <span className="text-text-faint font-normal"> — {t('sessionDetail.spreadBetter')}</span>
          </span>
        )}
      </div>

      {spread != null && (
        <p className="text-[11px] text-text-faint mt-2 px-1 leading-relaxed">
          <strong className="text-text-dim">{t('sessionDetail.spreadHowTitle')}</strong> {t('sessionDetail.spreadHowBody')}
        </p>
      )}
    </div>
  )
}

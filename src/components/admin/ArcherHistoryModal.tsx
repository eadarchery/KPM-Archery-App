import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SubmissionStatusBadge } from '@/components/ui/Badge'
import { ScoreTrendChart, DistanceSeriesChart, type DistancePoint } from '@/components/charts/TrendChart'
import { supabase } from '@/services/supabase'
import { scoreDisplay, scorePct } from '@/utils/format'
import { formatDate, daysAgo } from '@/utils/dates'

/**
 * Read-only archer history for admins (Admin 2 / Super Admin / scoped Admin 1).
 *
 * Shows the archer's full performance record — recent scores, trend, and
 * score-by-distance — and the COACH attributed to each session, so an admin can
 * trace which coach the archer had over time (including past coaches after an
 * unlink/relink). Works for unlinked archers too, because it relies on admin
 * read policies, not a coach link.
 *
 * Every score already stores coach_id at submission time (ScoreEntryForm stamps
 * the archer's active coach), so this is a pure display of existing data.
 *
 * A time-range filter narrows the whole view (stats, charts, table).
 * All queries de-embed and stitch — PostgREST embeds fail through the views.
 */

interface ScoreRow {
  id: string
  date: string
  total_score: number
  max_score: number
  status: string
  session_time?: string | null
  coach_id?: string | null
  coach_name?: string | null
  round: { id: string; name: string; distance_m: number | null } | null
}

type RangeKey = '1m' | '3m' | '6m' | '1y' | 'all'
const RANGES: { key: RangeKey; label: string; days: number | null }[] = [
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 182 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'All', days: null },
]

export function ArcherHistoryModal({
  archerId, archerName, archerCode, open, onClose,
}: {
  archerId: string | null
  archerName?: string | null
  archerCode?: string | null
  open: boolean
  onClose: () => void
}) {
  const [range, setRange] = useState<RangeKey>('6m')

  const { data: allScores = [], isLoading } = useQuery<ScoreRow[]>({
    queryKey: ['admin-archer-history', archerId],
    enabled: open && !!archerId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_submissions')
        .select('*')
        .eq('archer_id', archerId!)
        .order('date', { ascending: false })
        .limit(200)
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      if (!rows.length) return []

      // Resolve rounds and coach names separately (embeds fail via the views).
      const roundIds = [...new Set(rows.map((r) => r.round_id as string).filter(Boolean))]
      const coachIds = [...new Set(rows.map((r) => r.coach_id as string).filter(Boolean))]
      const [{ data: rounds }, { data: coaches }] = await Promise.all([
        roundIds.length
          ? supabase.from('rounds').select('id, name, distance_m').in('id', roundIds)
          : Promise.resolve({ data: [] as { id: string }[] }),
        coachIds.length
          ? supabase.from('profiles').select('id, name').in('id', coachIds)
          : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      ])
      const rmap = new Map(((rounds ?? []) as { id: string }[]).map((r) => [r.id, r]))
      const cmap = new Map(((coaches ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))
      return rows.map((r) => ({
        ...r,
        round: r.round_id ? rmap.get(r.round_id as string) ?? null : null,
        coach_name: r.coach_id ? cmap.get(r.coach_id as string) ?? null : null,
      })) as unknown as ScoreRow[]
    },
  })

  // Apply the time-range filter to the whole view.
  const scores = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)?.days ?? null
    if (days == null) return allScores
    const cutoff = daysAgo(days)
    return allScores.filter((s) => s.date >= cutoff)
  }, [allScores, range])

  const validated = scores.filter((s) => s.status === 'admin_approved')
  const bestPct = validated.length ? Math.max(...validated.map((s) => scorePct(s.total_score, s.max_score))) : null
  const avgPct = validated.length
    ? Math.round(validated.reduce((a, s) => a + scorePct(s.total_score, s.max_score), 0) / validated.length)
    : null

  // Distinct coaches seen in this window — surfaced so a coach change is obvious.
  const coachesSeen = [...new Set(scores.map((s) => s.coach_name).filter(Boolean))] as string[]

  const trend = [...scores]
    .sort((a, b) =>
      (a.date + (a.session_time ?? '')).localeCompare(b.date + (b.session_time ?? '')))
    .slice(-40)
    .map((s) => ({
      date: s.date,
      time: s.session_time ?? null,
      score: s.total_score,
      maxScore: s.max_score,
      status: s.status,
      label: s.round?.name,
    }))

  const distancePoints: DistancePoint[] = scores.map((s) => ({
    id: s.id,
    date: s.date,
    time: s.session_time ?? null,
    value: scorePct(s.total_score, s.max_score),
    distance: s.round?.distance_m ?? null,
  }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={archerName ? `History · ${archerName}` : 'Archer history'}
      width="min(680px,100%)"
    >
      {archerCode && (
        <p className="text-xs text-text-dim -mt-1 mb-3 font-mono tracking-wide">{archerCode}</p>
      )}

      {/* Time-range filter */}
      <div className="flex flex-wrap gap-1 mb-4">
        {RANGES.map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`text-xs px-2.5 py-1 rounded-lg font-semibold transition-colors ${
              range === r.key ? 'bg-primary text-primary-on' : 'bg-section text-text-dim hover:bg-surface-soft'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-10 text-center text-text-faint text-sm">Loading…</div>
      ) : allScores.length === 0 ? (
        <EmptyState title="No scores yet" description="This archer has not submitted any scores." />
      ) : scores.length === 0 ? (
        <EmptyState title="No scores in this range" description="Try a longer time range." />
      ) : (
        <div className="space-y-5">
          {/* Stat row */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Best score" value={bestPct != null ? `${bestPct}%` : '—'} sub={`${validated.length} validated`} />
            <StatCard label="Average" value={avgPct != null ? `${avgPct}%` : '—'} sub="of validated" />
            <StatCard label="Sessions" value={scores.length} sub="all statuses" />
          </div>

          {/* Coaches in this window */}
          <div className="text-xs text-text-dim">
            <span className="font-semibold text-text-faint uppercase tracking-wide">Coaches in range: </span>
            {coachesSeen.length ? coachesSeen.join(', ') : 'No coach attributed'}
          </div>

          {/* Score trend */}
          {trend.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">Score trend</h4>
              <ScoreTrendChart data={trend} height={200} />
            </div>
          )}

          {/* Score by distance */}
          {distancePoints.length > 1 && (
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">Score by distance</h4>
              <DistanceSeriesChart points={distancePoints} />
              <p className="text-[11px] text-text-faint mt-1">
                Shown as % of each round's maximum so different formats compare fairly.
              </p>
            </div>
          )}

          {/* Recent scores table — includes the coach for that session */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-text-faint mb-2">
              Sessions ({scores.length})
            </h4>
            <div className="table-wrap max-h-72 overflow-y-auto rounded-[var(--r)] border border-line">
              <table className="w-full text-sm border-collapse">
                <thead className="sticky top-0 bg-surface-soft">
                  <tr>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Date</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Round</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Coach</th>
                    <th className="text-right px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Score</th>
                    <th className="text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {scores.map((s) => (
                    <tr key={s.id} className="border-t border-line hover:bg-surface-soft">
                      <td className="px-3 py-2 text-text-dim whitespace-nowrap">{formatDate(s.date)}</td>
                      <td className="px-3 py-2 text-text-dim">{s.round?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-text-dim whitespace-nowrap">
                        {s.coach_name ?? <span className="text-text-faint italic">Unlinked</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-display font-semibold whitespace-nowrap">
                        {scoreDisplay(s.total_score, s.max_score)}
                      </td>
                      <td className="px-3 py-2"><SubmissionStatusBadge status={s.status as never} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

export default ArcherHistoryModal

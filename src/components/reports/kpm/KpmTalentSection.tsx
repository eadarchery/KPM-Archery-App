import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Badge, EmptyState, Modal } from '@/components/ui'
import { BreakdownTable, type Column } from '@/components/reports/BreakdownTable'
import { useLanguage } from '@/contexts/LanguageContext'
import type { ReportFilters } from '@/services/reports'
import {
  getKpmTalentSummary, getKpmTalentPipeline, getKpmTalentBreakdown,
  getKpmTalentCandidates, getKpmTournamentReadyCandidates,
  type KpmTalentGroupBy, type KpmTalentBreakdownRow, type KpmTalentCandidate,
  type KpmTalentPipelineRow,
} from '@/services/kpmMetrics'
import {
  fmtNum, fmtPct, fmtPp, GroupBySelect, KpmBackendNotice, InternalNote,
  ShowingNote, groupRowLabel, bandLabel, talentReasonLabel, ExplainBox, ORG_DIMS, DEMO_DIMS,
} from './shared'
import { ArcherTalentModal } from './ArcherTalentModal'

/**
 * Section 6 — Talent Pipeline (KPM Q7: are we finding talent?).
 * ⚠️ Bands (Beginner → Talent Pool) and talent reasons are INTERNAL development
 * heuristics from migration 066 — NOT official KPM classification. The caption
 * below is mandatory and must not be removed.
 */

type Translate = (key: string, vars?: Record<string, string | number>) => string

const GROUP_OPTS: { value: KpmTalentGroupBy; labelKey: string }[] = [
  ...ORG_DIMS,
  { value: 'coach', labelKey: 'roles.coach' },
  ...DEMO_DIMS,
]

const CANDIDATE_LIMIT = 25
const READY_LIMIT = 15

/**
 * Ordinal ramp for the development bands (low skill → elite). Colour + the
 * best-score-% range that defines each band (migration 066) turn the plain
 * grey bars into a readable "how far along is each archer" ladder.
 */
const BAND_META: Record<string, { color: string; range: string }> = {
  'Beginner':     { color: '#64748b', range: '<50%'    },
  'Developing':   { color: '#3b82f6', range: '50–65%'  },
  'Intermediate': { color: '#14b8a6', range: '65–75%'  },
  'Advanced':     { color: '#f59e0b', range: '75–85%'  },
  'Talent Pool':  { color: '#22c55e', range: '≥85%'    },
}
const bandColor = (band: string) => BAND_META[band]?.color ?? 'var(--primary)'
const bandRange = (band: string) => BAND_META[band]?.range ?? ''

function ReasonChips({
  reasons, onPick,
}: {
  reasons: string[]
  /** When provided, chips become buttons that zoom into the archer. reason=null → full picture. */
  onPick?: (reason: string | null) => void
}) {
  const { t } = useLanguage()
  const shown = reasons.slice(0, 3)
  const extra = reasons.length - shown.length

  if (!onPick) {
    return (
      <span className="flex flex-wrap gap-1 justify-end">
        {shown.map((r) => <Badge key={r} variant="primary">{talentReasonLabel(t, r)}</Badge>)}
        {extra > 0 && <Badge variant="neutral">+{extra}</Badge>}
      </span>
    )
  }

  return (
    <span className="flex flex-wrap gap-1 justify-end">
      {shown.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onPick(r)}
          title={t('kpm.talent.chipHint')}
          className="tag tag-primary cursor-pointer transition hover:brightness-110 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {talentReasonLabel(t, r)}
        </button>
      ))}
      {extra > 0 && (
        <button
          type="button"
          onClick={() => onPick(null)}
          title={t('kpm.talent.chipHint')}
          className="tag tag-neutral cursor-pointer transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          +{extra}
        </button>
      )}
    </span>
  )
}

const breakdownColumns = (t: Translate, groupBy: KpmTalentGroupBy): Column<KpmTalentBreakdownRow>[] => [
  {
    key: 'label', header: t('kpm.common.group'),
    render: (r) => <span className="font-medium text-text">{groupRowLabel(t, groupBy, r.group_label ?? r.group_key)}</span>,
  },
  { key: 'scored',     header: t('kpm.talent.scoredArchers'),  render: (r) => r.scored_archers, align: 'right', hide: 'sm' },
  { key: 'candidates', header: t('kpm.talent.candidates'),     render: (r) => r.candidates, align: 'right' },
  { key: 'top',        header: t('kpm.talent.topPerformers'),  render: (r) => r.top_performers, align: 'right', hide: 'sm' },
  { key: 'ready',      header: t('kpm.talent.tournamentReady'), render: (r) => r.tournament_ready, align: 'right' },
  { key: 'pool',       header: t('kpm.band.talentPool'),       render: (r) => r.talent_pool, align: 'right', hide: 'md' },
  { key: 'best',       header: t('kpm.talent.avgBestPct'),     render: (r) => fmtPct(r.avg_best_pct), align: 'right' },
]

const candidateColumns = (
  t: Translate,
  onReason?: (archer: KpmTalentCandidate, reason: string | null) => void,
): Column<KpmTalentCandidate>[] => [
  {
    key: 'archer', header: t('roles.archer'),
    render: (r) => (
      <span>
        <span className="font-medium text-text">{r.archer_name ?? '—'}</span>
        {r.archer_code && <span className="text-text-faint text-xs ml-1.5">{r.archer_code}</span>}
      </span>
    ),
  },
  { key: 'school', header: t('common.school'), render: (r) => r.school ?? r.pld ?? r.state ?? '—', hide: 'md' },
  { key: 'band',   header: t('kpm.talent.band'), render: (r) => <Badge variant="neutral">{bandLabel(t, r.current_band)}</Badge>, hide: 'sm' },
  { key: 'best',   header: t('kpm.common.bestPct'), render: (r) => fmtPct(r.best_pct), align: 'right' },
  { key: 'impr',   header: t('overview.improvement'), render: (r) => fmtPp(r.improvement_pp), align: 'right', hide: 'sm' },
  {
    key: 'reasons', header: t('kpm.talent.reasons'), align: 'right',
    render: (r) => (
      <ReasonChips
        reasons={r.talent_reasons ?? []}
        onPick={onReason ? (reason) => onReason(r, reason) : undefined}
      />
    ),
  },
]

const readyColumns = (t: Translate): Column<KpmTalentCandidate>[] => [
  {
    key: 'archer', header: t('roles.archer'),
    render: (r) => (
      <span>
        <span className="font-medium text-text">{r.archer_name ?? '—'}</span>
        {r.archer_code && <span className="text-text-faint text-xs ml-1.5">{r.archer_code}</span>}
      </span>
    ),
  },
  { key: 'school', header: t('common.school'), render: (r) => r.school ?? r.pld ?? r.state ?? '—', hide: 'md' },
  { key: 'band',   header: t('kpm.talent.band'), render: (r) => <Badge variant="neutral">{bandLabel(t, r.current_band)}</Badge>, hide: 'sm' },
  { key: 'tCount', header: t('kpm.talent.tournaments'), render: (r) => r.tournament_count, align: 'right' },
  { key: 'tBest',  header: t('kpm.talent.bestTournamentPct'), render: (r) => fmtPct(r.best_tournament_pct), align: 'right' },
  { key: 'best',   header: t('kpm.common.bestPct'), render: (r) => fmtPct(r.best_pct), align: 'right', hide: 'sm' },
]

export function KpmTalentSection({
  filters, defaultGroupBy = 'state',
}: {
  filters: ReportFilters
  defaultGroupBy?: KpmTalentGroupBy
}) {
  const { t } = useLanguage()
  const fkey = JSON.stringify(filters)
  const [groupBy, setGroupBy] = useState<KpmTalentGroupBy>(defaultGroupBy)
  const [drill, setDrill] = useState<{ title: string; rows: KpmTalentCandidate[]; note?: string } | null>(null)
  const [talentArcher, setTalentArcher] = useState<{ archer: KpmTalentCandidate; focus: string | null } | null>(null)
  const openArcher = (archer: KpmTalentCandidate, reason: string | null) => setTalentArcher({ archer, focus: reason })

  const { data: s, error: e1 } = useQuery({
    queryKey: ['kpm-talent-sum', fkey],
    queryFn: () => getKpmTalentSummary(filters),
    staleTime: 120_000,
  })
  const { data: pipeline = [], error: e2 } = useQuery({
    queryKey: ['kpm-talent-pipe', fkey],
    queryFn: () => getKpmTalentPipeline(filters),
    staleTime: 120_000,
  })
  const { data: bdRows = [], error: e3 } = useQuery({
    queryKey: ['kpm-talent-bd', groupBy, fkey],
    queryFn: () => getKpmTalentBreakdown(groupBy, filters),
    staleTime: 120_000,
  })
  const { data: candidates = [], error: e4 } = useQuery({
    queryKey: ['kpm-talent-cand', fkey],
    queryFn: () => getKpmTalentCandidates(filters),
    staleTime: 120_000,
  })
  const { data: ready = [], error: e5 } = useQuery({
    queryKey: ['kpm-talent-ready', fkey],
    queryFn: () => getKpmTournamentReadyCandidates(filters),
    staleTime: 120_000,
  })

  const backendError = e1 ?? e2 ?? e3 ?? e4 ?? e5
  const maxBand = Math.max(1, ...pipeline.map((p) => p.archers))

  // Clicking a card lists the matching archers. The candidate list already
  // carries each archer's talent_reasons, so most cards are a client-side
  // filter of the same list — no extra query.
  const byReason = (reason: string) => candidates.filter((c) => c.talent_reasons?.includes(reason as never))
  const openDrill = (labelKey: string, rows: KpmTalentCandidate[]) => setDrill({ title: t(labelKey), rows })

  // Clicking a band lists its archers. The candidate list only carries flagged
  // archers, so the note states how many of the band's total that covers.
  const openBand = (band: KpmTalentPipelineRow) => {
    const rows = candidates.filter((c) => c.current_band === band.band)
    setDrill({
      title: t('kpm.talent.bandDrillTitle', { band: bandLabel(t, band.band) }),
      rows,
      note: t('kpm.talent.bandDrillHint', { shown: rows.length, total: band.archers }),
    })
  }

  return (
    <>
      {/* MANDATORY caption — internal bands, not official KPM classification. */}
      <InternalNote>{t('kpm.talent.internalNote')}</InternalNote>

      {backendError != null && <KpmBackendNotice migrations="066" error={backendError} />}

      {/* Talent indicator cards — click any to list the archers behind the number */}
      <ExplainBox>{t('kpm.explain.talentCards')}</ExplainBox>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('kpm.talent.candidates')}      value={fmtNum(s?.total_candidates)} accent
          clickable onClick={() => openDrill('kpm.talent.candidates', candidates)} />
        <StatCard label={t('kpm.talent.topPerformers')}   value={fmtNum(s?.top_performers)} tone="success"
          clickable onClick={() => openDrill('kpm.talent.topPerformers', byReason('Top Performer'))} />
        <StatCard label={t('kpm.talent.fastImprovers')}   value={fmtNum(s?.fast_improvers)} tone="success" trend="up"
          clickable onClick={() => openDrill('kpm.talent.fastImprovers', byReason('Fast Improver'))} />
        <StatCard label={t('kpm.talent.consistent')}      value={fmtNum(s?.consistent_archers)} tone="primary"
          clickable onClick={() => openDrill('kpm.talent.consistent', byReason('Consistent Archer'))} />
        <StatCard label={t('kpm.talent.tournamentReady')} value={fmtNum(s?.tournament_ready)} tone="success"
          clickable onClick={() => openDrill('kpm.talent.tournamentReady', ready)} />
        <StatCard label={t('kpm.talent.hiddenTalent')}    value={fmtNum(s?.hidden_talent)} tone="warning"
          clickable onClick={() => openDrill('kpm.talent.hiddenTalent', byReason('Hidden Talent'))} />
        <StatCard label={t('kpm.talent.bandPromotions')}  value={fmtNum(s?.band_promotions)} tone="success" trend="up"
          clickable onClick={() => openDrill('kpm.talent.bandPromotions', byReason('Band Promotion'))} />
        <StatCard label={t('kpm.talent.scoredArchers')}   value={fmtNum(s?.scored_archers)} sub={t('kpm.talent.scoredHint')} tone="neutral"
          clickable onClick={() => openDrill('kpm.talent.scoredArchers', candidates)} />
      </div>

      {/* Development band funnel */}
      <SectionCard title={t('kpm.talent.funnelTitle')} className="mb-6">
        <ExplainBox>{t('kpm.talent.funnelExplain')}</ExplainBox>
        {pipeline.length === 0 ? (
          <EmptyState title={t('common.noData')} />
        ) : (
          <div className="mt-3">
            {/* Column headers */}
            <div className="flex items-center gap-3 pb-1.5 mb-1 border-b border-line text-[10px] uppercase tracking-wide text-text-faint">
              <span className="w-28 sm:w-40 shrink-0">{t('kpm.talent.band')}</span>
              <span className="flex-1 hidden sm:block">{t('kpm.talent.funnelHeaderShare')}</span>
              <span className="w-12 text-right">{t('nav.archers')}</span>
              <span className="w-14 text-right hidden sm:block">{t('kpm.talent.funnelHeaderPct')}</span>
              <span className="w-16 text-right hidden md:block">{t('kpm.talent.funnelHeaderBest')}</span>
            </div>

            <div className="space-y-1">
              {pipeline.map((band) => {
                const color = bandColor(band.band)
                return (
                  <button
                    key={band.band}
                    type="button"
                    onClick={() => openBand(band)}
                    className="w-full flex items-center gap-3 rounded-[var(--r-sm)] px-1.5 py-1.5 -mx-1.5 text-left transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {/* Band name + colour dot + the score range that defines it */}
                    <span className="w-28 sm:w-40 shrink-0">
                      <span className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} aria-hidden />
                        <span className="text-sm font-medium text-text truncate">{bandLabel(t, band.band)}</span>
                      </span>
                      <span className="block text-[10px] text-text-faint ml-[18px]">{bandRange(band.band)}</span>
                    </span>
                    {/* Coloured bar */}
                    <span className="flex-1 h-5 rounded-[6px] bg-surface-soft overflow-hidden hidden sm:block">
                      <span
                        className="block h-full rounded-[6px] transition-all"
                        style={{ width: `${Math.max(2, (band.archers / maxBand) * 100)}%`, background: color }}
                      />
                    </span>
                    <span className="w-12 text-right text-sm tabular-nums font-semibold text-text">{band.archers}</span>
                    <span className="w-14 text-right text-xs tabular-nums text-text-faint hidden sm:block">{fmtPct(band.pct_of_total)}</span>
                    <span className="w-16 text-right text-xs tabular-nums text-text-faint hidden md:block">{fmtPct(band.avg_best_pct)}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[11px] text-text-faint pt-2">{t('kpm.talent.clickBandHint')}</p>
          </div>
        )}
      </SectionCard>

      {/* Breakdown */}
      <SectionCard title={t('kpm.talent.breakdown')} className="mb-6">
        <GroupBySelect value={groupBy} onChange={setGroupBy} options={GROUP_OPTS} />
        <BreakdownTable<KpmTalentBreakdownRow>
          rows={bdRows}
          getKey={(r) => `${r.group_key ?? r.group_label ?? 'null'}`}
          emptyTitle={t('common.noData')}
          columns={breakdownColumns(t, groupBy)}
        />
      </SectionCard>

      {/* Candidate list */}
      <SectionCard title={t('kpm.talent.candidateList')} className="mb-6">
        <p className="text-[11px] text-text-faint mb-2">{t('kpm.talent.chipHint')}</p>
        <BreakdownTable<KpmTalentCandidate>
          rows={candidates.slice(0, CANDIDATE_LIMIT)}
          getKey={(r) => r.archer_id}
          emptyTitle={t('talents.empty')}
          columns={candidateColumns(t, openArcher)}
        />
        <ShowingNote shown={Math.min(CANDIDATE_LIMIT, candidates.length)} total={candidates.length} />
      </SectionCard>

      {/* Tournament-ready list */}
      <SectionCard title={t('kpm.talent.readyList')} className="mb-6">
        <BreakdownTable<KpmTalentCandidate>
          rows={ready.slice(0, READY_LIMIT)}
          getKey={(r) => r.archer_id}
          emptyTitle={t('common.noData')}
          columns={readyColumns(t)}
        />
        <ShowingNote shown={Math.min(READY_LIMIT, ready.length)} total={ready.length} />
      </SectionCard>

      {/* Card drill-down: the archers behind a clicked talent number */}
      {drill && (
        <Modal open onClose={() => setDrill(null)} title={drill.title} width="min(760px,100%)">
          <p className="text-xs text-text-dim mb-3">{drill.note ?? t('kpm.talent.drillHint', { n: drill.rows.length })}</p>
          <div className="max-h-[64vh] overflow-y-auto">
            <BreakdownTable<KpmTalentCandidate>
              rows={drill.rows.slice(0, CANDIDATE_LIMIT)}
              getKey={(r) => r.archer_id}
              emptyTitle={t('talents.empty')}
              columns={candidateColumns(t, openArcher)}
            />
          </div>
          <ShowingNote shown={Math.min(CANDIDATE_LIMIT, drill.rows.length)} total={drill.rows.length} />
        </Modal>
      )}

      {/* Reason-chip zoom: why this archer earned each talent flag */}
      <ArcherTalentModal
        archer={talentArcher?.archer ?? null}
        focusReason={talentArcher?.focus ?? null}
        onClose={() => setTalentArcher(null)}
      />
    </>
  )
}

export default KpmTalentSection

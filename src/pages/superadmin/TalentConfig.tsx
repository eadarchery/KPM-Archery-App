import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, ConfirmDialog, useToast } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { writeAuditLog } from '@/services/auditLog'
import {
  getKpmTalentConfig, updateKpmTalentConfig,
  KPM_TALENT_CONFIG_DEFAULTS, type KpmTalentConfig,
} from '@/services/kpmMetrics'

/**
 * Super-Admin-only screen to tune how archers are rated into talent titles.
 *
 * These numbers are the ONLY source of truth for the talent flags — they feed
 * kpm_talent_scored (migration 071), so saving here instantly changes every
 * report card, the funnel, the candidate lists, the breakdowns and the archer
 * popup. No SQL, no app rebuild.
 *
 * Write access is enforced server-side by RLS (super_admin only); a non-super
 * user's save simply fails at the database.
 */

type FieldDef = {
  key: keyof KpmTalentConfig
  label: string
  suffix: string
  min: number
  max: number
  step: number
}

type GroupDef = { title: string; blurb: string; rule: string; fields: FieldDef[] }

const PCT = { suffix: '%', min: 0, max: 100, step: 1 }
const CNT = { suffix: '', min: 1, max: 50, step: 1 }

const GROUPS: GroupDef[] = [
  {
    title: 'Top Performer',
    blurb: 'Elite scorer — reached a very high verified score.',
    rule: 'best verified score % ≥ {top_performer_min_pct}',
    fields: [{ key: 'top_performer_min_pct', label: 'Minimum best score', ...PCT }],
  },
  {
    title: 'Fast Improver',
    blurb: 'Getting better quickly across their recent scores.',
    rule: '(latest − first) ≥ {fast_improver_min_pp} pp  AND  scores ≥ {fast_improver_min_scores}',
    fields: [
      { key: 'fast_improver_min_pp', label: 'Minimum improvement', suffix: 'pp', min: 0, max: 100, step: 1 },
      { key: 'fast_improver_min_scores', label: 'Minimum scores', ...CNT },
    ],
  },
  {
    title: 'Consistent Archer',
    blurb: 'Reliably steady, not one lucky round.',
    rule: 'scores ≥ {consistent_min_scores}  AND  consistency ≥ {consistent_min_consistency}  AND  average % ≥ {consistent_min_avg_pct}',
    fields: [
      { key: 'consistent_min_scores', label: 'Minimum scores', ...CNT },
      { key: 'consistent_min_consistency', label: 'Minimum consistency (/100)', suffix: '/100', min: 0, max: 100, step: 1 },
      { key: 'consistent_min_avg_pct', label: 'Minimum average', ...PCT },
    ],
  },
  {
    title: 'Tournament Ready',
    blurb: 'Proven under competition pressure.',
    rule: 'tournaments ≥ {tournament_ready_min_count}  AND  best tournament % ≥ {tournament_ready_min_pct}',
    fields: [
      { key: 'tournament_ready_min_count', label: 'Minimum tournaments', ...CNT },
      { key: 'tournament_ready_min_pct', label: 'Minimum tournament score', ...PCT },
    ],
  },
  {
    title: 'Hidden Talent',
    blurb: 'Strong scorer with fewer sessions than typical — easy to overlook. (The "fewer sessions" side compares to the school median automatically.)',
    rule: 'best % ≥ {hidden_talent_min_pct}  AND  score count ≤ school median',
    fields: [{ key: 'hidden_talent_min_pct', label: 'Minimum best score', ...PCT }],
  },
  {
    title: 'Achievement Milestone',
    blurb: 'Earned recognition badges in the period.',
    rule: 'achievements earned ≥ {achievement_min_count}',
    fields: [{ key: 'achievement_min_count', label: 'Minimum achievements', ...CNT }],
  },
]

const fillRule = (rule: string, cfg: KpmTalentConfig) =>
  rule.replace(/\{(\w+)\}/g, (_, k: string) => String(cfg[k as keyof KpmTalentConfig] ?? '—'))

export default function SuperAdminTalentConfig() {
  const { profile } = useAuth()
  const { ok, err } = useToast()
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['kpm-talent-config'],
    queryFn: getKpmTalentConfig,
    staleTime: 60_000,
  })

  const [form, setForm] = useState<KpmTalentConfig>(KPM_TALENT_CONFIG_DEFAULTS)
  const [saveOpen, setSaveOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Load server values into the editable form once fetched.
  useEffect(() => { if (data) setForm(data) }, [data])

  const dirty = !!data && (Object.keys(form) as (keyof KpmTalentConfig)[]).some((k) => Number(form[k]) !== Number(data[k]))

  const setField = (key: keyof KpmTalentConfig, raw: string) => {
    const n = raw === '' ? 0 : Number(raw)
    if (!Number.isFinite(n)) return
    setForm((f) => ({ ...f, [key]: n }))
  }

  async function runSave() {
    setBusy(true)
    try {
      await updateKpmTalentConfig(form)
      if (profile?.id) writeAuditLog(profile.id, 'super_admin.talent_config_updated', 'system', undefined, { ...form })
      ok('Talent rating updated', 'All talent reports now use the new thresholds.')
      refetch()
    } catch (e) {
      err('Save failed', (e as Error).message)
    } finally {
      setBusy(false)
      setSaveOpen(false)
    }
  }

  return (
    <PageWrapper>
      <PageHead
        title="Talent Rating"
        description="Set the thresholds that decide which archers earn each talent title. Saving updates every talent report instantly."
      />

      {/* Context banner */}
      <div className="mb-6 rounded-[var(--r-lg)] border border-primary/30 bg-primary-soft/25 p-4 text-sm text-text-dim leading-relaxed">
        <strong className="text-text">One place controls all talent numbers.</strong>{' '}
        Every card, the development funnel, the candidate lists and the archer pop-ups read these
        values. Change a number, save, and the whole Talent report re-rates immediately — no SQL and
        no re-deploy. These are <em>internal</em> development heuristics, not official KPM standards.
      </div>

      {error != null && (
        <div className="mb-6 rounded-[var(--r-lg)] border border-danger/40 bg-danger-soft/30 p-4 text-sm text-text-dim">
          Couldn’t load the config. Make sure migration <code className="text-primary">071_kpm_talent_config.sql</code> has been run in Supabase.
          <div className="text-[11px] text-text-faint mt-1">{(error as Error).message}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {GROUPS.map((g) => (
          <SectionCard key={g.title} title={g.title}>
            <p className="text-sm text-text-dim leading-relaxed mb-1">{g.blurb}</p>
            <p className="text-[11px] text-text-faint font-mono mb-4">{fillRule(g.rule, form)}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {g.fields.map((fld) => (
                <label key={fld.key} className="block">
                  <span className="block text-xs font-medium text-text-dim mb-1">{fld.label}</span>
                  <span className="flex items-center gap-2">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={String(form[fld.key] ?? '')}
                      min={fld.min}
                      max={fld.max}
                      step={fld.step}
                      disabled={isLoading}
                      onChange={(e) => setField(fld.key, e.target.value)}
                      className="w-full rounded-[var(--r)] border border-line bg-surface px-3 py-2 text-sm text-text tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    />
                    {fld.suffix && <span className="text-xs text-text-faint shrink-0">{fld.suffix}</span>}
                  </span>
                </label>
              ))}
            </div>
          </SectionCard>
        ))}
      </div>

      {/* Sticky-ish action bar */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={!dirty || isLoading} loading={busy} onClick={() => setSaveOpen(true)}>
          Save changes
        </Button>
        <Button variant="ghost" disabled={isLoading || busy} onClick={() => data && setForm(data)}>
          Discard
        </Button>
        <Button variant="ghost" disabled={isLoading || busy} onClick={() => setForm(KPM_TALENT_CONFIG_DEFAULTS)}>
          Reset to defaults
        </Button>
        {dirty && <span className="text-xs text-warning">Unsaved changes</span>}
      </div>

      <ConfirmDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        onConfirm={runSave}
        loading={busy}
        title="Update talent rating?"
        confirmLabel="Save changes"
        message="This changes how every archer is rated across all talent reports for everyone. It does not alter any scores — only which archers earn each title."
      />
    </PageWrapper>
  )
}

import { useState } from 'react'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, ConfirmDialog, useToast } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { writeAuditLog } from '@/services/auditLog'
import { useAuth } from '@/hooks/useAuth'

/**
 * Super-Admin-only developer tool: populate the app with realistic demo data
 * for dashboards / reports / leaderboards, or remove it again.
 *
 * ALL demo rows are tagged is_mock_data = true in the database. The clear
 * action deletes ONLY those rows — real production data is never touched.
 * Both actions call SECURITY DEFINER RPCs (070_mock_demo_data.sql) that
 * re-check Super Admin server-side, so no service-role key is involved.
 */

type SeedResult = {
  ok?: boolean
  batch_id?: string
  created?: Record<string, number>
  removed?: Record<string, number>
}

export default function SuperAdminDemoData() {
  const { profile } = useAuth()
  const { ok, err } = useToast()
  const [seedOpen, setSeedOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [busy, setBusy] = useState<'seed' | 'clear' | null>(null)
  const [lastSeed, setLastSeed] = useState<SeedResult | null>(null)
  const [lastClear, setLastClear] = useState<SeedResult | null>(null)

  async function runSeed() {
    setBusy('seed')
    try {
      const { data, error } = await supabase.rpc('seed_kpm_demo_mock_data')
      if (error) throw error
      const res = data as SeedResult
      setLastSeed(res)
      if (profile?.id) {
        writeAuditLog(profile.id, 'super_admin.demo_data_seeded', 'system', undefined, res.created ?? {})
      }
      ok('Demo data seeded', 'Dashboards and reports are now populated.')
    } catch (e) {
      err('Seeding failed', (e as Error).message)
    } finally {
      setBusy(null)
      setSeedOpen(false)
    }
  }

  async function runClear() {
    setBusy('clear')
    try {
      const { data, error } = await supabase.rpc('clear_kpm_demo_mock_data')
      if (error) throw error
      const res = data as SeedResult
      setLastClear(res)
      setLastSeed(null)
      if (profile?.id) {
        writeAuditLog(profile.id, 'super_admin.demo_data_cleared', 'system', undefined, res.removed ?? {})
      }
      ok('Demo data cleared', 'Only mock/demo rows were removed. Real data is untouched.')
    } catch (e) {
      err('Clear failed', (e as Error).message)
    } finally {
      setBusy(null)
      setClearOpen(false)
    }
  }

  return (
    <PageWrapper>
      <PageHead
        title="Demo Data"
        description="Populate the app with realistic mock data for testing and presentations, then remove it cleanly."
      />

      {/* Safety banner */}
      <div className="mb-6 rounded-[var(--r-lg)] border border-warning/40 bg-warning-soft/30 p-4 text-sm text-text-dim leading-relaxed">
        <strong className="text-text">This tool only affects tagged demo data.</strong>{' '}
        Everything it creates is marked <code className="text-primary">is_mock_data = true</code> in
        the database. Clearing removes <em>only</em> those rows — real archers, coaches, scores,
        schools and states are never deleted. Demo accounts have no login and use{' '}
        <code>@kpm-demo.invalid</code> emails, so nobody can sign in as one.
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Seed */}
        <SectionCard title="Seed KPM Demo Data">
          <p className="text-sm text-text-dim leading-relaxed mb-4">
            Creates 6 states, 3 schools each, 36 archers (across U12/U15/U18/Open, recurve/compound/
            barebow, in good/medium/low bands), 12 coaches, ~216 improving score sessions over the
            past ~5 months, and training logs. Running it again replaces the previous demo batch —
            it never duplicates.
          </p>
          <Button variant="primary" loading={busy === 'seed'} onClick={() => setSeedOpen(true)}>
            Seed KPM Demo Data
          </Button>

          {lastSeed?.created && (
            <div className="mt-4 rounded-[var(--r)] bg-surface-soft p-3">
              <div className="text-xs font-semibold text-text mb-2">Last seed created:</div>
              <SummaryGrid data={lastSeed.created} />
            </div>
          )}
        </SectionCard>

        {/* Clear */}
        <SectionCard title="Clear KPM Demo Data">
          <p className="text-sm text-text-dim leading-relaxed mb-4">
            Permanently removes every mock/demo row created by the seed — mock scores, coach links,
            training logs, archers, coaches, and any demo schools, PLDs and states. Real production
            data is not deleted.
          </p>
          <Button variant="danger" loading={busy === 'clear'} onClick={() => setClearOpen(true)}>
            Clear KPM Demo Data
          </Button>

          {lastClear?.removed && (
            <div className="mt-4 rounded-[var(--r)] bg-surface-soft p-3">
              <div className="text-xs font-semibold text-text mb-2">Last clear removed:</div>
              <SummaryGrid data={lastClear.removed} />
            </div>
          )}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={seedOpen}
        onClose={() => setSeedOpen(false)}
        onConfirm={runSeed}
        loading={busy === 'seed'}
        title="Seed demo data?"
        confirmLabel="Seed demo data"
        message="This inserts a fresh batch of clearly-tagged mock data (replacing any previous demo batch). Real data is not affected."
      />

      <ConfirmDialog
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        onConfirm={runClear}
        loading={busy === 'clear'}
        destructive
        title="Clear demo data?"
        confirmLabel="Clear demo data"
        message="This will remove only mock/demo data. Real production data will not be deleted."
      />
    </PageWrapper>
  )
}

function SummaryGrid({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data)
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline gap-1.5">
          <span className="font-display font-semibold text-sm text-text">{v}</span>
          <span className="text-[11px] text-text-faint capitalize">{k.replace(/_/g, ' ')}</span>
        </div>
      ))}
    </div>
  )
}

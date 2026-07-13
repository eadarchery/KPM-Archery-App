import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button,
  AccountStatusBadge,
  Badge,
  Avatar,
  Input,
  Textarea,
  Modal,
  Select,
  EmptyState,
  useToast,
  StatCard,
  HelpTip,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/services/supabase'
import { writeAuditLog } from '@/services/auditLog'
import { CoachSchoolCode } from '@/components/coach/CoachSchoolCode'
import { QrScannerModal } from '@/components/coach/QrScannerModal'
import {
  getPendingSchoolArchers, approveSchoolArcher, rejectSchoolArcher, type PendingSchoolArcher,
} from '@/services/schoolRegistration'
import { useLanguage } from '@/contexts/LanguageContext'
import { formatDate, timeAgo } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { AccountStatus, Role } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

type LinkStatus = 'pending' | 'active' | 'inactive' | 'rejected'
type ArcherTab  = 'pending' | 'active' | 'inactive' | 'all'

interface ArcherShape {
  id: string
  name: string
  email: string
  archer_id?: string
  age?: number
  status: AccountStatus
  role: Role
  school?: { id: string; name: string }
  pld?:   { id: string; name: string }
  state?: { id: string; name: string; code: string }
}

interface LinkRow {
  id: string
  coach_id: string
  archer_id: string
  status: LinkStatus
  initiated_by?: string
  linked_at: string
  approved_at?: string
  approved_by?: string
  rejected_at?: string
  rejection_reason?: string
  unlinked_at?: string
  created_at: string
  archer: ArcherShape | null
}

interface ArcherFilters {
  stateCode: string
  pldId:     string
  schoolId:  string
  ageGroup:  string
}

/** Flat profile columns fetched separately (no PostgREST embedding). */
interface RawArcherProfile {
  id: string
  name: string
  email: string
  archer_id: string | null
  age: number | null
  status: AccountStatus
  role: Role
  school_id: string | null
  pld_id: string | null
  state_id: string | null
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TABS: { key: ArcherTab; labelKey: string }[] = [
  { key: 'pending',  labelKey: 'coachArchers.tabPending' },
  { key: 'active',   labelKey: 'coachArchers.tabActive' },
  { key: 'inactive', labelKey: 'status.inactive' },
  { key: 'all',      labelKey: 'common.all' },
]

const DEFAULT_FILTERS: ArcherFilters = { stateCode: '', pldId: '', schoolId: '', ageGroup: '' }

const AGE_GROUPS = [
  { value: '',     labelKey: 'common.allAges' },
  { value: 'u14',  labelKey: 'coachArchers.u14' },
  { value: 'u18',  labelKey: 'coachArchers.u18' },
  { value: 'u21',  labelKey: 'coachArchers.u21' },
  { value: 'open', labelKey: 'leaderboardPage.open22' },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function archerName(r: LinkRow)  { return r.archer?.name          ?? '—' }
function archerAid(r: LinkRow)   { return r.archer?.archer_id     ?? '—' }
function schoolName(r: LinkRow)  { return r.archer?.school?.name  ?? '—' }
function pldName(r: LinkRow)     { return r.archer?.pld?.name     ?? '—' }
function stateCode(r: LinkRow)   { return r.archer?.state?.code   ?? '—' }

function ageGroup(age?: number): string {
  if (!age) return ''
  if (age <= 14) return 'u14'
  if (age <= 18) return 'u18'
  if (age <= 21) return 'u21'
  return 'open'
}

/** Caps-lock and spacing tolerant name comparison for confirmations. */
function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase()
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function CoachArchers() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const queryClient  = useQueryClient()
  const navigate     = useNavigate()

  const [tab, setTab]         = useState<ArcherTab>('pending')
  const [search, setSearch]   = useState('')
  const [filters, setFilters] = useState<ArcherFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Action modal
  const [selectedLink, setSelectedLink] = useState<LinkRow | null>(null)
  const [actionType, setActionType]     = useState<'approve' | 'reject' | 'unlink' | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [reasonErr, setReasonErr]       = useState(false)
  const [acting, setActing]             = useState(false)
  const [unlinkConfirm, setUnlinkConfirm] = useState('')
  const [approvingRegId, setApprovingRegId] = useState<string | null>(null)
  // School-code registration rejection (migration 056) — reason required.
  const [rejectingReg, setRejectingReg] = useState<PendingSchoolArcher | null>(null)
  const [regRejectReason, setRegRejectReason] = useState('')
  const [regRejectErr, setRegRejectErr] = useState(false)
  const [regRejectBusy, setRegRejectBusy] = useState(false)

  // Link-new-archer panel
  const [showLinkPanel, setShowLinkPanel] = useState(false)
  const [archerSearch, setArcherSearch]   = useState('')
  const [foundArcher, setFoundArcher]     = useState<ArcherShape | null>(null)
  const [findErr, setFindErr]             = useState('')
  const [searching, setSearching]         = useState(false)
  const [linking, setLinking]             = useState(false)
  const [showQrModal, setShowQrModal]     = useState(false)

  const setFilter = (k: keyof ArcherFilters, v: string) => setFilters(f => ({ ...f, [k]: v }))
  const activeFilterCount = Object.values(filters).filter(v => v !== '').length

  // ── Fetch link rows ──────────────────────────────────────────────────────
  const { data: links = [], isLoading, isError } = useQuery<LinkRow[]>({
    queryKey: ['coach-archers-list', profile?.id, tab],
    queryFn: async () => {
      if (!profile?.id) return []

      // Link rows — NO embedded joins. PostgREST relationship embedding through
      // the security_invoker public views (coach_archer_links → profiles → org)
      // is unreliable and can fail the whole request. We resolve the archer and
      // org names with separate RLS-scoped queries and stitch them client-side.
      let q = supabase
        .from('coach_archer_links')
        .select(`
          id, coach_id, archer_id, status, initiated_by, linked_at,
          approved_at, approved_by, rejected_at, rejection_reason,
          unlinked_at, created_at
        `)
        .eq('coach_id', profile.id)
        .order('created_at', { ascending: false })

      if (tab === 'inactive') {
        q = q.in('status', ['inactive', 'rejected'])
      } else if (tab !== 'all') {
        q = q.eq('status', tab)
      }

      const { data: linkData, error } = await q
      if (error) throw error
      const rows = (linkData ?? []) as Omit<LinkRow, 'archer'>[]
      if (rows.length === 0) return []

      // Archer profiles (RLS returns only those the coach may read) + org names.
      const archerIds = [...new Set(rows.map((r) => r.archer_id))]
      const [profRes, stateRes, pldRes, schoolRes] = await Promise.all([
        supabase.from('profiles')
          .select('id, name, email, archer_id, age, status, role, school_id, pld_id, state_id')
          .in('id', archerIds),
        supabase.from('states').select('id, name, code'),
        supabase.from('plds').select('id, name'),
        supabase.from('schools').select('id, name'),
      ])

      const stateRows  = (stateRes.data  ?? []) as { id: string; name: string; code: string }[]
      const pldRows    = (pldRes.data    ?? []) as { id: string; name: string }[]
      const schoolRows = (schoolRes.data ?? []) as { id: string; name: string }[]
      const states  = new Map(stateRows.map((s) => [s.id, s]))
      const plds    = new Map(pldRows.map((p) => [p.id, p]))
      const schools = new Map(schoolRows.map((s) => [s.id, s]))

      const archerById = new Map<string, ArcherShape>()
      for (const p of (profRes.data ?? []) as RawArcherProfile[]) {
        archerById.set(p.id, {
          id: p.id,
          name: p.name,
          email: p.email,
          archer_id: p.archer_id ?? undefined,
          age: p.age ?? undefined,
          status: p.status,
          role: p.role,
          school: p.school_id ? schools.get(p.school_id) : undefined,
          pld:    p.pld_id    ? plds.get(p.pld_id)       : undefined,
          state:  p.state_id  ? states.get(p.state_id)   : undefined,
        })
      }

      return rows.map((r) => ({ ...r, archer: archerById.get(r.archer_id) ?? null })) as LinkRow[]
    },
    enabled: !!profile?.id,
    staleTime: 30_000,
  })

  // ── Tab counts + linked-archer ids (for deduping the school-code queue) ───
  const { data: linkSummary } = useQuery<{ counts: Record<ArcherTab, number>; linkedArcherIds: Set<string> }>({
    queryKey: ['coach-archers-counts', profile?.id],
    queryFn: async () => {
      const empty = { counts: { pending: 0, active: 0, inactive: 0, all: 0 }, linkedArcherIds: new Set<string>() }
      if (!profile?.id) return empty
      const { data, error } = await supabase
        .from('coach_archer_links')
        .select('id, archer_id, status')
        .eq('coach_id', profile.id)
      if (error) throw error
      const rows = (data ?? []) as { id: string; archer_id: string; status: LinkStatus }[]
      return {
        counts: {
          pending:  rows.filter(r => r.status === 'pending').length,
          active:   rows.filter(r => r.status === 'active').length,
          inactive: rows.filter(r => r.status === 'inactive' || r.status === 'rejected').length,
          all:      rows.length,
        },
        // Any link row (whatever its status) means the archer already appears in
        // the links table — the school-code queue must not show them again.
        linkedArcherIds: new Set(rows.filter(r => r.status !== 'rejected').map(r => r.archer_id)),
      }
    },
    enabled: !!profile?.id,
    staleTime: 30_000,
  })
  const counts = linkSummary?.counts

  // ── School-code registrations (archers who registered with this coach's code) ──
  // Folded into the Pending / All queue below instead of a separate box.
  const schoolRegsQ = useQuery({
    queryKey: ['coach-pending-school-archers'],
    queryFn: getPendingSchoolArchers,
    enabled: !!profile?.id,
    staleTime: 30_000,
  })

  async function handleApproveSchoolReg(id: string) {
    setApprovingRegId(id)
    try {
      await approveSchoolArcher(id)
      ok(t('coachArchers.schoolRegApproved'))
      queryClient.invalidateQueries({ queryKey: ['coach-pending-school-archers'] })
      queryClient.invalidateQueries({ queryKey: ['coach-archers-list'] })
      queryClient.invalidateQueries({ queryKey: ['coach-archers-counts'] })
    } catch (e: unknown) {
      err(e instanceof Error ? e.message : t('common.actionFailed'))
    } finally {
      setApprovingRegId(null)
    }
  }

  const openRejectReg = (a: PendingSchoolArcher) => {
    setRejectingReg(a)
    setRegRejectReason('')
    setRegRejectErr(false)
  }
  const closeRejectReg = () => {
    if (regRejectBusy) return
    setRejectingReg(null)
    setRegRejectReason('')
    setRegRejectErr(false)
  }

  async function handleRejectSchoolReg() {
    if (!rejectingReg) return
    if (!regRejectReason.trim()) { setRegRejectErr(true); return }
    setRegRejectBusy(true)
    try {
      await rejectSchoolArcher(rejectingReg.id, regRejectReason)
      ok(t('coachArchers.schoolRegRejected', { name: rejectingReg.name || rejectingReg.email }))
      queryClient.invalidateQueries({ queryKey: ['coach-pending-school-archers'] })
      queryClient.invalidateQueries({ queryKey: ['coach-archers-counts'] })
      setRejectingReg(null)
      setRegRejectReason('')
    } catch (e: unknown) {
      err(e instanceof Error ? e.message : t('common.actionFailed'))
    } finally {
      setRegRejectBusy(false)
    }
  }

  // ── Client-side filter + search ───────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = links
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        archerName(r).toLowerCase().includes(q) ||
        (r.archer?.email ?? '').toLowerCase().includes(q) ||
        archerAid(r).toLowerCase().includes(q)  ||
        schoolName(r).toLowerCase().includes(q) ||
        pldName(r).toLowerCase().includes(q)    ||
        stateCode(r).toLowerCase().includes(q),
      )
    }
    if (filters.stateCode) rows = rows.filter(r => r.archer?.state?.code === filters.stateCode)
    if (filters.pldId)     rows = rows.filter(r => r.archer?.pld?.id     === filters.pldId)
    if (filters.schoolId)  rows = rows.filter(r => r.archer?.school?.id  === filters.schoolId)
    if (filters.ageGroup)  rows = rows.filter(r => ageGroup(r.archer?.age) === filters.ageGroup)
    return rows
  }, [links, search, filters])

  // ── Dynamic filter options ─────────────────────────────────────────────
  const { stateOpts, pldOpts, schoolOpts } = useMemo(() => {
    const stateMap  = new Map<string, string>()
    const pldMap    = new Map<string, string>()
    const schoolMap = new Map<string, string>()
    for (const r of links) {
      if (r.archer?.state)  stateMap.set(r.archer.state.code, r.archer.state.name)
      if (r.archer?.pld)    pldMap.set(r.archer.pld.id, r.archer.pld.name)
      if (r.archer?.school) schoolMap.set(r.archer.school.id, r.archer.school.name)
    }
    return {
      stateOpts:  [{ value: '', label: 'All states'  }, ...[...stateMap.entries()].map(([v,l]) => ({ value: v, label: l }))],
      pldOpts:    [{ value: '', label: 'All PLDs'    }, ...[...pldMap.entries()].map(([v,l])   => ({ value: v, label: l }))],
      schoolOpts: [{ value: '', label: 'All schools' }, ...[...schoolMap.entries()].map(([v,l]) => ({ value: v, label: l }))],
    }
  }, [links])

  // ── Action helpers ────────────────────────────────────────────────────────
  const openApprove = (r: LinkRow) => { setSelectedLink(r); setActionType('approve'); setRejectReason(''); setReasonErr(false) }
  const openReject  = (r: LinkRow) => { setSelectedLink(r); setActionType('reject');  setRejectReason(''); setReasonErr(false) }
  const openUnlink  = (r: LinkRow) => { setSelectedLink(r); setActionType('unlink'); setUnlinkConfirm('') }
  const closeModal  = () => { if (acting) return; setSelectedLink(null); setActionType(null); setRejectReason(''); setUnlinkConfirm('') }

  async function handleAction() {
    if (!selectedLink || !profile?.id) return
    if (actionType === 'reject' && !rejectReason.trim()) { setReasonErr(true); return }
    setActing(true)
    try {
      const now = new Date().toISOString()

      if (actionType === 'approve') {
        const { error } = await supabase.from('coach_archer_links').update({
          status: 'active',
          approved_at: now,
          approved_by: profile.id,
        }).eq('id', selectedLink.id)
        if (error) throw error

        // Update archer's profile coach_id
        await supabase.from('profiles').update({ coach_id: profile.id }).eq('id', selectedLink.archer_id)

        // Approve archer account if still pending
        if (selectedLink.archer?.status === 'pending') {
          await supabase.from('profiles').update({
            status: 'approved', approved_by: profile.id, approved_at: now,
          }).eq('id', selectedLink.archer_id)
        }

        writeAuditLog(profile.id, 'coach.archer_approved', 'coach_archer_link', selectedLink.id, {
          archer_name: archerName(selectedLink), archer_id: archerAid(selectedLink),
        })

        ok(t('coachArchers.approvedToast', { name: archerName(selectedLink) }))

      } else if (actionType === 'reject') {
        const { error } = await supabase.from('coach_archer_links').update({
          status: 'rejected', rejected_at: now, rejection_reason: rejectReason.trim(),
        }).eq('id', selectedLink.id)
        if (error) throw error

        writeAuditLog(profile.id, 'coach.archer_rejected', 'coach_archer_link', selectedLink.id, {
          archer_name: archerName(selectedLink), reason: rejectReason.trim(),
        })

        ok(t('coachArchers.rejectedToast', { name: archerName(selectedLink) }))

      } else if (actionType === 'unlink') {
        const { error } = await supabase.from('coach_archer_links').update({
          status: 'inactive', unlinked_at: now,
        }).eq('id', selectedLink.id)
        if (error) throw error

        // Clear coach_id from profile if it points to this coach
        const archer = selectedLink.archer
        if (archer) {
          await supabase.from('profiles')
            .update({ coach_id: null })
            .eq('id', selectedLink.archer_id)
            .eq('coach_id', profile.id)
        }

        writeAuditLog(profile.id, 'coach.archer_unlinked', 'coach_archer_link', selectedLink.id, {
          archer_name: archerName(selectedLink),
        })

        ok(t('coachArchers.unlinkedToast', { name: archerName(selectedLink) }))
      }

      queryClient.invalidateQueries({ queryKey: ['coach-archers-list'] })
      queryClient.invalidateQueries({ queryKey: ['coach-archers-counts'] })
      closeModal()
    } catch (e: unknown) {
      err((e as Error).message ?? t('common.actionFailed'))
    } finally {
      setActing(false)
    }
  }

  // ── Link new archer ────────────────────────────────────────────────────────
  async function handleFindArcher() {
    await findArcher(archerSearch.trim())
  }

  async function findArcher(q: string) {
    if (!q) { setFindErr(t('coachArchers.enterIdToSearch')); return }
    setFindErr('')
    setFoundArcher(null)
    setSearching(true)
    try {
      // SECURITY DEFINER RPC — finds any archer by ID, across schools
      // (plain profile reads only return archers already linked to this coach).
      const { data, error } = await supabase.rpc('coach_find_archer', { p_code: q })
      const row = Array.isArray(data) ? data[0] : data
      if (error || !row) { setFindErr(t('coachArchers.noArcherFound')); return }
      setFoundArcher({
        id: row.id,
        name: row.name,
        archer_id: row.archer_id ?? undefined,
        age: row.age ?? undefined,
        status: row.status,
        role: 'archer',
        school: row.school_name ? { id: '', name: row.school_name } : undefined,
      } as unknown as ArcherShape)
    } catch {
      setFindErr(t('coachArchers.searchFailed'))
    } finally {
      setSearching(false)
    }
  }

  async function handleLinkArcher() {
    if (!foundArcher || !profile?.id) return
    setLinking(true)
    try {
      // SECURITY DEFINER RPC — creates/reactivates the link (cross-school OK)
      // and audit-logs server-side.
      const { data: linkStatus, error } = await supabase.rpc('coach_link_archer', {
        p_archer: foundArcher.id,
      })
      if (error) throw error

      ok(linkStatus === 'active'
        ? t('coachArchers.linkedActive', { name: foundArcher.name })
        : t('coachArchers.linkRequested', { name: foundArcher.name }))

      setFoundArcher(null)
      setArcherSearch('')
      setShowLinkPanel(false)
      queryClient.invalidateQueries({ queryKey: ['coach-archers-list'] })
      queryClient.invalidateQueries({ queryKey: ['coach-archers-counts'] })
    } catch (e: unknown) {
      err((e as Error).message ?? t('coachArchers.linkFailed'))
    } finally {
      setLinking(false)
    }
  }

  // School-code registrations fold into the Pending (and All) views + counts,
  // so the coach has a single queue of everything awaiting approval.
  // An archer who ALREADY has a link row (e.g. admin linked them, or the coach
  // linked them by ID while their account is still pending) is shown by the
  // links table — drop them here so they don't appear twice.
  const linkedArcherIds = linkSummary?.linkedArcherIds
  const schoolRegsData = (schoolRegsQ.data ?? []).filter(a => !linkedArcherIds?.has(a.id))
  const schoolRegCount = schoolRegsData.length
  const onPendingOrAll = tab === 'pending' || tab === 'all'
  const schoolRegs: PendingSchoolArcher[] = (() => {
    if (!onPendingOrAll) return []
    const q = search.trim().toLowerCase()
    if (!q) return schoolRegsData
    return schoolRegsData.filter(a =>
      (a.name ?? '').toLowerCase().includes(q) ||
      (a.email ?? '').toLowerCase().includes(q) ||
      (a.archer_id ?? '').toLowerCase().includes(q),
    )
  })()

  const combinedPending = (counts?.pending ?? 0) + schoolRegCount
  const combinedTotal   = (counts?.all ?? 0) + schoolRegCount
  const pendingCount = combinedPending

  // ─── RENDER ──────────────────────────────────────────────────────────────

  return (
    <PageWrapper>
      <PageHead
        title={t('coachArchers.title')}
        description={t('coachArchers.description')}
        pill={
          pendingCount > 0 ? (
            <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] bg-danger text-white text-[11px] font-bold rounded-full px-1.5">
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          ) : undefined
        }
        action={
          <Button variant="primary" onClick={() => setShowLinkPanel(v => !v)}>
            {showLinkPanel ? t('common.cancel') : `+ ${t('coachArchers.linkArcher')}`}
          </Button>
        }
      />

      <CoachSchoolCode />

      {/* Stats — clickable, they drive the tab below */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label={t('common.total')}    value={combinedTotal} clickable active={tab === 'all'} onClick={() => setTab('all')} />
        <StatCard label={t('status.pending')}  value={combinedPending} badge={combinedPending} clickable active={tab === 'pending'} onClick={() => setTab('pending')} />
        <StatCard label={t('status.active')}   value={counts?.active ?? 0} accent={(counts?.active ?? 0) > 0} clickable active={tab === 'active'} onClick={() => setTab('active')} />
        <StatCard label={t('status.inactive')} value={counts?.inactive ?? 0} clickable active={tab === 'inactive'} onClick={() => setTab('inactive')} />
      </div>

      {/* Link New Archer panel */}
      {showLinkPanel && (
        <SectionCard title={t('coachArchers.linkNewArcher')} className="mb-6">
          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <Input
              wrapperClassName="flex-1"
              placeholder={t('coachArchers.enterIdPlaceholder')}
              value={archerSearch}
              onChange={e => { setArcherSearch(e.target.value); setFindErr(''); setFoundArcher(null) }}
              error={findErr || undefined}
              onKeyDown={e => { if (e.key === 'Enter') handleFindArcher() }}
            />
            <Button variant="secondary" onClick={handleFindArcher} disabled={searching}>
              {searching ? t('common.loading') : t('coachArchers.findArcher')}
            </Button>
            <Button variant="outline" onClick={() => setShowQrModal(true)}>
              {t('coachArchers.scanQr')}
            </Button>
          </div>

          {foundArcher && (
            <div className="flex items-center justify-between gap-4 p-4 rounded-[var(--r-md)] bg-surface-raised border border-line">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={foundArcher.name} />
                <div className="min-w-0">
                  <p className="font-semibold text-text">{foundArcher.name}</p>
                  <p className="text-xs text-text-dim">{foundArcher.archer_id} · {t('common.age')} {foundArcher.age ?? '?'}</p>
                  <p className="text-xs text-text-dim">{(foundArcher.school as unknown as { name?: string } | undefined)?.name ?? '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <AccountStatusBadge status={foundArcher.status} />
                <Button variant="primary" size="sm" onClick={handleLinkArcher} disabled={linking}>
                  {linking ? t('common.processing') : t('coachArchers.linkArcher')}
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-line mb-5 overflow-x-auto scrollbar-none">
        {TABS.map(tabDef => {
          const cnt = tabDef.key === 'pending' ? combinedPending :
                      tabDef.key === 'active'  ? (counts?.active  ?? 0) :
                      tabDef.key === 'inactive'? (counts?.inactive ?? 0) :
                      combinedTotal
          return (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors',
                tab === tabDef.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-dim hover:text-text',
              )}
            >
              {t(tabDef.labelKey)}
              {cnt > 0 && (
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[18px] h-[18px] text-[10px] font-bold rounded-full px-1',
                  tabDef.key === 'pending'
                    ? 'bg-danger text-white'
                    : 'bg-surface-raised text-text-dim',
                )}>
                  {cnt > 99 ? '99+' : cnt}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search + filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <Input
          wrapperClassName="flex-1"
          placeholder={t('coachArchers.searchPlaceholder')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Button variant={filtersOpen ? 'primary' : 'secondary'} onClick={() => setFiltersOpen(v => !v)}>
          {t('common.filters')} {activeFilterCount > 0 && `(${activeFilterCount})`}
        </Button>
        {activeFilterCount > 0 && (
          <Button variant="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>{t('common.clear')}</Button>
        )}
      </div>

      {filtersOpen && (
        <div className="card p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Select label={t('common.state')}     value={filters.stateCode} onChange={e => setFilter('stateCode', e.target.value)} options={stateOpts} />
          <Select label={t('common.pld')}       value={filters.pldId}     onChange={e => setFilter('pldId',     e.target.value)} options={pldOpts} />
          <Select label={t('common.school')}    value={filters.schoolId}  onChange={e => setFilter('schoolId',  e.target.value)} options={schoolOpts} />
          <Select label={t('common.ageGroup')} value={filters.ageGroup}  onChange={e => setFilter('ageGroup',  e.target.value)} options={AGE_GROUPS.map(g => ({ value: g.value, label: t(g.labelKey) }))} />
        </div>
      )}

      {/* School-code registration load error (surfaced, not swallowed) */}
      {onPendingOrAll && schoolRegsQ.isError && (
        <p className="text-sm text-danger mb-3">
          {t('coachArchers.schoolRegLoadError')}
        </p>
      )}

      {/* Result count */}
      {!isLoading && !isError && (
        <p className="text-xs text-text-faint mb-3">
          {t('common.showing', { shown: filtered.length + schoolRegs.length, total: links.length + (onPendingOrAll ? schoolRegCount : 0) })}
        </p>
      )}

      {/* School-code registrations — folded into the Pending / All queue.
          These archers self-registered with the coach's school code and have no
          link row yet; approving activates the account and creates the link. */}
      {!isLoading && !isError && schoolRegs.length > 0 && (
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            {t('coachArchers.schoolRegQueueTitle')}
            <HelpTip
              title={t('helpTips.coachApproval.title')}
              what={t('helpTips.coachApproval.what')}
              who={t('helpTips.coachApproval.who')}
              reversible={t('helpTips.coachApproval.reversible')}
              warning={t('helpTips.coachApproval.warning')}
            />
          </div>
          {schoolRegs.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-[var(--r-md)] border border-line bg-surface p-3">
              <Avatar name={a.name || a.email} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-text truncate">{a.name || '—'}</span>
                  <Badge variant="warning" dot>{t('coachArchers.schoolCodeBadge')}</Badge>
                </div>
                <div className="text-xs text-text-faint truncate">
                  {a.email}{a.archer_id ? ` · ${a.archer_id}` : ''} · {timeAgo(a.created_at)}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="success"
                  size="sm"
                  onClick={() => handleApproveSchoolReg(a.id)}
                  disabled={approvingRegId === a.id || regRejectBusy}
                >
                  {approvingRegId === a.id ? t('common.approving') : t('common.approve')}
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => openRejectReg(a)}
                  disabled={approvingRegId === a.id || regRejectBusy}
                >
                  {t('common.reject')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject school-code registration — reason required, scoped RPC */}
      <Modal
        open={!!rejectingReg}
        onClose={closeRejectReg}
        title={t('coachArchers.rejectRegTitle')}
        width="min(440px,100%)"
      >
        {rejectingReg && (
          <div className="space-y-4">
            <p className="text-sm text-text-dim leading-relaxed">
              {t('coachArchers.rejectRegExplain', { name: rejectingReg.name || rejectingReg.email })}
            </p>
            <Textarea
              label={t('approvals.rejectionReasonLabel')}
              placeholder={t('coachArchers.rejectRegPlaceholder')}
              value={regRejectReason}
              onChange={(e) => { setRegRejectReason(e.target.value); setRegRejectErr(false) }}
              minRows={3}
              error={regRejectErr ? t('approvals.rejectionReasonRequired') : undefined}
            />
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="ghost" size="sm" onClick={closeRejectReg} disabled={regRejectBusy}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" size="sm" loading={regRejectBusy} onClick={handleRejectSchoolReg}>
                {t('common.reject')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 rounded-[var(--r-md)] bg-surface-raised animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <p className="text-sm text-danger text-center py-10">{t('common.loadFailed')}</p>
      )}

      {/* Empty — only when neither links nor school registrations have anything */}
      {!isLoading && !isError && filtered.length === 0 && schoolRegs.length === 0 && (
        <EmptyState
          icon={<PeopleIcon />}
          title={tab === 'pending' ? t('coachArchers.nothingToApprove') : t('coachArchers.noArchersFound')}
          description={
            tab === 'pending'
              ? t('coachArchers.noneAwaiting')
              : search || activeFilterCount > 0
                ? t('common.noResultsFilters')
                : t('coachArchers.noneInCategory')
          }
        />
      )}

      {/* Desktop table */}
      {!isLoading && !isError && filtered.length > 0 && (
        <>
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  {[t('roles.archer'), 'ID', t('common.age'), `${t('common.school')} / ${t('common.pld')}`, t('common.state'), t('common.status'), t('common.linked'), t('common.actions')].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint pb-2 pr-3 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filtered.map(r => (
                  <ArcherTableRow
                    key={r.id}
                    row={r}
                    onView={() => navigate(`/coach/archers/${r.archer_id}`)}
                    onApprove={openApprove}
                    onReject={openReject}
                    onUnlink={openUnlink}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map(r => (
              <ArcherCard
                key={r.id}
                row={r}
                onView={() => navigate(`/coach/archers/${r.archer_id}`)}
                onApprove={openApprove}
                onReject={openReject}
                onUnlink={openUnlink}
              />
            ))}
          </div>
        </>
      )}

      {/* Approve modal */}
      <Modal open={actionType === 'approve'} onClose={closeModal} title={t('coachArchers.approveTitle')} width="min(440px,100%)">
        {selectedLink && (
          <>
            <div className="flex items-center gap-3 p-3 bg-surface-raised rounded-[var(--r-md)] mb-5">
              <Avatar name={archerName(selectedLink)} />
              <div>
                <p className="font-semibold">{archerName(selectedLink)}</p>
                <p className="text-xs text-text-dim">{archerAid(selectedLink)} · {schoolName(selectedLink)}</p>
              </div>
            </div>
            <p className="text-sm text-text-dim mb-5">
              {selectedLink.archer?.status === 'pending'
                ? t('coachArchers.approveBodyActivate')
                : t('coachArchers.approveBody')}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={closeModal} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="success" onClick={handleAction} disabled={acting}>
                {acting ? t('common.approving') : t('common.approve')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Reject modal */}
      <Modal open={actionType === 'reject'} onClose={closeModal} title={t('coachArchers.rejectTitle')} width="min(440px,100%)">
        {selectedLink && (
          <>
            <p className="text-sm text-text-dim mb-4">
              {t('coachArchers.rejectBody', { name: archerName(selectedLink) })}
            </p>
            <Textarea
              label={`${t('common.reason')} *`}
              value={rejectReason}
              onChange={e => { setRejectReason(e.target.value); setReasonErr(false) }}
              error={reasonErr ? t('coachArchers.reasonRequired') : undefined}
              placeholder={t('coachArchers.rejectPlaceholder')}
              minRows={3}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={closeModal} disabled={acting}>{t('common.cancel')}</Button>
              <Button variant="danger" onClick={handleAction} disabled={acting}>
                {acting ? t('common.rejecting') : t('common.reject')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Unlink confirm modal */}
      <Modal open={actionType === 'unlink'} onClose={closeModal} title={t('coachArchers.unlinkTitle')} width="min(400px,100%)">
        {selectedLink && (
          <>
            <p className="text-sm text-text-dim mb-4">
              {t('coachArchers.unlinkBody', { name: archerName(selectedLink) })}
            </p>
            <Input
              label={t('coachArchers.typeNameConfirm')}
              placeholder={archerName(selectedLink)}
              value={unlinkConfirm}
              onChange={e => setUnlinkConfirm(e.target.value)}
              hint={t('coachArchers.notCaseSensitive')}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={closeModal} disabled={acting}>{t('common.cancel')}</Button>
              <Button
                variant="danger"
                onClick={handleAction}
                disabled={acting || normalizeName(unlinkConfirm) !== normalizeName(archerName(selectedLink))}
              >
                {acting ? t('common.processing') : t('coachArchers.unlink')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      {/* Camera QR scanner — decodes the archer's profile QR and runs the search */}
      <QrScannerModal
        open={showQrModal}
        onClose={() => setShowQrModal(false)}
        onScan={(code) => {
          setShowQrModal(false)
          setShowLinkPanel(true)
          setArcherSearch(code)
          setFoundArcher(null)
          findArcher(code)
        }}
      />
    </PageWrapper>
  )
}

// ─── SUB-COMPONENTS ──────────────────────────────────────────────────────────

function ArcherTableRow({
  row, onView, onApprove, onReject, onUnlink,
}: {
  row: LinkRow
  onView: () => void
  onApprove: (r: LinkRow) => void
  onReject:  (r: LinkRow) => void
  onUnlink:  (r: LinkRow) => void
}) {
  const { t } = useLanguage()
  return (
    <tr className="hover:bg-surface-raised/40 transition-colors">
      <td className="py-3 pr-3">
        <div className="flex items-center gap-2.5">
          <Avatar name={archerName(row)} size="sm" />
          <div>
            <p className="font-medium text-text">{archerName(row)}</p>
            <p className="text-[11px] text-text-faint">{row.archer?.email ?? '—'}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">{archerAid(row)}</td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">{row.archer?.age ?? '—'}</td>
      <td className="py-3 pr-3 text-xs text-text-dim">
        <p>{schoolName(row)}</p>
        <p className="text-text-faint">{pldName(row)}</p>
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">{stateCode(row)}</td>
      <td className="py-3 pr-3 whitespace-nowrap">
        <AccountStatusBadge status={row.archer?.status ?? 'pending'} />
      </td>
      <td className="py-3 pr-3 text-xs text-text-dim whitespace-nowrap">
        {formatDate(row.created_at)}
      </td>
      <td className="py-3 whitespace-nowrap">
        <div className="flex items-center gap-1">
          {row.status === 'active' && (
            <Button variant="ghost" size="sm" onClick={onView}>{t('common.view')}</Button>
          )}
          {/* Coach-initiated request → the ARCHER must approve it (migration 082),
              so the coach only waits. Archer-initiated (school code) → coach acts. */}
          {row.status === 'pending' && row.initiated_by === 'coach' ? (
            <span className="text-xs text-text-faint italic">{t('coachArchers.awaitingArcher')}</span>
          ) : row.status === 'pending' && (
            <>
              <Button variant="ghost" size="sm" onClick={() => onApprove(row)} className="text-success hover:text-success">{t('common.approve')}</Button>
              <Button variant="ghost" size="sm" onClick={() => onReject(row)}  className="text-danger hover:text-danger">{t('common.reject')}</Button>
            </>
          )}
          {/* Link already active but the ACCOUNT is still pending (e.g. linked by
              admin or by archer ID before approval) — offer account approval. */}
          {row.status === 'active' && row.archer?.status === 'pending' && (
            <Button variant="ghost" size="sm" onClick={() => onApprove(row)} className="text-success hover:text-success">{t('common.approve')}</Button>
          )}
          {row.status === 'active' && (
            <Button variant="ghost" size="sm" onClick={() => onUnlink(row)} className="text-danger hover:text-danger">{t('coachArchers.unlink')}</Button>
          )}
          {(row.status === 'inactive' || row.status === 'rejected') && (
            <span className="text-xs text-text-faint italic">{t('status.inactive')}</span>
          )}
        </div>
      </td>
    </tr>
  )
}

function ArcherCard({
  row, onView, onApprove, onReject, onUnlink,
}: {
  row: LinkRow
  onView: () => void
  onApprove: (r: LinkRow) => void
  onReject:  (r: LinkRow) => void
  onUnlink:  (r: LinkRow) => void
}) {
  const { t } = useLanguage()
  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar name={archerName(row)} />
          <div className="min-w-0">
            <p className="font-semibold text-text truncate">{archerName(row)}</p>
            <p className="text-xs text-text-faint">{row.archer?.email ?? '—'}</p>
            <p className="text-xs text-text-dim">{archerAid(row)}</p>
          </div>
        </div>
        <AccountStatusBadge status={row.archer?.status ?? 'pending'} />
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-dim">
        <span>{t('common.age')}: <strong className="text-text">{row.archer?.age ?? '—'}</strong></span>
        <span>{t('common.state')}: <strong className="text-text">{stateCode(row)}</strong></span>
        <span className="col-span-2">{t('common.school')}: <strong className="text-text">{schoolName(row)}</strong></span>
        <span>{t('common.linked')}: <strong className="text-text">{formatDate(row.created_at)}</strong></span>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {row.status === 'active' && <Button variant="outline" size="sm" onClick={onView}>{t('coachArchers.viewProfile')}</Button>}
        {row.status === 'pending' && (
          <>
            <Button variant="success" size="sm" onClick={() => onApprove(row)}>{t('common.approve')}</Button>
            <Button variant="danger"  size="sm" onClick={() => onReject(row)}>{t('common.reject')}</Button>
          </>
        )}
        {row.status === 'active' && row.archer?.status === 'pending' && (
          <Button variant="success" size="sm" onClick={() => onApprove(row)}>{t('common.approve')}</Button>
        )}
        {row.status === 'active' && (
          <Button variant="ghost" size="sm" onClick={() => onUnlink(row)} className="text-danger hover:text-danger">{t('coachArchers.unlink')}</Button>
        )}
      </div>
    </div>
  )
}

// ─── ICONS ────────────────────────────────────────────────────────────────────

function PeopleIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.4"/><path d="M3.5 20a6 6 0 0 1 11 0"/>
      <circle cx="17.5" cy="9" r="2.6"/><path d="M16 14.5a5 5 0 0 1 4.5 5"/>
    </svg>
  )
}



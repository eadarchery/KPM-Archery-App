import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import {
  Button,
  Input,
  Textarea,
  Modal,
  Select,
  EmptyState,
  useToast,
  StatCard,
  Avatar,
  Badge,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import { useHasPermission } from '@/hooks/useRolePermissions'
import { isOperationalAdmin } from '@/lib/permissions'
import { compressImage, compressPresets } from '@/lib/imageCompress'
import { supabase } from '@/services/supabase'
import { fetchOrgMaps } from '@/services/orgLookup'
import { writeAuditLog } from '@/services/auditLog'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { SubmissionStatus } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

const NONE_ID = '00000000-0000-0000-0000-000000000000'

type CoachScoreTab = 'submit' | 'validate' | 'pending' | 'approved' | 'rejected' | 'all'

interface ArcherOption {
  id: string
  name: string
  archer_id?: string
  bow_category?: string
  age?: number
  school?: { name: string }
  state?: { code: string }
}

interface RoundOption {
  id: string
  name: string
  max_score: number
  total_arrows: number
  bow_categories?: string[]
  arrows_per_end?: number | null
  ends?: number | null
  distance_m?: number | null
}

interface SubmissionRow {
  id: string
  archer_id: string
  coach_id: string
  round_id: string
  date: string
  total_score: number
  max_score: number
  bow_category?: string
  age_group?: string
  venue?: string
  notes?: string
  status: SubmissionStatus
  proof_url?: string
  rejection_reason?: string
  created_at: string
  archer: ArcherOption | null
  round: RoundOption | null
}

interface SubmitFormState {
  archerId: string
  roundId: string
  bowCategory: string
  ageGroup: string
  totalScore: string
  maxScore: string
  totalArrows: string
  date: string
  venue: string
  notes: string
}

interface ScoreFilters {
  archerId: string
  stateCode: string
  bowCategory: string
  ageGroup: string
  dateFrom: string
  dateTo: string
}

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TABS: { key: CoachScoreTab; labelKey: string }[] = [
  { key: 'submit',   labelKey: 'coachScores.tabSubmit' },
  { key: 'validate', labelKey: 'coachScores.tabValidate' },
  { key: 'pending',  labelKey: 'status.pending' },
  { key: 'approved', labelKey: 'status.approved' },
  { key: 'rejected', labelKey: 'status.rejected' },
  { key: 'all',      labelKey: 'common.all' },
]

// validate = archer-submitted, awaiting THIS coach's validation
// coach_approved = coach-validated, awaiting admin2 validation
const STATUS_FOR_TAB: Record<CoachScoreTab, SubmissionStatus | null> = {
  submit:   null,
  validate: 'pending',
  pending:  'coach_approved',
  approved: 'admin_approved',
  rejected: 'rejected',
  all:      null,
}

const BOW_CATEGORIES = [
  { value: '',             labelKey: 'coachScores.selectBow' },
  { value: 'recurve',      labelKey: 'bows.recurve' },
  { value: 'compound',     labelKey: 'bows.compound' },
  { value: 'barebow',      labelKey: 'bows.barebow' },
  { value: 'longbow',      labelKey: 'bows.longbow' },
  { value: 'traditional',  labelKey: 'bows.traditional' },
]

const AGE_GROUPS = [
  { value: '',     labelKey: 'coachScores.selectAge' },
  { value: 'u14',  labelKey: 'coachArchers.u14' },
  { value: 'u18',  labelKey: 'coachArchers.u18' },
  { value: 'u21',  labelKey: 'coachArchers.u21' },
  { value: 'open', labelKey: 'leaderboardPage.open22' },
]

const BOW_FILTER_OPTS = [
  { value: '',             labelKey: 'common.allCategories' },
  { value: 'recurve',      labelKey: 'bows.recurve' },
  { value: 'compound',     labelKey: 'bows.compound' },
  { value: 'barebow',      labelKey: 'bows.barebow' },
  { value: 'longbow',      labelKey: 'bows.longbow' },
  { value: 'traditional',  labelKey: 'bows.traditional' },
]

const AGE_FILTER_OPTS = [
  { value: '',     labelKey: 'common.allAges' },
  { value: 'u14',  labelKey: 'coachArchers.u14' },
  { value: 'u18',  labelKey: 'coachArchers.u18' },
  { value: 'u21',  labelKey: 'coachArchers.u21' },
  { value: 'open', labelKey: 'leaderboardPage.open22' },
]

const ACCEPT_TYPES = '.png,.jpg,.jpeg,.pdf'

const EMPTY_FORM: SubmitFormState = {
  archerId: '', roundId: '', bowCategory: '', ageGroup: '',
  totalScore: '', maxScore: '', totalArrows: '',
  date: new Date().toISOString().split('T')[0],
  venue: '', notes: '',
}

const DEFAULT_FILTERS: ScoreFilters = {
  archerId: '', stateCode: '', bowCategory: '', ageGroup: '', dateFrom: '', dateTo: '',
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function bowLabel(val?: string) {
  if (!val) return '—'
  return val.charAt(0).toUpperCase() + val.slice(1)
}

function ageLabel(val?: string) {
  const map: Record<string, string> = { u14: 'U14', u18: 'U18', u21: 'U21', open: 'Open' }
  return val ? (map[val] ?? val) : '—'
}

async function resolveProofUrl(proof_url: string): Promise<string | null> {
  if (proof_url.startsWith('http')) return proof_url
  const { data } = await supabase.storage.from('proof-photos').createSignedUrl(proof_url, 3600)
  return data?.signedUrl ?? null
}

/** proof_url may hold multiple photos joined by '|' — resolve each. */
async function resolveProofUrls(proof_url: string): Promise<string[]> {
  const paths = proof_url.split('|').filter(Boolean)
  const urls: string[] = []
  for (const p of paths) {
    const u = await resolveProofUrl(p)
    if (u) urls.push(u)
  }
  return urls
}

/** Upload one or more proof files; returns the paths joined by '|'. */
async function uploadProofs(files: File[], coachId: string, archerId: string): Promise<string> {
  const paths: string[] = []
  for (const f of files) {
    // Photos are auto-compressed; PDFs pass through unchanged.
    const upload = await compressImage(f, compressPresets.proofPhoto)
    const filePath = `${coachId}/${archerId}/${Date.now()}-${paths.length}-${safeName(upload.name)}`
    const { data, error } = await supabase.storage.from('proof-photos').upload(filePath, upload)
    if (error) throw error
    paths.push(data.path)
  }
  return paths.join('|')
}

function isPdf(proof_url: string) {
  return proof_url.toLowerCase().endsWith('.pdf') || proof_url.toLowerCase().includes('.pdf')
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function CoachScoreBadge({ status }: { status: string }) {
  const { t } = useLanguage()
  const cfg: Record<string, { labelKey: string; variant: 'success' | 'warning' | 'danger' | 'primary' | 'neutral' }> = {
    pending:        { labelKey: 'coachScores.awaitingCoach', variant: 'warning' },
    coach_approved: { labelKey: 'archerProfile.submitted',   variant: 'primary' },
    admin_approved: { labelKey: 'status.approved',           variant: 'success' },
    rejected:       { labelKey: 'status.rejected',           variant: 'danger'  },
    withdrawn:      { labelKey: 'status.withdrawn',          variant: 'neutral' },
  }
  const s = cfg[status]
  return <Badge variant={s?.variant ?? 'neutral'}>{s ? t(s.labelKey) : status}</Badge>
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function CoachScores() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()

  // ── System-rule + permission gates (RLS is still the real guard) ──────────
  const role = profile?.role
  const moduleEnabled      = useRuleValue<boolean>('module_scores_enabled', true)
  const coachSubmitRule    = useRuleValue<boolean>('coaches_can_submit_scores_for_archers', true)
  const canSubmitForArcher = useHasPermission(role, 'submit_score_for_archer', true) && coachSubmitRule
  const canResubmit        = useRuleValue<boolean>('rejected_scores_can_be_resubmitted', true)

  const [tab, setTab] = useState<CoachScoreTab>('submit')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<ScoreFilters>(DEFAULT_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Submit form
  const [form, setForm] = useState<SubmitFormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof SubmitFormState | 'proof', string>>>({})
  const [proofFiles, setProofFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Modals
  type ActionType = 'proof' | 'withdraw' | 'resubmit' | 'validate' | 'reject' | null
  const [selectedRow, setSelectedRow] = useState<SubmissionRow | null>(null)
  const [actionType, setActionType] = useState<ActionType>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [validating, setValidating] = useState(false)
  const [proofUrls, setProofUrls] = useState<string[]>([])
  const [proofLoading, setProofLoading] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  // Resubmit form
  const [resubForm, setResubForm] = useState<SubmitFormState>(EMPTY_FORM)
  const [resubErrors, setResubErrors] = useState<Partial<Record<keyof SubmitFormState | 'proof', string>>>({})
  const [resubFiles, setResubFiles] = useState<File[]>([])
  const resubFileRef = useRef<HTMLInputElement>(null)
  const [resubmitting, setResubmitting] = useState(false)

  const setF = useCallback((k: keyof SubmitFormState, v: string) =>
    setForm(f => ({ ...f, [k]: v })), [])

  const urlArcherId = searchParams.get('archerId')

  // ── Linked active archers ─────────────────────────────────────────────────
  const { data: linkedArchers = [] } = useQuery<ArcherOption[]>({
    queryKey: ['coach-linked-archers-submit', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from('coach_archer_links')
        .select('archer_id')
        .eq('coach_id', profile!.id)
        .eq('status', 'active')
      if (error) throw error
      const ids = [...new Set((links ?? []).map((l: { archer_id: string }) => l.archer_id))]
      if (!ids.length) return []
      const [pRes, maps] = await Promise.all([
        supabase.from('profiles').select('id, name, archer_id, age, bow_category, school_id, state_id').in('id', ids),
        fetchOrgMaps(),
      ])
      return ((pRes.data ?? []) as Record<string, unknown>[]).map((p) => ({
        id: p.id as string,
        name: p.name as string,
        archer_id: (p.archer_id as string) ?? undefined,
        age: (p.age as number) ?? undefined,
        bow_category: (p.bow_category as string) ?? undefined,
        school: p.school_id ? { name: maps.schools.get(p.school_id as string)?.name ?? '' } : undefined,
        state:  p.state_id  ? { code: maps.states.get(p.state_id as string)?.code ?? '' } : undefined,
      })) as ArcherOption[]
    },
    staleTime: 60_000,
  })

  // ── Rounds ────────────────────────────────────────────────────────────────
  const { data: rounds = [] } = useQuery<RoundOption[]>({
    queryKey: ['rounds-active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rounds')
        .select('*')
        .eq('active', true)
        .order('name')
      if (error) throw error
      return (data ?? []) as RoundOption[]
    },
    staleTime: 300_000,
  })

  // ── Score submissions ─────────────────────────────────────────────────────
  const { data: scores = [], isLoading, isError } = useQuery<SubmissionRow[]>({
    queryKey: ['coach-scores', profile?.id, tab, filters.dateFrom, filters.dateTo],
    enabled: !!profile?.id && tab !== 'submit',
    queryFn: async () => {
      let q = supabase
        .from('score_submissions')
        .select(`
          id, archer_id, coach_id, round_id, date,
          total_score, max_score, bow_category, age_group, venue, notes,
          status, proof_url, rejection_reason, created_at
        `)
        .order('created_at', { ascending: false })

      const statusFilter = STATUS_FOR_TAB[tab]
      if (tab === 'validate') {
        // The validation queue is LINK-based: every actively-linked archer's
        // pending score, even ones submitted before the link existed
        // (those carry no coach_id stamp yet).
        const { data: links } = await supabase
          .from('coach_archer_links')
          .select('archer_id')
          .eq('coach_id', profile!.id)
          .eq('status', 'active')
        const ids = [...new Set((links ?? []).map((l: { archer_id: string }) => l.archer_id))]
        if (!ids.length) return []
        q = q.in('archer_id', ids).eq('status', 'pending')
      } else {
        q = q.eq('coach_id', profile!.id)
        if (statusFilter) q = q.eq('status', statusFilter)
      }
      if (filters.dateFrom) q = q.gte('date', filters.dateFrom)
      if (filters.dateTo)   q = q.lte('date', filters.dateTo)

      const { data, error } = await q
      if (error) throw error
      const rows = (data ?? []) as Record<string, unknown>[]
      if (!rows.length) return []

      // Resolve archer + round + org names separately (embedding fails).
      const archerIds = [...new Set(rows.map((r) => r.archer_id as string).filter(Boolean))]
      const roundIds  = [...new Set(rows.map((r) => r.round_id as string).filter(Boolean))]
      const [pRes, rRes, maps] = await Promise.all([
        supabase.from('profiles').select('id, name, archer_id, age, bow_category, school_id, state_id').in('id', archerIds.length ? archerIds : [NONE_ID]),
        supabase.from('rounds').select('id, name, max_score, total_arrows, bow_categories').in('id', roundIds.length ? roundIds : [NONE_ID]),
        fetchOrgMaps(),
      ])
      const amap = new Map(((pRes.data ?? []) as Record<string, unknown>[]).map((p) => [p.id as string, {
        id: p.id as string,
        name: p.name as string,
        archer_id: (p.archer_id as string) ?? undefined,
        age: (p.age as number) ?? undefined,
        bow_category: (p.bow_category as string) ?? undefined,
        school: p.school_id ? { name: maps.schools.get(p.school_id as string)?.name ?? '' } : undefined,
        state:  p.state_id  ? { code: maps.states.get(p.state_id as string)?.code ?? '' } : undefined,
      }]))
      const rmap = new Map(((rRes.data ?? []) as { id: string }[]).map((r) => [r.id, r]))
      return rows.map((r) => ({
        ...r,
        archer: amap.get(r.archer_id as string) ?? null,
        round:  rmap.get(r.round_id as string) ?? null,
      })) as unknown as SubmissionRow[]
    },
    staleTime: 30_000,
  })

  // ── Counts ────────────────────────────────────────────────────────────────
  const { data: counts } = useQuery({
    queryKey: ['coach-scores-counts', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const id = profile!.id
      // To-Validate counts by LINK (matches the queue), the rest by coach stamp.
      const { data: links } = await supabase
        .from('coach_archer_links')
        .select('archer_id')
        .eq('coach_id', id)
        .eq('status', 'active')
      const linkedIds = [...new Set((links ?? []).map((l: { archer_id: string }) => l.archer_id))]
      const [{ count: toValidate }, { count: pending }, { count: approved }, { count: rejected }, { count: total }] =
        await Promise.all([
          linkedIds.length
            ? supabase.from('score_submissions').select('id', { count: 'exact', head: true }).in('archer_id', linkedIds).eq('status', 'pending')
            : Promise.resolve({ count: 0 }),
          supabase.from('score_submissions').select('id', { count: 'exact', head: true }).eq('coach_id', id).eq('status', 'coach_approved'),
          supabase.from('score_submissions').select('id', { count: 'exact', head: true }).eq('coach_id', id).eq('status', 'admin_approved'),
          supabase.from('score_submissions').select('id', { count: 'exact', head: true }).eq('coach_id', id).eq('status', 'rejected'),
          supabase.from('score_submissions').select('id', { count: 'exact', head: true }).eq('coach_id', id),
        ])
      return { toValidate: toValidate ?? 0, pending: pending ?? 0, approved: approved ?? 0, rejected: rejected ?? 0, total: total ?? 0 }
    },
    staleTime: 30_000,
  })

  // ── Best approved score ───────────────────────────────────────────────────
  const { data: bestScore } = useQuery<{ total_score: number; max_score: number } | null>({
    queryKey: ['coach-best-score', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('score_submissions')
        .select('total_score, max_score')
        .eq('coach_id', profile!.id)
        .eq('status', 'admin_approved')
        .order('total_score', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data as { total_score: number; max_score: number } | null
    },
    staleTime: 60_000,
  })

  // ── This month count ──────────────────────────────────────────────────────
  const { data: thisMonth = 0 } = useQuery<number>({
    queryKey: ['coach-scores-this-month', profile?.id],
    enabled: !!profile?.id,
    queryFn: async () => {
      const start = new Date()
      start.setDate(1); start.setHours(0, 0, 0, 0)
      const { count } = await supabase
        .from('score_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('coach_id', profile!.id)
        .gte('created_at', start.toISOString())
      return count ?? 0
    },
    staleTime: 60_000,
  })

  // ── Pre-select archer from URL param ─────────────────────────────────────
  useEffect(() => {
    if (!urlArcherId || !linkedArchers.length) return
    const match = linkedArchers.find(a => a.id === urlArcherId)
    if (match) {
      if (canSubmitForArcher) setTab('submit')
      setF('archerId', match.id)
      if (match.bow_category) setF('bowCategory', match.bow_category)
    } else {
      err(t('coachScores.notLinked'), t('coachScores.notLinkedHint'))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlArcherId, linkedArchers.length])

  // If coach submission is turned off, never sit on the Submit tab.
  useEffect(() => {
    if (!canSubmitForArcher && tab === 'submit') setTab('pending')
  }, [canSubmitForArcher, tab])

  // ── Auto-fill max score / total arrows from round ─────────────────────────
  useEffect(() => {
    if (!form.roundId) return
    const round = rounds.find(r => r.id === form.roundId)
    if (!round) return
    setForm(f => ({ ...f, maxScore: String(round.max_score), totalArrows: String(round.total_arrows) }))
  }, [form.roundId, rounds])

  // ── Client-side filter ────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let rows = scores
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(r =>
        (r.archer?.name ?? '').toLowerCase().includes(q) ||
        (r.archer?.archer_id ?? '').toLowerCase().includes(q) ||
        (r.archer?.school?.name ?? '').toLowerCase().includes(q) ||
        (r.round?.name ?? '').toLowerCase().includes(q) ||
        String(r.total_score).includes(q) ||
        r.status.includes(q),
      )
    }
    if (filters.archerId)    rows = rows.filter(r => r.archer_id === filters.archerId)
    if (filters.stateCode)   rows = rows.filter(r => r.archer?.state?.code === filters.stateCode)
    if (filters.bowCategory) rows = rows.filter(r => r.bow_category === filters.bowCategory)
    if (filters.ageGroup)    rows = rows.filter(r => r.age_group === filters.ageGroup)
    return rows
  }, [scores, search, filters])

  const stateOpts = useMemo(() => {
    const codes = new Set(scores.map(r => r.archer?.state?.code).filter(Boolean) as string[])
    return [{ value: '', label: t('common.allStates') }, ...[...codes].map(c => ({ value: c, label: c }))]
  }, [scores, t])

  const archerFilterOpts = useMemo(() => [
    { value: '', label: t('coachScores.allArchers') },
    ...linkedArchers.map(a => ({
      value: a.id,
      label: `${a.name}${a.archer_id ? ` (${a.archer_id})` : ''}`,
    })),
  ], [linkedArchers, t])

  // ── Form validation ───────────────────────────────────────────────────────
  function validate(f: SubmitFormState, files: File[]) {
    const errs: Partial<Record<keyof SubmitFormState | 'proof', string>> = {}
    if (!f.archerId)    errs.archerId    = t('coachScores.errStudent')
    if (!f.roundId)     errs.roundId     = t('coachScores.errRound')
    if (!f.bowCategory) errs.bowCategory = t('coachScores.errBow')
    if (!f.ageGroup)    errs.ageGroup    = t('coachScores.errAge')
    if (!f.date)        errs.date        = t('coachScores.errDate')
    if (!f.totalScore)       errs.totalScore  = t('coachScores.errScore')
    else if (+f.totalScore < 0) errs.totalScore = t('coachScores.errScoreMin')
    if (!f.maxScore)         errs.maxScore    = t('coachScores.errMax')
    else if (+f.maxScore < 0)   errs.maxScore  = t('coachScores.errMaxMin')
    if (f.totalScore && f.maxScore && +f.totalScore > +f.maxScore)
      errs.totalScore = t('coachScores.errScoreExceeds')
    if (files.length === 0) errs.proof = t('coachScores.errProof')
    return errs
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!profile) return
    const errs = validate(form, proofFiles)
    if (Object.keys(errs).length) { setFormErrors(errs); return }
    setSubmitting(true)
    try {
      const linked = linkedArchers.find(a => a.id === form.archerId)
      if (!linked) throw new Error(t('coachScores.notLinkedHint'))

      const proofPath = await uploadProofs(proofFiles, profile.id, form.archerId)

      const { error: insErr } = await supabase.from('score_submissions').insert({
        archer_id:    form.archerId,
        coach_id:     profile.id,
        round_id:     form.roundId,
        date:         form.date,
        total_score:  parseInt(form.totalScore, 10),
        max_score:    parseInt(form.maxScore, 10),
        bow_category: form.bowCategory  || null,
        age_group:    form.ageGroup     || null,
        venue:        form.venue.trim() || null,
        notes:        form.notes.trim() || null,
        proof_url:    proofPath,
        status:       'coach_approved',  // coach submitting → PLD coach / admin validates
        sync_source:  'manual',
      })
      if (insErr) throw insErr

      writeAuditLog(profile.id, 'coach.score_submitted', 'score_submission', undefined, {
        archer_name: linked.name, score: `${form.totalScore}/${form.maxScore}`, bow_category: form.bowCategory,
      })

      ok(t('coachScores.submittedFor', { name: linked.name }))
      setForm(EMPTY_FORM)
      setProofFiles([])
      setFormErrors({})
      if (fileRef.current) fileRef.current.value = ''
      queryClient.invalidateQueries({ queryKey: ['coach-scores'] })
      queryClient.invalidateQueries({ queryKey: ['coach-scores-counts'] })
      queryClient.invalidateQueries({ queryKey: ['coach-scores-this-month'] })
      setTab('pending')
    } catch (e: unknown) {
      err(t('scoreEntry.submitFailed'), (e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Proof modal ───────────────────────────────────────────────────────────
  async function openProof(row: SubmissionRow) {
    setSelectedRow(row); setActionType('proof'); setProofUrls([])
    if (!row.proof_url) return
    setProofLoading(true)
    try {
      setProofUrls(await resolveProofUrls(row.proof_url))
    } finally { setProofLoading(false) }
    if (profile) {
      writeAuditLog(profile.id, 'coach.score_proof_viewed', 'score_submission', row.id, {
        archer_name: row.archer?.name, score: `${row.total_score}/${row.max_score}`,
      })
    }
  }

  // ── Withdraw ──────────────────────────────────────────────────────────────
  async function handleWithdraw() {
    if (!selectedRow || !profile) return
    setWithdrawing(true)
    try {
      const { error: upErr } = await supabase
        .from('score_submissions').update({ status: 'withdrawn' })
        .eq('id', selectedRow.id).eq('coach_id', profile.id)
      if (upErr) throw upErr

      writeAuditLog(profile.id, 'coach.score_withdrawn', 'score_submission', selectedRow.id, {
        archer_name: selectedRow.archer?.name, score: `${selectedRow.total_score}/${selectedRow.max_score}`,
      })

      ok(t('coachScores.withdrawn'))
      queryClient.invalidateQueries({ queryKey: ['coach-scores'] })
      queryClient.invalidateQueries({ queryKey: ['coach-scores-counts'] })
      closeModal()
    } catch (e: unknown) {
      err(t('crPage.withdrawFailed'), (e as Error).message)
    } finally { setWithdrawing(false) }
  }

  // ── Validate archer submission (pending → coach_approved) ─────────────────
  async function handleValidateApprove() {
    if (!selectedRow || !profile) return
    setValidating(true)
    try {
      // Archer-submitted scores are finalized by the coach — no admin step.
      // coach_id is stamped here so pre-link submissions validate too.
      const { error } = await supabase
        .from('score_submissions').update({ status: 'admin_approved', coach_id: profile.id })
        .eq('id', selectedRow.id).eq('status', 'pending')
      if (error) throw error
      writeAuditLog(profile.id, 'coach.score_approved', 'score_submission', selectedRow.id, {
        archer_name: selectedRow.archer?.name, score: `${selectedRow.total_score}/${selectedRow.max_score}`,
      })
      ok(t('coachScores.approvedToast'))
      queryClient.invalidateQueries({ queryKey: ['coach-scores'] })
      queryClient.invalidateQueries({ queryKey: ['coach-scores-counts'] })
      closeModal()
    } catch (e: unknown) {
      err(t('coachScores.validationFailed'), (e as Error).message)
    } finally { setValidating(false) }
  }

  // ── Reject archer submission (pending → rejected) ─────────────────────────
  async function handleValidateReject() {
    if (!selectedRow || !profile || !rejectReason.trim()) return
    setValidating(true)
    try {
      const { error } = await supabase
        .from('score_submissions').update({ status: 'rejected', rejection_reason: rejectReason.trim(), coach_id: profile.id })
        .eq('id', selectedRow.id).eq('status', 'pending')
      if (error) throw error
      writeAuditLog(profile.id, 'coach.score_rejected', 'score_submission', selectedRow.id, {
        archer_name: selectedRow.archer?.name, reason: rejectReason.trim(),
      })
      ok(t('pldVal.rejected'))
      queryClient.invalidateQueries({ queryKey: ['coach-scores'] })
      queryClient.invalidateQueries({ queryKey: ['coach-scores-counts'] })
      closeModal()
    } catch (e: unknown) {
      err(t('coachScores.rejectionFailed'), (e as Error).message)
    } finally { setValidating(false) }
  }

  // ── Open resubmit ─────────────────────────────────────────────────────────
  function openResubmit(row: SubmissionRow) {
    setSelectedRow(row)
    setResubForm({
      archerId:    row.archer_id,
      roundId:     row.round_id,
      bowCategory: row.bow_category ?? '',
      ageGroup:    row.age_group    ?? '',
      totalScore:  String(row.total_score),
      maxScore:    String(row.max_score),
      totalArrows: String(row.round?.total_arrows ?? ''),
      date:        row.date,
      venue:       row.venue  ?? '',
      notes:       row.notes  ?? '',
    })
    setResubFiles([]); setResubErrors({}); setActionType('resubmit')
  }

  // ── Resubmit ──────────────────────────────────────────────────────────────
  async function handleResubmit() {
    if (!profile || !selectedRow) return
    const errs = validate(resubForm, resubFiles)
    if (Object.keys(errs).length) { setResubErrors(errs); return }
    setResubmitting(true)
    try {
      const linked = linkedArchers.find(a => a.id === resubForm.archerId)
      if (!linked) throw new Error(t('coachScores.notLinkedHint'))

      const proofPath = await uploadProofs(resubFiles, profile.id, resubForm.archerId)

      const { error: insErr } = await supabase.from('score_submissions').insert({
        archer_id:    resubForm.archerId,
        coach_id:     profile.id,
        round_id:     resubForm.roundId,
        date:         resubForm.date,
        total_score:  parseInt(resubForm.totalScore, 10),
        max_score:    parseInt(resubForm.maxScore, 10),
        bow_category: resubForm.bowCategory  || null,
        age_group:    resubForm.ageGroup     || null,
        venue:        resubForm.venue.trim() || null,
        notes:        resubForm.notes.trim() || null,
        proof_url:    proofPath,
        status:       'coach_approved',
        sync_source:  'manual',
      })
      if (insErr) throw insErr

      writeAuditLog(profile.id, 'coach.score_resubmitted', 'score_submission', selectedRow.id, {
        archer_name: linked.name, original_id: selectedRow.id, score: `${resubForm.totalScore}/${resubForm.maxScore}`,
      })

      ok(t('coachScores.resubmittedFor', { name: linked.name }))
      queryClient.invalidateQueries({ queryKey: ['coach-scores'] })
      queryClient.invalidateQueries({ queryKey: ['coach-scores-counts'] })
      queryClient.invalidateQueries({ queryKey: ['coach-scores-this-month'] })
      closeModal(); setTab('pending')
    } catch (e: unknown) {
      err(t('coachScores.resubmitFailed'), (e as Error).message)
    } finally { setResubmitting(false) }
  }

  function closeModal() {
    if (withdrawing || resubmitting || validating) return
    setSelectedRow(null); setActionType(null); setProofUrls([]); setRejectReason('')
  }

  const hasActiveFilters = Object.values(filters).some(v => v !== '')
  const activeFilterCount = Object.values(filters).filter(v => v !== '').length

  const visibleTabs = canSubmitForArcher ? TABS : TABS.filter(t => t.key !== 'submit')

  if (!profile) return null

  // Scores module turned off → unavailable, unless an operational admin (e.g.
  // super_admin previewing the coach view).
  if (!moduleEnabled && !isOperationalAdmin(role)) {
    return (
      <FeatureUnavailable
        title={t('coachScores.unavailable')}
        message={t('coachScores.unavailableHint')}
      />
    )
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('coachScores.title')}
        description={t('coachScores.description')}
        action={
          tab !== 'submit' && canSubmitForArcher ? (
            <Button variant="primary" onClick={() => setTab('submit')}>
              <PlusIcon /> {t('scoreEntry.submitScore')}
            </Button>
          ) : undefined
        }
      />

      {/* ── STATS ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label={t('common.total')}      value={counts?.total    ?? 0} clickable active={tab === 'all'} onClick={() => setTab('all')} />
        <StatCard label={t('status.pending')}    value={counts?.pending  ?? 0} badge={(counts?.pending ?? 0) > 0 ? counts!.pending : undefined} clickable active={tab === 'pending'} onClick={() => setTab('pending')} />
        <StatCard label={t('status.approved')}   value={counts?.approved ?? 0} accent={(counts?.approved ?? 0) > 0} clickable active={tab === 'approved'} onClick={() => setTab('approved')} />
        <StatCard label={t('status.rejected')}   value={counts?.rejected ?? 0} clickable active={tab === 'rejected'} onClick={() => setTab('rejected')} />
        <StatCard
          label={t('archerDash.bestScore')}
          value={bestScore ? String(bestScore.total_score) : '—'}
          sub={bestScore ? `/ ${bestScore.max_score}` : t('coachScores.noApprovedYet')}
        />
        <StatCard label={t('common.thisMonth')} value={thisMonth} />
      </div>

      {/* ── TABS ── */}
      <div className="flex flex-wrap gap-1 bg-section rounded-[13px] p-1 mb-5 w-fit overflow-x-auto">
        {visibleTabs.map(tabDef => {
          const count = tabDef.key === 'validate' ? (counts?.toValidate ?? 0)
                      : tabDef.key === 'pending'  ? (counts?.pending  ?? 0)
                      : tabDef.key === 'approved' ? (counts?.approved ?? 0)
                      : tabDef.key === 'rejected' ? (counts?.rejected ?? 0)
                      : tabDef.key === 'all'      ? (counts?.total    ?? 0)
                      : 0
          const isActive = tab === tabDef.key
          return (
            <button
              key={tabDef.key}
              onClick={() => setTab(tabDef.key)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-[9px] text-sm font-display font-semibold',
                'transition-all duration-150 whitespace-nowrap',
                isActive
                  ? 'bg-surface text-text shadow-sm'
                  : 'text-text-dim hover:text-text hover:bg-surface-soft',
              )}
            >
              {t(tabDef.labelKey)}
              {tabDef.key !== 'submit' && count > 0 && (
                <span className={cn(
                  'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-[10px] font-bold px-1 leading-none',
                  isActive && tabDef.key === 'pending'
                    ? 'bg-warning text-white'
                    : isActive
                    ? 'bg-primary text-primary-on'
                    : 'bg-surface-soft text-text-faint',
                )}>
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ── SUBMIT TAB ── */}
      {tab === 'submit' && canSubmitForArcher && (
        <>
          <SubmitScoreForm
            form={form}
            setF={setF}
            errors={formErrors}
            linkedArchers={linkedArchers}
            rounds={rounds}
            proofFiles={proofFiles}
            setProofFiles={setProofFiles}
            fileRef={fileRef}
            submitting={submitting}
            onSubmit={handleSubmit}
            onReset={() => { setForm(EMPTY_FORM); setFormErrors({}); setProofFiles([]); if (fileRef.current) fileRef.current.value = '' }}
            navigate={navigate}
          />
          {linkedArchers.length > 0 && (
            <BatchUploadPanel
              linkedArchers={linkedArchers}
              rounds={rounds}
              coachId={profile!.id}
              onDone={() => {
                queryClient.invalidateQueries({ queryKey: ['coach-scores'] })
                queryClient.invalidateQueries({ queryKey: ['coach-scores-counts'] })
                queryClient.invalidateQueries({ queryKey: ['coach-scores-this-month'] })
                setTab('pending')
              }}
            />
          )}
        </>
      )}

      {/* ── LIST TABS ── */}
      {tab !== 'submit' && (
        <>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder={t('coachScores.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 max-w-[480px]"
            />
            <Button
              variant={filtersOpen || hasActiveFilters ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => setFiltersOpen(o => !o)}
              icon={<FilterIcon />}
            >
              {t('common.filters')}
              {hasActiveFilters && (
                <span className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-current/20 text-[9px] font-bold ml-0.5">
                  {activeFilterCount}
                </span>
              )}
            </Button>
          </div>

          {filtersOpen && (
            <div className="card mb-5 p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <Select label={t('roles.archer')}       value={filters.archerId}    onChange={e => setFilters(f => ({ ...f, archerId:    e.target.value }))} options={archerFilterOpts} />
                <Select label={t('common.state')}        value={filters.stateCode}   onChange={e => setFilters(f => ({ ...f, stateCode:   e.target.value }))} options={stateOpts} />
                <Select label={t('common.bowCategory')} value={filters.bowCategory} onChange={e => setFilters(f => ({ ...f, bowCategory: e.target.value }))} options={BOW_FILTER_OPTS.map(o => ({ value: o.value, label: t(o.labelKey) }))} />
                <Select label={t('common.ageGroup')}    value={filters.ageGroup}    onChange={e => setFilters(f => ({ ...f, ageGroup:    e.target.value }))} options={AGE_FILTER_OPTS.map(o => ({ value: o.value, label: t(o.labelKey) }))} />
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-text-dim">{t('coachScores.dateFrom')}</label>
                  <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))} className="field" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[12px] font-semibold text-text-dim">{t('coachScores.dateTo')}</label>
                  <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))} className="field" />
                </div>
              </div>
              {hasActiveFilters && (
                <div className="flex justify-end mt-3 pt-3 border-t border-line">
                  <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>{t('coachAch.clearFilters')}</Button>
                </div>
              )}
            </div>
          )}

          {linkedArchers.length === 0 && !isLoading && (
            <div className="card flex flex-col items-center gap-4 py-14 text-center">
              <ArcherIcon size={36} />
              <div>
                <p className="font-semibold text-text mb-1">{t('coachDash.noLinkedYet')}</p>
                <p className="text-sm text-text-dim">{t('coachScores.linkFirst')}</p>
              </div>
              <Button variant="primary" onClick={() => navigate('/coach/archers')}>{t('coachProfile.goToArchers')}</Button>
            </div>
          )}

          {isLoading && (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-[var(--r-md)] bg-surface-soft animate-pulse" />)}
            </div>
          )}

          {isError && !isLoading && (
            <p className="text-sm text-danger text-center py-10">{t('common.loadFailed')}</p>
          )}

          {!isLoading && !isError && linkedArchers.length > 0 && filtered.length === 0 && (
            <EmptyState
              title={search || hasActiveFilters ? t('coachScores.noResults') : t('coachScores.noSubmissions')}
              description={
                search || hasActiveFilters ? t('common.noResultsFilters')
                  : tab === 'pending' ? t('coachScores.pendingHint')
                  : tab === 'rejected' ? t('coachScores.noRejected')
                  : undefined
              }
            />
          )}

          {!isLoading && !isError && filtered.length > 0 && (
            <>
              <p className="text-xs text-text-faint mb-3">{t('common.showing', { shown: filtered.length, total: scores.length })}</p>

              {/* Desktop table */}
              <div className="card hidden lg:block overflow-x-auto p-0">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="bg-surface-soft">
                      {[t('roles.archer'), t('common.school'), t('common.state'), t('common.round'), t('leaderboardPage.bow'), t('common.age'), t('common.score'), t('common.date'), t('common.status'), ''].map((h, i) => (
                        <th key={i} className={cn(
                          'text-left py-3 text-[11px] font-semibold uppercase tracking-wide text-text-faint border-b border-line-strong whitespace-nowrap',
                          i === 0 ? 'pl-4 pr-3' : 'px-3',
                        )}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <ScoreTableRow
                        key={row.id} row={row} canResubmit={canResubmit}
                        onViewProof={() => openProof(row)}
                        onWithdraw={() => { setSelectedRow(row); setActionType('withdraw') }}
                        onResubmit={() => openResubmit(row)}
                        onValidate={() => { setSelectedRow(row); setActionType('validate') }}
                        onReject={() => { setSelectedRow(row); setRejectReason(''); setActionType('reject') }}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="lg:hidden space-y-3">
                {filtered.map(row => (
                  <ScoreMobileCard
                    key={row.id} row={row} canResubmit={canResubmit}
                    onViewProof={() => openProof(row)}
                    onWithdraw={() => { setSelectedRow(row); setActionType('withdraw') }}
                    onResubmit={() => openResubmit(row)}
                    onValidate={() => { setSelectedRow(row); setActionType('validate') }}
                    onReject={() => { setSelectedRow(row); setRejectReason(''); setActionType('reject') }}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ── PROOF MODAL (supports multiple photos) ── */}
      <Modal open={actionType === 'proof' && !!selectedRow} onClose={closeModal} title={t('coachScores.scoreProof')} width="min(760px,100%)">
        <div className="min-h-[200px] flex flex-col items-center justify-center">
          {proofLoading ? (
            <p className="text-text-faint text-sm">{t('common.loading')}</p>
          ) : proofUrls.length > 0 ? (
            <div className="space-y-3 w-full">
              {proofUrls.map((u, i) =>
                isPdf(u) ? (
                  <div key={i} className="flex flex-col items-center gap-4 py-8">
                    <PdfIcon />
                    <p className="text-sm text-text-dim">{t('coachScores.pdfProof')} {proofUrls.length > 1 ? i + 1 : ''}</p>
                    <Button variant="primary" onClick={() => window.open(u, '_blank')}>{t('certPage.openPdf')}</Button>
                  </div>
                ) : (
                  <img key={i} src={u} alt={`Score proof ${i + 1}`} className="w-full max-h-[72vh] object-contain rounded-[var(--r)]" />
                ),
              )}
              {selectedRow && (
                <p className="text-xs text-text-faint text-center">
                  {selectedRow.archer?.name} · {selectedRow.round?.name} · {formatDate(selectedRow.date)}
                  {proofUrls.length > 1 ? ` · ${proofUrls.length} ${t('coachScores.photos')}` : ''}
                </p>
              )}
            </div>
          ) : (
            <p className="text-text-faint text-sm">{t('coachScores.noProof')}</p>
          )}
        </div>
      </Modal>

      {/* ── WITHDRAW MODAL ── */}
      <Modal open={actionType === 'withdraw' && !!selectedRow} onClose={closeModal} title={t('coachScores.withdrawTitle')} width="min(440px,100%)">
        {selectedRow && (
          <div className="space-y-4">
            <div className="p-3 rounded-[var(--r)] bg-surface-soft border border-line text-sm">
              <p className="font-semibold">{selectedRow.archer?.name ?? '—'}</p>
              <p className="text-text-dim text-xs mt-0.5">
                {selectedRow.round?.name} · {selectedRow.total_score}/{selectedRow.max_score} · {formatDate(selectedRow.date)}
              </p>
            </div>
            <p className="text-sm text-text-dim leading-relaxed">
              {t('coachScores.withdrawBody')}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={closeModal} disabled={withdrawing}>{t('common.cancel')}</Button>
              <Button variant="danger" size="sm" loading={withdrawing} onClick={handleWithdraw}>{t('common.withdraw')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── VALIDATE (approve archer submission) MODAL ── */}
      <Modal open={actionType === 'validate' && !!selectedRow} onClose={closeModal} title={t('pldVal.validateScore')} width="min(440px,100%)">
        {selectedRow && (
          <div className="space-y-4">
            <div className="p-3 rounded-[var(--r)] bg-surface-soft border border-line text-sm">
              <p className="font-semibold">{selectedRow.archer?.name ?? '—'}</p>
              <p className="text-text-dim text-xs mt-0.5">
                {selectedRow.round?.name} · {selectedRow.total_score}/{selectedRow.max_score} · {formatDate(selectedRow.date)}
              </p>
            </div>
            <p className="text-sm text-text-dim leading-relaxed">
              {t('coachScores.validateBody')}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={closeModal} disabled={validating}>{t('common.cancel')}</Button>
              <Button variant="success" size="sm" loading={validating} onClick={handleValidateApprove}>{t('common.approve')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── REJECT (archer submission) MODAL ── */}
      <Modal open={actionType === 'reject' && !!selectedRow} onClose={closeModal} title={t('scores.rejectScore')} width="min(440px,100%)">
        {selectedRow && (
          <div className="space-y-4">
            <div className="p-3 rounded-[var(--r)] bg-surface-soft border border-line text-sm">
              <p className="font-semibold">{selectedRow.archer?.name ?? '—'}</p>
              <p className="text-text-dim text-xs mt-0.5">
                {selectedRow.round?.name} · {selectedRow.total_score}/{selectedRow.max_score} · {formatDate(selectedRow.date)}
              </p>
            </div>
            <Textarea
              label={t('pldVal.rejectReason')}
              placeholder={t('pldVal.rejectPlaceholder')}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              minRows={3}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={closeModal} disabled={validating}>{t('common.cancel')}</Button>
              <Button variant="danger" size="sm" loading={validating} disabled={!rejectReason.trim()} onClick={handleValidateReject}>{t('common.reject')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── RESUBMIT MODAL ── */}
      <Modal open={actionType === 'resubmit' && !!selectedRow} onClose={closeModal} title={t('coachScores.resubmitTitle')} width="min(660px,100%)">
        {selectedRow && (
          <div className="space-y-4">
            {selectedRow.rejection_reason && (
              <div className="p-3 rounded-[var(--r)] bg-danger-soft border border-danger/20 text-sm">
                <p className="text-[11px] font-semibold text-danger mb-0.5 uppercase tracking-wide">{t('archerProfile.rejectionReason')}</p>
                <p className="text-text-dim">{selectedRow.rejection_reason}</p>
              </div>
            )}
            <SubmitScoreForm
              form={resubForm}
              setF={(k, v) => setResubForm(f => ({ ...f, [k]: v }))}
              errors={resubErrors}
              linkedArchers={linkedArchers}
              rounds={rounds}
              proofFiles={resubFiles}
              setProofFiles={setResubFiles}
              fileRef={resubFileRef}
              submitting={resubmitting}
              onSubmit={handleResubmit}
              onReset={() => { setResubForm(EMPTY_FORM); setResubErrors({}); setResubFiles([]); if (resubFileRef.current) resubFileRef.current.value = '' }}
              navigate={navigate}
              compact
              submitLabel={t('coachScores.resubmitTitle')}
            />
          </div>
        )}
      </Modal>
    </PageWrapper>
  )
}

// ─── SUBMIT SCORE FORM ───────────────────────────────────────────────────────

interface SubmitFormProps {
  form: SubmitFormState
  setF: (k: keyof SubmitFormState, v: string) => void
  errors: Partial<Record<keyof SubmitFormState | 'proof', string>>
  linkedArchers: ArcherOption[]
  rounds: RoundOption[]
  proofFiles: File[]
  setProofFiles: (f: File[]) => void
  fileRef: React.RefObject<HTMLInputElement>
  submitting: boolean
  onSubmit: () => void
  onReset: () => void
  navigate: (path: string) => void
  compact?: boolean
  submitLabel?: string
}

function SubmitScoreForm({
  form, setF, errors, linkedArchers, rounds,
  proofFiles, setProofFiles, fileRef,
  submitting, onSubmit, onReset, navigate, compact, submitLabel,
}: SubmitFormProps) {
  const { t } = useLanguage()
  const archerOpts = [
    { value: '', label: t('coachScores.selectStudent') },
    ...linkedArchers.map(a => ({ value: a.id, label: `${a.name}${a.archer_id ? ` (${a.archer_id})` : ''}` })),
  ]
  const roundOpts = [
    { value: '', label: t('scoreEntry.selectRound') },
    ...rounds.map(r => ({ value: r.id, label: r.name })),
  ]

  if (linkedArchers.length === 0) {
    return (
      <div className={cn('card flex flex-col items-center gap-4 py-12 text-center', compact && 'py-8')}>
        <ArcherIcon size={32} />
        <div>
          <p className="font-semibold text-text mb-1">{t('coachScores.noLinkedActive')}</p>
          <p className="text-sm text-text-dim">{t('coachScores.linkFirst')}</p>
        </div>
        {!compact && (
          <Button variant="primary" onClick={() => navigate('/coach/archers')}>{t('coachProfile.goToArchers')}</Button>
        )}
      </div>
    )
  }

  return (
    <div className={cn(!compact && 'card p-6')}>
      {!compact && (
        <h3 className="font-display font-semibold text-base text-text mb-5">{t('coachScores.scoreDetails')}</h3>
      )}
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label={`${t('coachScores.student')} *`}    value={form.archerId}    onChange={e => setF('archerId',    e.target.value)} options={archerOpts}    error={errors.archerId} />
          <Select label={`${t('common.roundType')} *`} value={form.roundId}     onChange={e => setF('roundId',     e.target.value)} options={roundOpts}     error={errors.roundId} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label={`${t('common.bowCategory')} *`} value={form.bowCategory} onChange={e => setF('bowCategory', e.target.value)} options={BOW_CATEGORIES.map(o => ({ value: o.value, label: t(o.labelKey) }))} error={errors.bowCategory} />
          <Select label={`${t('common.ageGroup')} *`}    value={form.ageGroup}    onChange={e => setF('ageGroup',    e.target.value)} options={AGE_GROUPS.map(o => ({ value: o.value, label: t(o.labelKey) }))}    error={errors.ageGroup} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <Input label={`${t('common.score')} *`}       type="number" min={0} value={form.totalScore}  onChange={e => setF('totalScore',  e.target.value)} error={errors.totalScore}  placeholder="0" />
          <Input label={`${t('coachScores.maxScore')} *`}   type="number" min={0} value={form.maxScore}    onChange={e => setF('maxScore',    e.target.value)} error={errors.maxScore}    placeholder={t('coachScores.autoFromRound')} />
          <Input label={t('coachScores.totalArrows')}  type="number" min={0} value={form.totalArrows} onChange={e => setF('totalArrows', e.target.value)} placeholder={t('coachScores.autoFromRound')} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[12px] font-semibold text-text-dim">{t('coachScores.sessionDate')} *</label>
            <input
              type="date" value={form.date}
              onChange={e => setF('date', e.target.value)}
              className={cn('field', errors.date && 'border-danger focus:border-danger')}
            />
            {errors.date && <p className="text-[12px] text-danger font-medium">{errors.date}</p>}
          </div>
          <Input label={t('coachScores.venue')} value={form.venue} onChange={e => setF('venue', e.target.value)} placeholder={t('common.optional')} />
        </div>
        <Textarea label={t('common.notes')} value={form.notes} onChange={e => setF('notes', e.target.value)} placeholder={t('coachScores.notesPlaceholder')} minRows={2} />

        {/* Proof upload — multiple photos supported for PLD-coach validation */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold text-text-dim">
            {t('pldVal.proof')} * <span className="font-normal text-text-faint">{t('coachScores.proofTypes')}</span>
          </label>
          <label className={cn(
            'flex flex-col items-center justify-center gap-2 min-h-[100px] rounded-[var(--r)] border-2 border-dashed cursor-pointer transition-colors',
            'hover:border-primary hover:bg-primary/5',
            proofFiles.length ? 'border-success bg-success/5'
            : errors.proof    ? 'border-danger bg-danger/5'
            : 'border-line bg-surface-soft',
          )}>
            <input ref={fileRef} type="file" accept={ACCEPT_TYPES} multiple className="sr-only"
              onChange={e => {
                const added = Array.from(e.target.files ?? [])
                if (added.length) setProofFiles([...proofFiles, ...added])
                e.target.value = ''
              }} />
            {proofFiles.length ? (
              <>
                <CheckCircleIcon />
                <span className="text-sm font-semibold text-success">
                  {t('coachScores.filesAttached', { count: proofFiles.length })}
                </span>
                <span className="text-xs text-text-faint">{t('coachScores.addMore')}</span>
              </>
            ) : (
              <>
                <UploadIcon />
                <span className="text-sm font-semibold text-text-dim">{t('coachScores.clickToUpload')}</span>
                <span className="text-xs text-text-faint">{t('coachScores.severalAllowed')}</span>
              </>
            )}
          </label>
          {proofFiles.length > 0 && (
            <div className="flex flex-col gap-1">
              {proofFiles.map((f, i) => (
                <div key={`${f.name}-${i}`} className="flex items-center gap-2 text-xs bg-surface-soft rounded-[8px] px-2.5 py-1.5">
                  <span className="flex-1 truncate text-text-dim">{f.name}</span>
                  <span className="text-text-faint shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
                  <button
                    type="button"
                    className="text-danger font-bold px-1 hover:opacity-70"
                    onClick={() => setProofFiles(proofFiles.filter((_, x) => x !== i))}
                    aria-label={`Remove ${f.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          {errors.proof && <p className="text-[12px] text-danger font-medium">{errors.proof}</p>}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-line">
          <Button variant="ghost" size="sm" onClick={onReset} disabled={submitting}>{t('coachScores.resetForm')}</Button>
          <Button variant="primary" loading={submitting} onClick={onSubmit}>{submitLabel ?? t('scoreEntry.submitScore')}</Button>
        </div>
      </div>
    </div>
  )
}

// ─── DESKTOP TABLE ROW ───────────────────────────────────────────────────────

function ScoreTableRow({ row, canResubmit, onViewProof, onWithdraw, onResubmit, onValidate, onReject }: {
  row: SubmissionRow; canResubmit: boolean; onViewProof: () => void; onWithdraw: () => void; onResubmit: () => void; onValidate: () => void; onReject: () => void
}) {
  const { t } = useLanguage()
  const isPending    = row.status === 'coach_approved'
  const isRejected   = row.status === 'rejected'
  const isToValidate = row.status === 'pending'

  return (
    <tr className="border-b border-line last:border-0 hover:bg-surface-soft transition-colors">
      <td className="pl-4 pr-3 py-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Avatar name={row.archer?.name ?? '?'} size="sm" />
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate max-w-[140px]">{row.archer?.name ?? '—'}</div>
            <div className="text-[10px] text-text-faint font-mono">{row.archer?.archer_id ?? ''}</div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-text-dim"><span className="truncate block max-w-[110px]">{row.archer?.school?.name ?? '—'}</span></td>
      <td className="px-3 py-2.5 text-xs text-text-dim whitespace-nowrap">{row.archer?.state?.code ?? '—'}</td>
      <td className="px-3 py-2.5 text-sm text-text-dim"><span className="truncate block max-w-[130px]">{row.round?.name ?? '—'}</span></td>
      <td className="px-3 py-2.5 text-xs text-text-dim whitespace-nowrap">{bowLabel(row.bow_category)}</td>
      <td className="px-3 py-2.5 text-xs text-text-dim whitespace-nowrap">{ageLabel(row.age_group)}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="font-mono font-semibold text-sm text-text">{row.total_score}/{row.max_score}</span>
      </td>
      <td className="px-3 py-2.5 text-xs text-text-dim whitespace-nowrap">{formatDate(row.date)}</td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <CoachScoreBadge status={row.status} />
        {isRejected && row.rejection_reason && (
          <p className="text-[10px] text-danger mt-0.5 max-w-[120px] truncate" title={row.rejection_reason}>{row.rejection_reason}</p>
        )}
      </td>
      <td className="px-3 py-2.5 pr-4 whitespace-nowrap">
        <div className="flex gap-1">
          {row.proof_url && <Button variant="ghost" size="sm" onClick={onViewProof} icon={<PhotoIcon />}>{t('pldVal.proof')}</Button>}
          {isToValidate && <Button variant="success" size="sm" onClick={onValidate}>{t('common.approve')}</Button>}
          {isToValidate && <Button variant="ghost" size="sm" onClick={onReject} className="text-danger hover:text-danger">{t('common.reject')}</Button>}
          {isPending  && <Button variant="ghost" size="sm" onClick={onWithdraw} className="text-danger hover:text-danger">{t('common.withdraw')}</Button>}
          {isRejected && canResubmit && <Button variant="primary" size="sm" onClick={onResubmit}>{t('coachScores.resubmit')}</Button>}
        </div>
      </td>
    </tr>
  )
}

// ─── MOBILE CARD ─────────────────────────────────────────────────────────────

function ScoreMobileCard({ row, canResubmit, onViewProof, onWithdraw, onResubmit, onValidate, onReject }: {
  row: SubmissionRow; canResubmit: boolean; onViewProof: () => void; onWithdraw: () => void; onResubmit: () => void; onValidate: () => void; onReject: () => void
}) {
  const { t } = useLanguage()
  const isPending    = row.status === 'coach_approved'
  const isRejected   = row.status === 'rejected'
  const isToValidate = row.status === 'pending'

  return (
    <div className="card space-y-3">
      <div className="flex items-start gap-3">
        <Avatar name={row.archer?.name ?? '?'} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate">{row.archer?.name ?? '—'}</div>
              <div className="text-[10px] text-text-faint font-mono">{row.archer?.archer_id ?? ''}</div>
            </div>
            <CoachScoreBadge status={row.status} />
          </div>
          <span className="font-mono text-xs font-bold text-text bg-section px-2 py-0.5 rounded mt-1.5 inline-block">
            {row.total_score}/{row.max_score}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <div><p className="text-text-faint mb-0.5">{t('common.round')}</p><p className="text-text-dim font-medium truncate">{row.round?.name ?? '—'}</p></div>
        <div><p className="text-text-faint mb-0.5">{t('leaderboardPage.bow')}</p><p className="text-text-dim font-medium">{bowLabel(row.bow_category)}</p></div>
        <div><p className="text-text-faint mb-0.5">{t('common.school')}</p><p className="text-text-dim font-medium truncate">{row.archer?.school?.name ?? '—'}</p></div>
        <div><p className="text-text-faint mb-0.5">{t('common.ageGroup')}</p><p className="text-text-dim font-medium">{ageLabel(row.age_group)}</p></div>
        <div><p className="text-text-faint mb-0.5">{t('common.date')}</p><p className="text-text-dim font-medium">{formatDate(row.date)}</p></div>
        <div><p className="text-text-faint mb-0.5">{t('archerProfile.submitted')}</p><p className="text-text-dim font-medium">{formatDate(row.created_at)}</p></div>
        {row.venue && <div className="col-span-2"><p className="text-text-faint mb-0.5">{t('common.venue')}</p><p className="text-text-dim font-medium">{row.venue}</p></div>}
      </div>

      {isRejected && row.rejection_reason && (
        <div className="text-xs text-danger bg-danger-soft rounded-[var(--r-sm)] px-2.5 py-2 leading-relaxed">
          <span className="font-semibold">{t('status.rejected')}: </span>{row.rejection_reason}
        </div>
      )}
      {row.notes && <p className="text-xs text-text-faint italic">{row.notes}</p>}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line flex-wrap">
        {row.proof_url && <Button variant="ghost" size="sm" onClick={onViewProof} icon={<PhotoIcon />}>{t('certPage.viewProof')}</Button>}
        {isToValidate && <Button variant="danger"  size="sm" onClick={onReject}>{t('common.reject')}</Button>}
        {isToValidate && <Button variant="success" size="sm" onClick={onValidate}>{t('common.approve')}</Button>}
        {isPending  && <Button variant="ghost" size="sm" onClick={onWithdraw} className="text-danger hover:text-danger">{t('common.withdraw')}</Button>}
        {isRejected && canResubmit && <Button variant="primary" size="sm" onClick={onResubmit}>{t('coachScores.resubmit')}</Button>}
      </div>
    </div>
  )
}

// ─── BATCH UPLOAD (CSV template → fill in Excel → import) ────────────────────

interface BatchRow {
  archerId: string | null
  archerCode: string
  name: string
  total: number | null
  ends: number[]
  error: string | null
}

/** Minimal CSV line parser — handles double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function BatchUploadPanel({ linkedArchers, rounds, coachId, onDone }: {
  linkedArchers: ArcherOption[]
  rounds: RoundOption[]
  coachId: string
  onDone: () => void
}) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const [roundId, setRoundId] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<BatchRow[] | null>(null)
  const [proofs, setProofs] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const csvRef = useRef<HTMLInputElement>(null)
  const proofRef = useRef<HTMLInputElement>(null)

  const round = rounds.find(r => r.id === roundId)
  const endCount = round
    ? round.ends
      ?? (round.arrows_per_end ? Math.ceil(round.total_arrows / round.arrows_per_end)
        : round.total_arrows % 6 === 0 ? round.total_arrows / 6
        : round.total_arrows % 3 === 0 ? round.total_arrows / 3
        : 0)
    : 0

  const roundOpts = [
    { value: '', label: t('coachScores.selectRoundFirst') },
    ...rounds.map(r => ({ value: r.id, label: r.name })),
  ]

  function downloadTemplate() {
    if (!round) return
    const endHeaders = Array.from({ length: endCount }, (_, i) => `end_${i + 1}`)
    const header = ['archer_id', 'name', 'total_score', ...endHeaders].join(',')
    const body = linkedArchers
      .map(a => [`${a.archer_id ?? ''}`, `"${a.name.replace(/"/g, '""')}"`, '', ...endHeaders.map(() => '')].join(','))
      .join('\n')
    const blob = new Blob([`${header}\n${body}\n`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `scores-${round.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleCsv(file: File) {
    if (!round) return
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { err(t('coachScores.noDataRows')); return }
    const header = parseCsvLine(lines[0]).map(h => h.toLowerCase())
    const idIdx = header.indexOf('archer_id')
    const totalIdx = header.indexOf('total_score')
    const endIdxs = header
      .map((h, i) => (h.startsWith('end_') ? i : -1))
      .filter(i => i >= 0)
    if (idIdx < 0) { err(t('coachScores.missingIdColumn')); return }

    const byCode = new Map(linkedArchers
      .filter(a => a.archer_id)
      .map(a => [a.archer_id!.toUpperCase(), a]))

    const parsed: BatchRow[] = []
    for (const line of lines.slice(1)) {
      const cells = parseCsvLine(line)
      const code = (cells[idIdx] ?? '').toUpperCase()
      if (!code) continue
      const archer = byCode.get(code)
      const endVals = endIdxs
        .map(i => cells[i])
        .filter(v => v !== undefined && v !== '')
        .map(v => Number(v))
      const totalCell = totalIdx >= 0 ? cells[totalIdx] : ''
      const total = totalCell !== '' ? Number(totalCell)
        : endVals.length ? endVals.reduce((s, v) => s + v, 0)
        : null

      let error: string | null = null
      if (!archer) error = t('coachScores.rowNotLinked')
      else if (total == null) error = t('coachScores.rowNoScore')
      else if (Number.isNaN(total) || endVals.some(Number.isNaN)) error = t('coachScores.rowNotNumbers')
      else if (total < 0 || total > round.max_score) error = t('coachScores.rowScoreRange', { max: round.max_score })

      parsed.push({
        archerId: archer?.id ?? null,
        archerCode: code,
        name: archer?.name ?? (cells[header.indexOf('name')] ?? code),
        total: Number.isNaN(total as number) ? null : total,
        ends: endVals.every(v => !Number.isNaN(v)) ? endVals : [],
        error,
      })
    }
    if (!parsed.length) { err(t('coachScores.noFilledRows')); return }
    setRows(parsed)
  }

  const validRows = (rows ?? []).filter(r => !r.error)

  async function submitBatch() {
    if (!round || validRows.length === 0) return
    if (proofs.length === 0) { err(t('coachScores.attachProofFirst')); return }
    setUploading(true)
    try {
      const proofPath = await uploadProofs(proofs, coachId, 'batch')
      let done = 0
      for (const r of validRows) {
        const { error } = await supabase.from('score_submissions').insert({
          archer_id: r.archerId,
          coach_id: coachId,
          round_id: round.id,
          date,
          total_score: r.total,
          max_score: round.max_score,
          notes: r.ends.length ? `Ends: ${r.ends.join(', ')}` : null,
          proof_url: proofPath,
          status: 'coach_approved',
          sync_source: 'batch_csv',
        })
        if (error) throw new Error(`${r.name}: ${error.message}`)
        done++
      }
      writeAuditLog(coachId, 'coach.scores_batch_submitted', 'score_submission', undefined, {
        round: round.name, date, count: done,
      })
      ok(t('coachScores.batchSubmitted', { count: done }))
      setRows(null); setProofs([]); setRoundId('')
      onDone()
    } catch (e: unknown) {
      err(t('coachScores.batchFailed'), (e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="card p-6 mt-4">
      <h3 className="font-display font-semibold text-base text-text mb-1">{t('coachScores.batchTitle')}</h3>
      <p className="text-xs text-text-dim mb-4">
        {t('coachScores.batchHint')}
      </p>

      {/* Step 1 — score details */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <Select label={`${t('common.roundType')} *`} value={roundId} options={roundOpts}
          onChange={e => { setRoundId(e.target.value); setRows(null) }} />
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] font-semibold text-text-dim">{t('coachScores.sessionDate')} *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="field" />
        </div>
        <div className="flex items-end">
          <Button variant="outline" onClick={downloadTemplate} disabled={!round} className="w-full">
            {t('excel.downloadTemplate')}{round && endCount ? ` (${endCount} ends)` : ''}
          </Button>
        </div>
      </div>

      {/* Step 2 — import */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input ref={csvRef} type="file" accept=".csv,text/csv" className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleCsv(f); e.target.value = '' }} />
        <Button variant="secondary" disabled={!round} onClick={() => csvRef.current?.click()}>
          {t('coachScores.importFilled')}
        </Button>
        {!round && <span className="text-xs text-text-faint">{t('coachScores.selectRoundHint')}</span>}
      </div>

      {/* Step 3 — preview */}
      {rows && (
        <>
          <div className="overflow-x-auto mb-3 border border-line rounded-[var(--r-md)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-soft">
                  {[t('roles.archer'), 'ID', t('coachScores.ends'), t('common.total'), t('common.status')].map(h => (
                    <th key={h} className="text-left text-[11px] font-semibold uppercase tracking-wide text-text-faint px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={i} className={r.error ? 'bg-danger-soft/40' : ''}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-text-dim">{r.archerCode}</td>
                    <td className="px-3 py-2 text-xs text-text-dim">{r.ends.length ? r.ends.join(' · ') : '—'}</td>
                    <td className="px-3 py-2 font-mono font-semibold">{r.total ?? '—'}/{round?.max_score}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.error
                        ? <span className="text-danger font-medium">{r.error}</span>
                        : <span className="text-success font-medium">{t('coachScores.ready')}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Shared proof photos */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input ref={proofRef} type="file" accept={ACCEPT_TYPES} multiple className="sr-only"
              onChange={e => { setProofs(p => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
            <Button variant="outline" size="sm" onClick={() => proofRef.current?.click()}>
              {proofs.length ? t('coachScores.proofPhotosMore', { count: proofs.length }) : t('coachScores.attachProofPhotos')}
            </Button>
            {proofs.map((f, i) => (
              <span key={i} className="text-xs bg-surface-soft rounded px-2 py-1 inline-flex items-center gap-1.5">
                {f.name}
                <button type="button" className="text-danger font-bold" onClick={() => setProofs(p => p.filter((_, x) => x !== i))}>✕</button>
              </span>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-xs text-text-dim">
              {t('coachScores.rowsReady', { ready: validRows.length, total: rows.length })}
              {rows.length - validRows.length > 0 ? ` · ${rows.length - validRows.length} ${t('schoolImport.withErrors')}` : ''}
            </span>
            <Button variant="primary" loading={uploading}
              disabled={validRows.length === 0}
              onClick={submitBatch}>
              {t('coachScores.submitCount', { count: validRows.length })}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function FilterIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg>
}
function PhotoIcon() {
  return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
}
function UploadIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-text-faint"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
}
function CheckCircleIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-success"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
}
function PdfIcon() {
  return <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="text-danger"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
}
function ArcherIcon({ size = 36 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-text-faint"><circle cx="12" cy="8" r="4"/><path d="M6 20a6 6 0 0 1 12 0"/></svg>
}

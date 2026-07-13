import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, AccountStatusBadge } from '@/components/ui/Badge'
import { Button, Input, Textarea, Select, ConfirmDialog, EmptyState, useToast } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { writeAuditLog } from '@/services/auditLog'
import { compressImage, compressPresets } from '@/lib/imageCompress'
import { formatDate } from '@/utils/dates'
import type { AccountStatus } from '@/types'

// ── Types ──────────────────────────────────────────────────────

type CRStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'
type CRTabFilter = 'pending' | 'approved' | 'rejected' | 'all'

interface FullProfile {
  id: string
  email: string
  name: string
  role: string
  status: string
  archer_id: string | null
  school_id: string | null
  pld_id: string | null
  state_id: string | null
  bow_category: string | null
  avatar_url: string | null
  phone: string | null
  date_of_birth: string | null
}

interface ArcherExt {
  profile_id: string
  age_group: string | null
  bow_category: string | null
}

interface OrgItem   { id: string; name: string }
interface StateItem extends OrgItem { code: string }
interface PldItem   extends OrgItem { state_id: string }
interface SchoolItem extends OrgItem { pld_id: string | null; state_id: string }
interface OrgData {
  school: OrgItem   | null
  pld:    OrgItem   | null
  state:  StateItem | null
}

interface ChangeRequest {
  id: string
  user_id: string
  field_key: string
  field_label: string
  current_value: string | null
  requested_value: string
  reason: string
  status: CRStatus
  supporting_file_bucket: string | null
  supporting_file_path: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  rejection_reason: string | null
  created_at: string
}

// ── Constants ──────────────────────────────────────────────────

// `label` (English) is what gets STORED in the DB row (field_label) so admin
// views stay consistent; `labelKey` is what the archer sees, translated.
const CHANGEABLE_FIELDS = [
  { key: 'full_name',     label: 'Full Name',     labelKey: 'crFields.fullName' },
  { key: 'school',        label: 'School',        labelKey: 'common.school' },
  { key: 'state',         label: 'State',         labelKey: 'common.state' },
  { key: 'pld',           label: 'PLD',           labelKey: 'common.pld' },
  { key: 'age_group',     label: 'Age Group',     labelKey: 'common.ageGroup' },
  { key: 'bow_category',  label: 'Bow Category',  labelKey: 'common.bowCategory' },
  { key: 'date_of_birth', label: 'Date of Birth', labelKey: 'archerProfile.dateOfBirth' },
  { key: 'phone',         label: 'Phone Number',  labelKey: 'crFields.phoneNumber' },
  { key: 'other',         label: 'Other',         labelKey: 'crFields.other' },
]

const AGE_GROUP_OPTIONS = [
  { value: 'u12',     labelKey: 'crFields.u12' },
  { value: 'u15',     labelKey: 'crFields.u15' },
  { value: 'u18',     labelKey: 'crFields.u18' },
  { value: 'open',    labelKey: 'ageGroups.open' },
  { value: 'veteran', labelKey: 'crFields.veteran' },
]

const BOW_CATEGORY_OPTIONS = [
  { value: 'recurve',     labelKey: 'bows.recurve' },
  { value: 'compound',    labelKey: 'bows.compound' },
  { value: 'barebow',     labelKey: 'bows.barebow' },
  { value: 'traditional', labelKey: 'bows.traditional' },
  { value: 'longbow',     labelKey: 'bows.longbow' },
]

const CR_STATUS_VARIANT: Record<CRStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending:   'warning',
  approved:  'success',
  rejected:  'danger',
  withdrawn: 'neutral',
}

function displayValue(v: string | null | undefined): string {
  if (!v) return '—'
  const idx = v.indexOf('|')
  return idx >= 0 ? v.slice(idx + 1) : v
}

// ── Main Component ─────────────────────────────────────────────

export default function ArcherChangeRequest() {
  const { profile }  = useAuth()
  const { t }        = useLanguage()
  const navigate     = useNavigate()
  const { ok, err }  = useToast()
  const queryClient  = useQueryClient()
  const userId       = profile?.id

  // Form state
  const [fieldKey, setFieldKey]             = useState('')
  const [requestedValue, setRequestedValue] = useState('')
  const [reason, setReason]                 = useState('')
  const [proofFile, setProofFile]           = useState<File | null>(null)
  const [submitting, setSubmitting]         = useState(false)
  // Cascade filters for org dropdowns
  const [filterStateId, setFilterStateId]   = useState('')
  const [filterPldId, setFilterPldId]       = useState('')
  // Withdraw confirmation
  const [withdrawId, setWithdrawId]         = useState<string | null>(null)
  const [withdrawing, setWithdrawing]       = useState(false)
  // History tab
  const [tab, setTab]                       = useState<CRTabFilter>('pending')

  // ── Queries ──────────────────────────────────────────────────

  const { data: fullProfile, isLoading: loadingProfile } = useQuery<FullProfile | null>({
    queryKey: ['cr-full-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id,email,name,role,status,archer_id,school_id,pld_id,state_id,bow_category,avatar_url,phone,date_of_birth')
        .eq('id', userId!)
        .single()
      if (error) throw error
      return data as unknown as FullProfile
    },
  })

  const { data: orgData } = useQuery<OrgData>({
    queryKey: ['cr-org', fullProfile?.school_id, fullProfile?.pld_id, fullProfile?.state_id],
    enabled: !!fullProfile,
    queryFn: async () => {
      const { school_id, pld_id, state_id } = fullProfile!
      const [sRes, pRes, stRes] = await Promise.all([
        school_id ? supabase.from('schools').select('id,name').eq('id', school_id).maybeSingle()        : Promise.resolve({ data: null }),
        pld_id    ? supabase.from('plds').select('id,name').eq('id', pld_id).maybeSingle()              : Promise.resolve({ data: null }),
        state_id  ? supabase.from('states').select('id,name,code').eq('id', state_id).maybeSingle()    : Promise.resolve({ data: null }),
      ])
      return {
        school: sRes.data  as OrgItem   | null,
        pld:    pRes.data  as OrgItem   | null,
        state:  stRes.data as StateItem | null,
      }
    },
  })

  const { data: archerExt } = useQuery<ArcherExt | null>({
    queryKey: ['cr-archer-ext', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('archer_profiles')
        .select('profile_id,age_group,bow_category')
        .eq('profile_id', userId!)
        .maybeSingle()
      return (data as ArcherExt) ?? null
    },
  })

  const { data: coachLink } = useQuery<{ status: string } | null>({
    queryKey: ['cr-coach-link', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('coach_archer_links')
        .select('status')
        .eq('archer_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return data as { status: string } | null
    },
  })

  const { data: states = [] } = useQuery<StateItem[]>({
    queryKey: ['org-states'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('states').select('id,name,code').eq('active', true).order('name')
      return (data ?? []) as StateItem[]
    },
  })

  const { data: allPlds = [] } = useQuery<PldItem[]>({
    queryKey: ['org-plds'],
    enabled: fieldKey === 'pld' || fieldKey === 'school',
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('plds').select('id,name,state_id').eq('active', true).order('name')
      return (data ?? []) as PldItem[]
    },
  })

  const { data: allSchools = [] } = useQuery<SchoolItem[]>({
    queryKey: ['org-schools'],
    enabled: fieldKey === 'school',
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('schools').select('id,name,pld_id,state_id').eq('active', true).order('name')
      return (data ?? []) as SchoolItem[]
    },
  })

  const { data: changeRequests = [], isLoading: loadingRequests } = useQuery<ChangeRequest[]>({
    queryKey: ['archer-change-requests', userId, tab],
    enabled: !!userId,
    queryFn: async () => {
      let q = supabase
        .from('profile_change_requests')
        .select('*')
        .eq('user_id', userId!)
        .order('created_at', { ascending: false })
      if (tab !== 'all') q = q.eq('status', tab)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as ChangeRequest[]
    },
  })

  const { data: tabCounts } = useQuery<Record<'pending' | 'approved' | 'rejected', number>>({
    queryKey: ['archer-change-requests-counts', userId],
    enabled: !!userId,
    queryFn: async () => {
      const [p, a, r] = await Promise.all([
        supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('user_id', userId!).eq('status', 'pending'),
        supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('user_id', userId!).eq('status', 'approved'),
        supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('user_id', userId!).eq('status', 'rejected'),
      ])
      return { pending: p.count ?? 0, approved: a.count ?? 0, rejected: r.count ?? 0 }
    },
  })

  // ── Derived ──────────────────────────────────────────────────

  const filteredPlds = filterStateId
    ? allPlds.filter(p => p.state_id === filterStateId)
    : allPlds

  const filteredSchools = allSchools
    .filter(s => !filterStateId || s.state_id === filterStateId)
    .filter(s => !filterPldId   || s.pld_id   === filterPldId)

  function getCurrentValue(key: string): string {
    if (!fullProfile) return ''
    switch (key) {
      case 'full_name':     return fullProfile.name ?? ''
      case 'school':        return orgData?.school ? `${fullProfile.school_id}|${orgData.school.name}` : ''
      case 'state':         return orgData?.state  ? `${fullProfile.state_id}|${orgData.state.name} (${orgData.state.code})` : ''
      case 'pld':           return orgData?.pld    ? `${fullProfile.pld_id}|${orgData.pld.name}` : ''
      case 'age_group':     return archerExt?.age_group ?? ''
      case 'bow_category':  return fullProfile.bow_category ?? archerExt?.bow_category ?? ''
      case 'date_of_birth': return fullProfile.date_of_birth ?? ''
      case 'phone':         return fullProfile.phone ?? ''
      default:              return ''
    }
  }

  const currentValue = getCurrentValue(fieldKey)

  // ── Handlers ─────────────────────────────────────────────────

  function handleFieldChange(key: string) {
    setFieldKey(key)
    setRequestedValue('')
    setFilterStateId('')
    setFilterPldId('')
  }

  function handleFilterState(id: string) {
    setFilterStateId(id)
    setFilterPldId('')
    setRequestedValue('')
  }

  function handleFilterPld(id: string) {
    setFilterPldId(id)
    setRequestedValue('')
  }

  function resetForm() {
    setFieldKey('')
    setRequestedValue('')
    setReason('')
    setProofFile(null)
    setFilterStateId('')
    setFilterPldId('')
  }

  async function handleSubmit() {
    if (!fieldKey)              { err(t('crPage.errNoField'));   return }
    if (!requestedValue.trim()) { err(t('crPage.errNoValue'));   return }
    if (!reason.trim())         { err(t('crPage.errNoReason'));  return }
    // Images are auto-compressed at submit; only PDFs (uploaded as-is) need
    // the hard size gate up front.
    if (proofFile && proofFile.type === 'application/pdf' && proofFile.size > 10 * 1024 * 1024) {
      err(t('crPage.errFileTooLarge')); return
    }

    if (fieldKey !== 'other' && requestedValue.trim() === currentValue.trim()) {
      err(t('crPage.errSameValue'))
      return
    }

    const selectedField = CHANGEABLE_FIELDS.find(f => f.key === fieldKey)
    setSubmitting(true)
    try {
      let fileBucket: string | null = null
      let filePath:   string | null = null

      if (proofFile) {
        // Photos are auto-compressed; PDFs pass through unchanged.
        const upload      = await compressImage(proofFile, compressPresets.proofPhoto)
        const safeName    = upload.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const storagePath = `${userId}/${Date.now()}-${safeName}`
        const { error: uploadErr } = await supabase.storage
          .from('profile-change-requests')
          .upload(storagePath, upload)
        if (uploadErr) throw uploadErr
        fileBucket = 'profile-change-requests'
        filePath   = storagePath
      }

      const { data: inserted, error: insertErr } = await supabase
        .from('profile_change_requests')
        .insert({
          user_id:                userId,
          requested_by:           userId,
          field_key:              fieldKey,
          field_label:            selectedField?.label ?? fieldKey,
          current_value:          currentValue.trim() || null,
          requested_value:        requestedValue.trim(),
          reason:                 reason.trim(),
          status:                 'pending',
          supporting_file_bucket: fileBucket,
          supporting_file_path:   filePath,
        })
        .select('id')
        .single()

      if (insertErr) throw insertErr

      writeAuditLog(
        userId!,
        'archer.profile_change_requested',
        'profile_change_request',
        (inserted as unknown as { id: string }).id,
        { field_key: fieldKey, field_label: selectedField?.label },
      )

      ok(t('crPage.submitted'))
      resetForm()
      queryClient.invalidateQueries({ queryKey: ['archer-change-requests', userId] })
      queryClient.invalidateQueries({ queryKey: ['archer-change-requests-counts', userId] })
      setTab('pending')
    } catch (e: unknown) {
      err(t('crPage.submitFailed'), (e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleWithdraw() {
    if (!withdrawId) return
    setWithdrawing(true)
    try {
      const { error } = await supabase
        .from('profile_change_requests')
        .update({ status: 'withdrawn' })
        .eq('id', withdrawId)
        .eq('user_id', userId!)
        .eq('status', 'pending')
      if (error) throw error

      writeAuditLog(userId!, 'archer.profile_change_withdrawn', 'profile_change_request', withdrawId)
      ok(t('crPage.withdrawn'))
      setWithdrawId(null)
      queryClient.invalidateQueries({ queryKey: ['archer-change-requests', userId] })
      queryClient.invalidateQueries({ queryKey: ['archer-change-requests-counts', userId] })
    } catch (e: unknown) {
      err(t('crPage.withdrawFailed'), (e as Error).message)
    } finally {
      setWithdrawing(false)
    }
  }

  async function viewDoc(bucket: string, path: string) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600)
    if (error || !data?.signedUrl) { err(t('crPage.docLoadFailed')); return }
    window.open(data.signedUrl, '_blank')
  }

  if (!profile) return null

  const tabs: { key: CRTabFilter; label: string; count?: number }[] = [
    { key: 'pending',  label: t('status.pending'),  count: tabCounts?.pending  },
    { key: 'approved', label: t('status.approved'), count: tabCounts?.approved },
    { key: 'rejected', label: t('status.rejected'), count: tabCounts?.rejected },
    { key: 'all',      label: t('common.all') },
  ]

  // ── Render ───────────────────────────────────────────────────

  return (
    <PageWrapper>
      <PageHead
        title={t('archerProfile.changeRequest')}
        description={t('crPage.description')}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/archer/profile')}
            icon={<ChevronLeftIcon />}
          >
            {t('crPage.backToProfile')}
          </Button>
        }
      />

      {/* ── Top section: Profile summary + Form ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

        {/* A. Current Profile Summary */}
        <SectionCard title={t('crPage.currentProfile')}>
          {loadingProfile ? (
            <div className="py-8 text-center text-text-faint text-sm">{t('common.loading')}</div>
          ) : !fullProfile ? (
            <EmptyState title={t('archerProfile.notFound')} description={t('crPage.contactAdmin')} />
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar
                  name={fullProfile.name}
                  src={fullProfile.avatar_url ?? undefined}
                  size="lg"
                  className="!w-12 !h-12 flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-[15px] truncate">{fullProfile.name}</p>
                  {fullProfile.archer_id && (
                    <p className="font-mono text-xs text-primary tracking-wider mt-0.5">{fullProfile.archer_id}</p>
                  )}
                  <div className="flex gap-1.5 mt-1 flex-wrap">
                    <AccountStatusBadge status={fullProfile.status as AccountStatus} />
                    {coachLink && (
                      <Badge
                        variant={
                          coachLink.status === 'active'  ? 'success'  :
                          coachLink.status === 'pending' ? 'warning'  : 'neutral'
                        }
                        dot
                      >
                        {t('roles.coach')} {t(`status.${coachLink.status}`)}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-3 pt-1">
                <ProfileField label={t('common.email')}         value={fullProfile.email} />
                <ProfileField label={t('common.phone')}         value={fullProfile.phone} />
                <ProfileField label={t('common.school')}        value={orgData?.school?.name} />
                <ProfileField label={t('common.pld')}           value={orgData?.pld?.name} />
                <ProfileField
                  label={t('common.state')}
                  value={orgData?.state ? `${orgData.state.name} (${orgData.state.code})` : undefined}
                />
                <ProfileField label={t('leaderboardPage.bow')}           value={fullProfile.bow_category ?? archerExt?.bow_category ?? undefined} />
                <ProfileField label={t('common.ageGroup')}     value={archerExt?.age_group?.toUpperCase() ?? undefined} />
                <ProfileField
                  label={t('archerProfile.dateOfBirth')}
                  value={fullProfile.date_of_birth ? formatDate(fullProfile.date_of_birth) : undefined}
                />
              </div>

              <p className="text-[11px] text-text-faint pt-1">
                {t('crPage.lockedHint')}
              </p>
            </div>
          )}
        </SectionCard>

        {/* B. New Request Form */}
        <SectionCard title={t('crPage.newRequestForm')}>
          <div className="space-y-4">

            <Select
              label={t('crPage.fieldToChange')}
              placeholder={t('crPage.chooseField')}
              value={fieldKey}
              onChange={(e) => handleFieldChange(e.target.value)}
              options={CHANGEABLE_FIELDS.map(f => ({ value: f.key, label: t(f.labelKey) }))}
            />

            {/* Current value preview */}
            {fieldKey && fieldKey !== 'other' && (
              <div className="space-y-1.5">
                <p className="text-[12px] font-semibold text-text-dim">{t('crPage.currentValue')}</p>
                <div className="field bg-section text-text-dim min-h-[38px] flex items-center cursor-default select-all">
                  {displayValue(currentValue) !== '—'
                    ? <span>{displayValue(currentValue)}</span>
                    : <span className="italic text-text-faint">{t('archerProfile.notSet')}</span>
                  }
                </div>
              </div>
            )}

            {/* Requested value — dynamic per field */}
            {fieldKey && (
              <RequestedValueInput
                fieldKey={fieldKey}
                requestedValue={requestedValue}
                setRequestedValue={setRequestedValue}
                filterStateId={filterStateId}
                filterPldId={filterPldId}
                onFilterState={handleFilterState}
                onFilterPld={handleFilterPld}
                states={states}
                filteredPlds={filteredPlds}
                filteredSchools={filteredSchools}
              />
            )}

            <Textarea
              label={t('crPage.reasonForChange')}
              placeholder={t('crPage.reasonPlaceholder')}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minRows={3}
            />

            {/* File attachment */}
            <div className="space-y-1.5">
              <p className="text-[12px] font-semibold text-text-dim">
                {t('crPage.supportingDoc')}{' '}
                <span className="font-normal text-text-faint">({t('common.optional').toLowerCase()})</span>
              </p>
              <label className="flex items-center gap-3 px-4 py-3 rounded-[var(--r)] border border-dashed border-line-strong bg-section cursor-pointer hover:bg-surface-soft transition-colors">
                <PaperclipIcon />
                <span className="text-sm text-text-dim truncate">
                  {proofFile ? proofFile.name : t('crPage.attachFile')}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".png,.jpg,.jpeg,.pdf"
                  onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                />
              </label>
              {proofFile && (
                <button
                  type="button"
                  onClick={() => setProofFile(null)}
                  className="text-xs text-danger hover:underline ml-1"
                >
                  {t('crPage.removeFile')}
                </button>
              )}
              <p className="text-[11px] text-text-faint">{t('crPage.fileTypes')}</p>
            </div>

            <Button
              variant="primary"
              className="w-full"
              loading={submitting}
              onClick={handleSubmit}
              disabled={!fieldKey || !requestedValue.trim() || !reason.trim()}
            >
              {t('crPage.submitRequest')}
            </Button>
          </div>
        </SectionCard>
      </div>

      {/* C. My Change Requests History */}
      <SectionCard>
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-[15.5px] font-display font-semibold">{t('crPage.myRequests')}</h3>
          <div className="flex gap-1 flex-wrap">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={[
                  'text-xs px-3 py-1.5 rounded-[8px] font-semibold transition-colors flex items-center gap-1.5',
                  tab === t.key
                    ? 'bg-primary text-primary-on'
                    : 'bg-section text-text-dim hover:bg-surface-soft',
                ].join(' ')}
              >
                {t.label}
                {typeof t.count === 'number' && t.count > 0 && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                    tab === t.key ? 'bg-primary-hover' : 'bg-surface-soft'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {loadingRequests ? (
          <div className="py-10 text-center text-text-faint text-sm">{t('common.loading')}</div>
        ) : changeRequests.length === 0 ? (
          <EmptyState
            title={t('crPage.noRequests')}
            description={
              tab === 'all'
                ? t('crPage.noRequestsAll')
                : t('crPage.noRequestsFiltered')
            }
          />
        ) : (
          <div className="space-y-3">
            {changeRequests.map(req => (
              <ChangeRequestCard
                key={req.id}
                req={req}
                onWithdraw={() => setWithdrawId(req.id)}
                onViewDoc={viewDoc}
              />
            ))}
          </div>
        )}
      </SectionCard>

      <ConfirmDialog
        open={!!withdrawId}
        onClose={() => setWithdrawId(null)}
        onConfirm={handleWithdraw}
        title={t('crPage.withdrawTitle')}
        message={t('crPage.withdrawMessage')}
        confirmLabel={t('crPage.withdrawConfirm')}
        destructive
        loading={withdrawing}
      />
    </PageWrapper>
  )
}

// ── RequestedValueInput ────────────────────────────────────────

interface RVIProps {
  fieldKey: string
  requestedValue: string
  setRequestedValue: (v: string) => void
  filterStateId: string
  filterPldId: string
  onFilterState: (id: string) => void
  onFilterPld: (id: string) => void
  states: StateItem[]
  filteredPlds: PldItem[]
  filteredSchools: SchoolItem[]
}

function RequestedValueInput({
  fieldKey, requestedValue, setRequestedValue,
  filterStateId, filterPldId, onFilterState, onFilterPld,
  states, filteredPlds, filteredSchools,
}: RVIProps) {
  const { t } = useLanguage()

  if (fieldKey === 'state') {
    return (
      <Select
        label={t('crPage.newState')}
        placeholder={t('crPage.selectState')}
        value={requestedValue.split('|')[0]}
        onChange={(e) => {
          const s = states.find(x => x.id === e.target.value)
          setRequestedValue(s ? `${s.id}|${s.name} (${s.code})` : '')
        }}
        options={states.map(s => ({ value: s.id, label: `${s.name} (${s.code})` }))}
      />
    )
  }

  if (fieldKey === 'pld') {
    return (
      <div className="space-y-3">
        <Select
          label={t('crPage.filterByState')}
          placeholder={t('common.allStates')}
          value={filterStateId}
          onChange={(e) => onFilterState(e.target.value)}
          options={states.map(s => ({ value: s.id, label: s.name }))}
        />
        <Select
          label={t('crPage.newPld')}
          placeholder={t('crPage.selectPld')}
          value={requestedValue.split('|')[0]}
          onChange={(e) => {
            const p = filteredPlds.find(x => x.id === e.target.value)
            setRequestedValue(p ? `${p.id}|${p.name}` : '')
          }}
          options={filteredPlds.map(p => ({ value: p.id, label: p.name }))}
        />
      </div>
    )
  }

  if (fieldKey === 'school') {
    return (
      <div className="space-y-3">
        <Select
          label={t('crPage.filterByState')}
          placeholder={t('common.allStates')}
          value={filterStateId}
          onChange={(e) => onFilterState(e.target.value)}
          options={states.map(s => ({ value: s.id, label: s.name }))}
        />
        <Select
          label={t('crPage.filterByPld')}
          placeholder={t('common.allPlds')}
          value={filterPldId}
          onChange={(e) => onFilterPld(e.target.value)}
          options={filteredPlds.map(p => ({ value: p.id, label: p.name }))}
        />
        <Select
          label={t('crPage.newSchool')}
          placeholder={filteredSchools.length > 0 ? t('crPage.selectSchool') : t('crPage.filterFirst')}
          value={requestedValue.split('|')[0]}
          onChange={(e) => {
            const s = filteredSchools.find(x => x.id === e.target.value)
            setRequestedValue(s ? `${s.id}|${s.name}` : '')
          }}
          options={filteredSchools.map(s => ({ value: s.id, label: s.name }))}
        />
      </div>
    )
  }

  if (fieldKey === 'age_group') {
    return (
      <Select
        label={t('crPage.newAgeGroup')}
        placeholder={t('crPage.selectAgeGroup')}
        value={requestedValue}
        onChange={(e) => setRequestedValue(e.target.value)}
        options={AGE_GROUP_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
      />
    )
  }

  if (fieldKey === 'bow_category') {
    return (
      <Select
        label={t('crPage.newBowCategory')}
        placeholder={t('crPage.selectBowCategory')}
        value={requestedValue}
        onChange={(e) => setRequestedValue(e.target.value)}
        options={BOW_CATEGORY_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
      />
    )
  }

  if (fieldKey === 'date_of_birth') {
    return (
      <Input
        label={t('crPage.newDob')}
        type="date"
        value={requestedValue}
        onChange={(e) => setRequestedValue(e.target.value)}
      />
    )
  }

  if (fieldKey === 'phone') {
    return (
      <Input
        label={t('crPage.newPhone')}
        type="tel"
        placeholder="+60 12-345-6789"
        value={requestedValue}
        onChange={(e) => setRequestedValue(e.target.value)}
      />
    )
  }

  if (fieldKey === 'other') {
    return (
      <Textarea
        label={t('crPage.describeChange')}
        placeholder={t('crPage.describeChangePlaceholder')}
        value={requestedValue}
        onChange={(e) => setRequestedValue(e.target.value)}
        minRows={3}
      />
    )
  }

  // Default: text input (full_name)
  return (
    <Input
      label={t('crPage.newValue')}
      type="text"
      placeholder={t('crPage.newValuePlaceholder')}
      value={requestedValue}
      onChange={(e) => setRequestedValue(e.target.value)}
    />
  )
}

// ── ChangeRequestCard ──────────────────────────────────────────

interface CardProps {
  req: ChangeRequest
  onWithdraw: () => void
  onViewDoc: (bucket: string, path: string) => Promise<void>
}

function ChangeRequestCard({ req, onWithdraw, onViewDoc }: CardProps) {
  const { t } = useLanguage()
  return (
    <div className="rounded-[var(--r)] border border-line bg-surface-soft p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div>
          <p className="text-sm font-semibold">{req.field_label}</p>
          <p className="text-xs text-text-faint mt-0.5">{formatDate(req.created_at)}</p>
        </div>
        <Badge variant={CR_STATUS_VARIANT[req.status]} dot>
          {t(`status.${req.status}`)}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <p className="text-[11px] text-text-faint uppercase tracking-wide mb-0.5">{t('crPage.currentValue')}</p>
          <p className="text-sm text-text-dim">{displayValue(req.current_value)}</p>
        </div>
        <div>
          <p className="text-[11px] text-text-faint uppercase tracking-wide mb-0.5">{t('crPage.requestedValue')}</p>
          <p className="text-sm font-medium">{displayValue(req.requested_value)}</p>
        </div>
      </div>

      {req.reason && (
        <div className="mb-3">
          <p className="text-[11px] text-text-faint uppercase tracking-wide mb-0.5">{t('common.reason')}</p>
          <p className="text-sm text-text-dim">{req.reason}</p>
        </div>
      )}

      {req.reviewed_at && (
        <p className="text-xs text-text-faint mb-2">{t('crPage.reviewed')} {formatDate(req.reviewed_at)}</p>
      )}

      {(req.review_note || req.rejection_reason) && (
        <div className={`p-3 rounded-[var(--r)] text-sm mb-3 ${
          req.status === 'rejected' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'
        }`}>
          <span className="font-semibold">{t('crPage.adminNote')}: </span>
          {req.review_note ?? req.rejection_reason}
        </div>
      )}

      <div className="flex gap-2 flex-wrap mt-1">
        {req.supporting_file_bucket && req.supporting_file_path && (
          <Button
            variant="ghost"
            size="sm"
            icon={<PaperclipIcon />}
            onClick={() => onViewDoc(req.supporting_file_bucket!, req.supporting_file_path!)}
          >
            {t('crPage.viewDocument')}
          </Button>
        )}
        {req.status === 'pending' && (
          <Button variant="danger" size="sm" onClick={onWithdraw}>
            {t('common.withdraw')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── ProfileField ───────────────────────────────────────────────

function ProfileField({ label, value }: { label: string; value?: string | null }) {
  const { t } = useLanguage()
  return (
    <div>
      <p className="text-[11px] text-text-faint uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${value ? 'text-text' : 'text-text-faint italic'}`}>
        {value ?? t('archerProfile.notSet')}
      </p>
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────────

function ChevronLeftIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

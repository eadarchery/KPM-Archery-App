import { useState, useRef, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, StatCard, Modal, Input, Select, EmptyState, useToast } from '@/components/ui'
import { Textarea } from '@/components/ui/Input'
import { Avatar } from '@/components/ui/Avatar'
import { AccountStatusBadge, RoleBadge } from '@/components/ui/Badge'
import { PasswordChangeSection } from '@/components/auth/PasswordChangeSection'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'
import { timeAgo } from '@/utils/dates'
import { canViewCertifications, canEditOwnProfile } from '@/lib/permissions'
import {
  getMyCoachProfile, getMyLinkedArchersSummary, getMyCertificationSummary,
  updateMyCoachProfile, uploadCoachProfilePhoto, getCoachProfileCompletion,
  type CoachProfilePayload,
} from '@/services/coachProfile'

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

// Values are STORED (English) — labels render translated.
const COACHING_LEVELS = [
  { value: '',                 labelKey: 'certPage.selectLevel' },
  { value: 'Beginner Coach',   labelKey: 'coachProfile.levelBeginner' },
  { value: 'School Coach',     labelKey: 'certPage.levelSchool' },
  { value: 'Club Coach',       labelKey: 'coachProfile.levelClub' },
  { value: 'State Coach',      labelKey: 'certPage.levelState' },
  { value: 'National Coach',   labelKey: 'certPage.levelNational' },
  { value: 'Other',            labelKey: 'crFields.other' },
]

// Stored English values → translation keys for chip/badge display.
const SPECIALTY_KEY: Record<string, string> = {
  'Beginner development':    'coachProfile.spBeginnerDev',
  'School team':             'coachProfile.spSchoolTeam',
  'Recurve':                 'bows.recurve',
  'Compound':                'bows.compound',
  'Barebow':                 'bows.barebow',
  'Traditional':             'bows.traditional',
  'Tournament preparation':  'coachProfile.spTournamentPrep',
  'Technique correction':    'coachProfile.spTechnique',
  'Equipment setup':         'coachProfile.spEquipment',
}
const SPECIALTIES = Object.keys(SPECIALTY_KEY)

const BOW_CATEGORIES = ['Recurve', 'Compound', 'Barebow', 'Traditional']

const LINK_STATUS_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success', pending: 'warning', rejected: 'danger', inactive: 'neutral',
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── SUB-COMPONENTS ────────────────────────────────────────────────────────

function CompletionBar({ pct }: { pct: number }) {
  const color = pct === 100 ? 'var(--color-success, #16a34a)' : 'var(--primary)'
  return (
    <div className="w-full bg-section rounded-full h-2 border border-line overflow-hidden">
      <div
        className="h-2 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

function ChipGroup({
  options, selected, onChange,
}: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const { t } = useLanguage()
  const toggle = (item: string) => {
    onChange(selected.includes(item) ? selected.filter(s => s !== item) : [...selected, item])
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(o => (
        <button
          key={o}
          type="button"
          onClick={() => toggle(o)}
          className={cn(
            'px-3 py-1 text-xs rounded-full border transition-all cursor-pointer',
            selected.includes(o)
              ? 'bg-primary text-primary-on border-transparent'
              : 'border-line text-text-dim hover:border-line-strong',
          )}
        >
          {SPECIALTY_KEY[o] ? t(SPECIALTY_KEY[o]) : o}
        </button>
      ))}
    </div>
  )
}

// ─── EDIT FORM STATE ───────────────────────────────────────────────────────

interface EditForm {
  phone: string
  bio: string
  experience_years: string
  coaching_level: string
  specialization: string[]
  preferred_bow_categories: string[]
}

const emptyForm = (): EditForm => ({
  phone: '', bio: '', experience_years: '', coaching_level: '',
  specialization: [], preferred_bow_categories: [],
})

// ─── PAGE ──────────────────────────────────────────────────────────────────

export default function CoachProfilePage() {
  const { profile }  = useAuth()
  const { t }        = useLanguage()
  const navigate     = useNavigate()
  const { ok, err }  = useToast()
  const qc           = useQueryClient()
  const photoInputRef = useRef<HTMLInputElement>(null)

  const canEdit  = canEditOwnProfile(profile?.role)
  const canCerts = canViewCertifications(profile?.role)

  const [editOpen, setEditOpen]   = useState(false)
  const [form, setForm]           = useState<EditForm>(emptyForm())
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof EditForm, string>>>({})
  const [uploading, setUploading] = useState(false)

  // ── data ──
  const { data: fullProfile, isLoading: loadingProfile } = useQuery({
    queryKey: ['my-coach-profile'],
    queryFn: getMyCoachProfile,
    enabled: !!profile?.id,
  })

  const { data: archerSummary } = useQuery({
    queryKey: ['my-linked-archers-summary'],
    queryFn: getMyLinkedArchersSummary,
    enabled: !!profile?.id,
  })

  const { data: certSummary } = useQuery({
    queryKey: ['my-cert-summary'],
    queryFn: getMyCertificationSummary,
    enabled: !!profile?.id && canCerts,
  })

  const completion = fullProfile
    ? getCoachProfileCompletion(fullProfile, certSummary?.total ?? 0)
    : null

  // ── mutations ──
  const saveMut = useMutation({
    mutationFn: async () => {
      const yrs = form.experience_years.trim()
      const payload: CoachProfilePayload = {
        phone:                    form.phone.trim() || null,
        bio:                      form.bio.trim()   || null,
        experience_years:         yrs ? parseInt(yrs, 10) : null,
        coaching_level:           form.coaching_level || null,
        specialization:           form.specialization,
        preferred_bow_categories: form.preferred_bow_categories,
      }
      await updateMyCoachProfile(payload)
    },
    onSuccess: () => {
      ok(t('coachProfile.updated'))
      qc.invalidateQueries({ queryKey: ['my-coach-profile'] })
      setEditOpen(false)
    },
    onError: (e: Error) => err(e.message),
  })

  // ── avatar upload ──
  async function handlePhotoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      err(t('coachProfile.photoType'))
      return
    }
    // Generous sanity cap only — the service auto-compresses to a 512px JPEG,
    // so a normal multi-MB camera photo is fine to accept here.
    if (file.size > 20 * 1024 * 1024) {
      err(t('coachProfile.photoSize'))
      return
    }
    setUploading(true)
    try {
      await uploadCoachProfilePhoto(file)
      qc.invalidateQueries({ queryKey: ['my-coach-profile'] })
      ok(t('coachProfile.photoUpdated'))
    } catch (e) {
      err((e as Error).message)
    } finally {
      setUploading(false)
      if (photoInputRef.current) photoInputRef.current.value = ''
    }
  }

  // ── open edit modal ──
  function openEdit() {
    if (!fullProfile) return
    const { core, ext } = fullProfile
    setForm({
      phone:                    core.phone ?? '',
      bio:                      ext?.bio   ?? '',
      experience_years:         ext?.experience_years != null ? String(ext.experience_years) : '',
      coaching_level:           ext?.coaching_level ?? '',
      specialization:           ext?.specialization ?? [],
      preferred_bow_categories: ext?.preferred_bow_categories ?? [],
    })
    setFormErrors({})
    setEditOpen(true)
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof EditForm, string>> = {}
    const yrs = form.experience_years.trim()
    if (yrs && (isNaN(Number(yrs)) || Number(yrs) < 0)) {
      errors.experience_years = t('coachProfile.errYears')
    }
    if (form.bio.length > 1000) {
      errors.bio = t('coachProfile.errBio')
    }
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  function handleSave() {
    if (!validate()) return
    saveMut.mutate()
  }

  // ── render ──
  const core = fullProfile?.core
  const ext  = fullProfile?.ext

  return (
    <PageWrapper>
      <PageHead
        title={t('coachProfile.title')}
        description={t('coachProfile.description')}
        action={
          canEdit ? <Button onClick={openEdit} disabled={!fullProfile}>{t('coachProfile.editProfile')}</Button> : undefined
        }
      />

      {loadingProfile ? (
        <p className="text-sm text-text-dim text-center py-10">{t('common.loading')}</p>
      ) : !core ? (
        <EmptyState title={t('archerProfile.notFound')} description={t('coachProfile.loadFailed')} />
      ) : (
        <>
          {/* ── Summary card ── */}
          <SectionCard className="mb-4">
            <div className="flex flex-wrap items-start gap-4">
              {/* Avatar with upload affordance */}
              <div className="relative flex-shrink-0">
                <Avatar
                  name={core.name}
                  src={core.avatar_url ?? undefined}
                  size="lg"
                  className="!w-20 !h-20 !text-2xl"
                />
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => photoInputRef.current?.click()}
                      disabled={uploading}
                      aria-label={t('coachProfile.changePhoto')}
                      className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-surface border-2 border-line flex items-center justify-center text-text-dim hover:text-text hover:border-line-strong transition-all"
                      title={t('coachProfile.changePhoto')}
                    >
                      <CameraIcon />
                    </button>
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={handlePhotoChange}
                    />
                  </>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <h3 className="text-xl font-display font-semibold">{core.name}</h3>
                    <p className="text-sm text-text-dim mt-0.5">{core.email}</p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <AccountStatusBadge status={core.status as 'approved' | 'pending' | 'rejected' | 'suspended' | 'inactive'} />
                    <RoleBadge role="coach" />
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-dim">
                  {fullProfile.state_name && (
                    <span>{fullProfile.state_name}{fullProfile.state_code && ` (${fullProfile.state_code})`}</span>
                  )}
                  {fullProfile.pld_name    && <span>{fullProfile.pld_name}</span>}
                  {fullProfile.school_name && <span className="font-medium text-text">{fullProfile.school_name}</span>}
                  {ext?.coaching_level     && <span>{ext.coaching_level}</span>}
                  {ext?.experience_years != null && (
                    <span>{t('coachProfile.yearsExperience', { years: ext.experience_years })}</span>
                  )}
                </div>

                {/* Completion bar */}
                {completion && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-text-faint">{t('coachProfile.completion')}</span>
                      <span className={cn('text-xs font-semibold', completion.pct === 100 ? 'text-success' : 'text-text')}>
                        {completion.pct}%
                      </span>
                    </div>
                    <CompletionBar pct={completion.pct} />
                    {completion.missing.length > 0 && (
                      <p className="text-xs text-text-faint mt-1">
                        {t('coachProfile.missing')}: {completion.missing.join(', ')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </SectionCard>

          {/* ── Stat cards ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard label={t('coachDash.linkedArchers')} value={archerSummary?.total ?? '—'} accent />
            <StatCard label={t('coachDash.activeArchers')}  value={archerSummary?.active ?? '—'} />
            {canCerts && <>
              <StatCard label={t('nav.certifications')}   value={certSummary?.total    ?? '—'} />
              <StatCard label={t('coachProfile.approvedCerts')}   value={certSummary?.approved ?? '—'} />
            </>}
            {ext?.experience_years != null && (
              <StatCard label={t('coachProfile.experienceYrs')}  value={ext.experience_years} />
            )}
            {completion && (
              <StatCard label={t('coachProfile.completion')} value={`${completion.pct}%`} />
            )}
          </div>

          {/* ── Personal info ── */}
          <SectionCard
            title={t('coachProfile.personalInfo')}
            className="mb-4"
            action={canEdit ? <Button size="sm" variant="outline" onClick={openEdit}>{t('common.edit')}</Button> : undefined}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <InfoRow label={t('crFields.fullName')}  value={core.name} />
              <InfoRow label={t('common.email')}      value={core.email} hint={t('coachProfile.emailReadOnly')} />
              <InfoRow label={t('common.phone')}      value={core.phone ?? '—'} />
              <InfoRow label={t('archerProfile.gender')}     value={core.gender ? core.gender.replace(/_/g, ' ') : '—'} />
              <InfoRow label={t('coachProfile.memberSince')} value={fmtDate(core.created_at)} />
            </div>
            {ext?.bio && (
              <div className="mt-4">
                <p className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-1.5">{t('coachProfile.bio')}</p>
                <p className="text-sm text-text leading-relaxed whitespace-pre-wrap">{ext.bio}</p>
              </div>
            )}
          </SectionCard>

          {/* ── Coaching information ── */}
          <SectionCard
            title={t('coachProfile.coachingDetails')}
            className="mb-4"
            action={canEdit ? <Button size="sm" variant="outline" onClick={openEdit}>{t('common.edit')}</Button> : undefined}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <InfoRow label={t('coachProfile.coachingLevel')}     value={ext?.coaching_level ?? '—'} />
              <InfoRow label={t('coachProfile.experience')}
                value={ext?.experience_years != null ? t('coachProfile.yearsCount', { years: ext.experience_years }) : '—'} />
              <InfoRow label={t('coachProfile.certLevel')} value={ext?.certification_level ?? '—'} />
              <InfoRow label={t('coachProfile.coachCode')}          value={ext?.coach_code ?? '—'} />
            </div>
            {(ext?.specialization?.length ?? 0) > 0 && (
              <div className="mt-4">
                <p className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-1.5">{t('coachProfile.specialties')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ext!.specialization!.map(s => <Badge key={s} variant="primary">{SPECIALTY_KEY[s] ? t(SPECIALTY_KEY[s]) : s}</Badge>)}
                </div>
              </div>
            )}
            {(ext?.preferred_bow_categories?.length ?? 0) > 0 && (
              <div className="mt-3">
                <p className="text-[12px] font-semibold text-text-dim uppercase tracking-wider mb-1.5">{t('coachProfile.preferredBows')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ext!.preferred_bow_categories!.map(b => <Badge key={b} variant="neutral">{SPECIALTY_KEY[b] ? t(SPECIALTY_KEY[b]) : b}</Badge>)}
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── Organisation ── */}
          <SectionCard title={t('coachProfile.orgAssignment')} className="mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <InfoRow label={t('common.state')}  value={fullProfile.state_name  ?? '—'} />
              <InfoRow label={t('common.pld')}    value={fullProfile.pld_name    ?? '—'} />
              <InfoRow label={t('common.school')} value={fullProfile.school_name ?? '—'} />
            </div>
            <p className="mt-3 text-xs text-text-faint border-t border-line pt-3">
              {t('coachProfile.orgManagedBy')}
            </p>
          </SectionCard>

          {/* ── Certification summary ── */}
          {canCerts && (
            <SectionCard
              title={t('nav.certifications')}
              className="mb-4"
              action={
                <Button size="sm" variant="outline" onClick={() => navigate('/coach/certifications')}>
                  {t('common.viewAll')}
                </Button>
              }
            >
              {certSummary ? (
                certSummary.total === 0 ? (
                  <EmptyState
                    title={t('coachProfile.noCerts')}
                    description={t('coachProfile.noCertsHint')}
                    action={<Button size="sm" onClick={() => navigate('/coach/certifications')}>{t('certPage.uploadCert')}</Button>}
                  />
                ) : (
                  <div className="flex flex-wrap gap-3 text-sm">
                    <div className="flex-1 min-w-[120px] p-3 rounded-[var(--r-md)] bg-section border border-line text-center">
                      <div className="font-display font-semibold text-2xl">{certSummary.total}</div>
                      <div className="text-xs text-text-faint mt-0.5">{t('common.total')}</div>
                    </div>
                    <div className="flex-1 min-w-[120px] p-3 rounded-[var(--r-md)] bg-section border border-line text-center">
                      <div className="font-display font-semibold text-2xl text-success">{certSummary.approved}</div>
                      <div className="text-xs text-text-faint mt-0.5">{t('status.approved')}</div>
                    </div>
                    <div className="flex-1 min-w-[120px] p-3 rounded-[var(--r-md)] bg-section border border-line text-center">
                      <div className="font-display font-semibold text-2xl text-warning">{certSummary.pending}</div>
                      <div className="text-xs text-text-faint mt-0.5">{t('status.pending')}</div>
                    </div>
                    {certSummary.rejected > 0 && (
                      <div className="flex-1 min-w-[120px] p-3 rounded-[var(--r-md)] bg-section border border-line text-center">
                        <div className="font-display font-semibold text-2xl text-danger">{certSummary.rejected}</div>
                        <div className="text-xs text-text-faint mt-0.5">{t('status.rejected')}</div>
                      </div>
                    )}
                  </div>
                )
              ) : (
                <p className="text-sm text-text-dim">{t('common.loading')}</p>
              )}
            </SectionCard>
          )}

          {/* ── Linked archers ── */}
          <SectionCard
            title={t('coachDash.linkedArchers')}
            className="mb-4"
            action={
              <Button size="sm" variant="outline" onClick={() => navigate('/coach/archers')}>
                {t('common.viewAll')}
              </Button>
            }
          >
            {!archerSummary ? (
              <p className="text-sm text-text-dim">{t('common.loading')}</p>
            ) : archerSummary.total === 0 ? (
              <EmptyState
                title={t('coachDash.noLinkedYet')}
                description={t('coachProfile.linksAppearHere')}
                action={<Button size="sm" onClick={() => navigate('/coach/archers')}>{t('coachProfile.goToArchers')}</Button>}
              />
            ) : (
              <>
                <div className="space-y-2">
                  {archerSummary.recent.map(a => (
                    <div key={a.link_id} className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{a.name}</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-dim mt-0.5">
                          {a.school_name && <span>{a.school_name}</span>}
                          {a.bow_category && <span>{a.bow_category}</span>}
                          <span className="text-text-faint">{t('common.linked')} {timeAgo(a.linked_at)}</span>
                        </div>
                      </div>
                      <Badge variant={LINK_STATUS_VARIANT[a.status] ?? 'neutral'}>
                        {t(`status.${a.status}`)}
                      </Badge>
                    </div>
                  ))}
                </div>
                {archerSummary.total > archerSummary.recent.length && (
                  <p className="text-xs text-text-faint mt-3">
                    {t('common.showing', { shown: archerSummary.recent.length, total: archerSummary.total })}
                  </p>
                )}
              </>
            )}
          </SectionCard>

          {/* ── Password & Security ── */}
          <PasswordChangeSection className="mb-4" />
        </>
      )}

      {/* ── Edit Modal ── */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title={t('coachProfile.editProfile')}
        width="min(580px,100%)"
      >
        <div className="space-y-4">
          <p className="text-xs text-text-faint -mt-2 mb-1">
            {t('coachProfile.editHint')}
          </p>

          <Input
            label={t('common.phone')}
            value={form.phone}
            onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
            placeholder="e.g. 012-3456789"
            type="tel"
          />

          <Textarea
            label={`${t('coachProfile.bio')} (${form.bio.length}/1000)`}
            value={form.bio}
            onChange={e => setForm(f => ({ ...f, bio: e.target.value }))}
            error={formErrors.bio}
            placeholder={t('coachProfile.bioPlaceholder')}
            maxLength={1000}
            minRows={3}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('coachProfile.experienceYears')}
              value={form.experience_years}
              onChange={e => setForm(f => ({ ...f, experience_years: e.target.value }))}
              error={formErrors.experience_years}
              type="number"
              min="0"
              max="60"
              placeholder="e.g. 5"
            />
            <Select
              label={t('coachProfile.coachingLevel')}
              options={COACHING_LEVELS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
              value={form.coaching_level}
              onChange={e => setForm(f => ({ ...f, coaching_level: e.target.value }))}
            />
          </div>

          <div>
            <p className="text-[12px] font-semibold text-text-dim mb-1.5">{t('coachProfile.specialties')}</p>
            <ChipGroup
              options={SPECIALTIES}
              selected={form.specialization}
              onChange={v => setForm(f => ({ ...f, specialization: v }))}
            />
          </div>

          <div>
            <p className="text-[12px] font-semibold text-text-dim mb-1.5">{t('coachProfile.preferredBows')}</p>
            <ChipGroup
              options={BOW_CATEGORIES}
              selected={form.preferred_bow_categories}
              onChange={v => setForm(f => ({ ...f, preferred_bow_categories: v }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saveMut.isPending}>{t('common.saveChanges')}</Button>
          </div>
        </div>
      </Modal>
    </PageWrapper>
  )
}

// ─── HELPER COMPONENTS ─────────────────────────────────────────────────────

function InfoRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold text-text-faint uppercase tracking-[.05em] mb-0.5">{label}</div>
      <div className="text-text">{value}</div>
      {hint && <div className="text-[11px] text-text-faint mt-0.5">{hint}</div>}
    </div>
  )
}

function CameraIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
      <circle cx="12" cy="13" r="4"/>
    </svg>
  )
}

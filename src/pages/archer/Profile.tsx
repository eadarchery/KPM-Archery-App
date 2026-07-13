import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Avatar } from '@/components/ui/Avatar'
import { Badge, AccountStatusBadge, RoleBadge, SubmissionStatusBadge } from '@/components/ui/Badge'
import { Button, Select } from '@/components/ui'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { useToast } from '@/components/ui/Toast'
import { PasswordChangeSection } from '@/components/auth/PasswordChangeSection'
import { useAuth } from '@/hooks/useAuth'
import { useAuthStore } from '@/store/authStore'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { loadProfile } from '@/services/auth'
import { writeAuditLog } from '@/services/auditLog'
import { formatDate, timeAgo } from '@/utils/dates'
import { scoreDisplay, scorePct } from '@/utils/format'
import { ageSnapshot, competitionYear } from '@/utils/ageGroup'
import type { Role, SubmissionStatus } from '@/types'

// ── Local types ────────────────────────────────────────────────

interface FullProfile {
  id: string
  email: string
  name: string
  age: number | null
  birth_year: number | null
  role: string
  status: string
  rejection_reason: string | null
  approved_at: string | null
  archer_id: string | null
  coach_id: string | null
  school_id: string | null
  pld_id: string | null
  state_id: string | null
  bow_category: string | null
  avatar_url: string | null
  phone: string | null
  date_of_birth: string | null
  gender: string | null
  created_at: string
}

interface ArcherExt {
  profile_id: string
  age_group: string | null
  bow_category: string | null
  dominant_hand: string | null
  draw_length_in: number | null
}

interface CoachRequest {
  link_id: string
  coach_id: string
  coach_name: string | null
  coach_school: string | null
  requested_at: string
}

interface CoachLink {
  id: string
  coach_id: string
  archer_id: string
  status: string
  linked_at: string
  approved_at: string | null
  rejected_at: string | null
  rejection_reason: string | null
  unlinked_at: string | null
}

interface CoachProfile {
  id: string
  name: string
  email: string
}

interface ScoreRow {
  id: string
  date: string
  total_score: number
  max_score: number
  status: SubmissionStatus
  round: { name: string } | { name: string }[] | null
}

type AchievementDef = { name: string; icon: string | null; category: string }

interface AchievementRow {
  id: string
  earned_at: string
  definition: AchievementDef | AchievementDef[] | null
}

// ── Status helpers ─────────────────────────────────────────────

const COACH_LINK_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending:  'warning',
  active:   'success',
  rejected: 'danger',
  inactive: 'neutral',
}

const COACH_LINK_LABEL_KEY: Record<string, string> = {
  pending:  'archerProfile.pendingApproval',
  active:   'status.active',
  rejected: 'status.rejected',
  inactive: 'status.inactive',
}

function CoachLinkBadge({ status }: { status: string }) {
  const { t } = useLanguage()
  const variant = COACH_LINK_VARIANT[status] ?? 'neutral'
  const label   = COACH_LINK_LABEL_KEY[status] ? t(COACH_LINK_LABEL_KEY[status]) : status
  return <Badge variant={variant} dot>{label}</Badge>
}

// ── Main component ─────────────────────────────────────────────

export default function ArcherProfile() {
  const { profile } = useAuth()
  const { t }       = useLanguage()
  const navigate    = useNavigate()
  const { ok, err } = useToast()
  const queryClient = useQueryClient()
  const setProfile  = useAuthStore((s) => s.setProfile)
  const location    = useLocation()
  // No ref needed — use id to find canvas for download

  const userId = profile?.id

  // Deep-link from the "Profile Editor" account-menu item → scroll to the editor.
  useEffect(() => {
    if (location.hash !== '#profile-editor') return
    const el = document.getElementById('profile-editor')
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
  }, [location.hash])

  // ── 1. Full profile ──────────────────────────────────────────
  const { data: fullProfile, isLoading: loadingProfile } = useQuery<FullProfile | null>({
    queryKey: ['archer-full-profile', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select([
          'id', 'email', 'name', 'age', 'birth_year', 'role', 'status',
          'rejection_reason', 'approved_at',
          'archer_id', 'coach_id', 'school_id', 'pld_id', 'state_id',
          'bow_category', 'avatar_url', 'phone', 'date_of_birth', 'gender',
          'created_at',
        ].join(', '))
        .eq('id', userId!)
        .single()
      if (error) throw error
      return data as unknown as FullProfile
    },
  })

  // Disciplines fetched separately and defensively — if migration 076 hasn't
  // been applied, the column is missing and this simply returns null instead
  // of breaking the whole profile page.
  const { data: disciplines } = useQuery<string[] | null>({
    queryKey: ['archer-disciplines', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles').select('disciplines').eq('id', userId!).maybeSingle()
      if (error) return null  // column not visible yet (076 pending / cache stale)
      return (data as { disciplines?: string[] } | null)?.disciplines ?? null
    },
    retry: false,
  })

  // ── 2. Org data ──────────────────────────────────────────────
  const { data: orgData } = useQuery({
    queryKey: ['archer-org', fullProfile?.school_id, fullProfile?.pld_id, fullProfile?.state_id],
    enabled: !!fullProfile,
    queryFn: async () => {
      const { school_id, pld_id, state_id } = fullProfile!
      const [schoolRes, pldRes, stateRes] = await Promise.all([
        school_id
          ? supabase.from('schools').select('id, name').eq('id', school_id).maybeSingle()
          : Promise.resolve({ data: null }),
        pld_id
          ? supabase.from('plds').select('id, name').eq('id', pld_id).maybeSingle()
          : Promise.resolve({ data: null }),
        state_id
          ? supabase.from('states').select('id, name, code').eq('id', state_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])
      return {
        school: schoolRes.data as { id: string; name: string } | null,
        pld:    pldRes.data    as { id: string; name: string } | null,
        state:  stateRes.data  as { id: string; name: string; code: string } | null,
      }
    },
  })

  // ── 3. Archer extension profile ──────────────────────────────
  const { data: archerExt } = useQuery<ArcherExt | null>({
    queryKey: ['archer-ext', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('archer_profiles')
        .select('profile_id, age_group, bow_category, dominant_hand, draw_length_in')
        .eq('profile_id', userId!)
        .maybeSingle()
      return (data as ArcherExt) ?? null
    },
  })

  // ── 4. Coach link ────────────────────────────────────────────
  const { data: coachLink } = useQuery<CoachLink | null>({
    queryKey: ['archer-coach-link', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('coach_archer_links')
        .select('id, coach_id, archer_id, status, linked_at, approved_at, rejected_at, rejection_reason, unlinked_at')
        .eq('archer_id', userId!)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return (data as CoachLink) ?? null
    },
  })

  // ── 5. Coach profile (requires migration 010 RLS policy) ─────
  const { data: coachProfile } = useQuery<CoachProfile | null>({
    queryKey: ['archer-coach-profile', coachLink?.coach_id],
    enabled: !!coachLink?.coach_id,
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, name, email')
        .eq('id', coachLink!.coach_id)
        .maybeSingle()
      return (data as CoachProfile) ?? null
    },
  })

  // ── 5b. Pending coach requests (coach reached out — archer must consent) ──
  const { data: coachRequests = [], refetch: refetchRequests } = useQuery<CoachRequest[]>({
    queryKey: ['archer-coach-requests', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('archer_pending_coach_links')
      if (error) return [] // RPC not deployed yet (migration 082) — degrade quietly
      return (data ?? []) as CoachRequest[]
    },
  })
  const [respondingId, setRespondingId] = useState<string | null>(null)
  const respondToRequest = async (linkId: string, accept: boolean) => {
    setRespondingId(linkId)
    try {
      const { error } = await supabase.rpc('archer_respond_coach_link', { p_link: linkId, p_accept: accept })
      if (error) throw error
      ok(accept ? t('archerProfile.requestAccepted') : t('archerProfile.requestRejected'))
      await refetchRequests()
      queryClient.invalidateQueries({ queryKey: ['archer-coach-link', userId] })
    } catch (e) {
      err((e as Error).message ?? t('login.somethingWrong'))
    } finally {
      setRespondingId(null)
    }
  }

  // ── 6. Recent scores ─────────────────────────────────────────
  const { data: scores = [] } = useQuery<ScoreRow[]>({
    queryKey: ['archer-profile-scores', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('score_submissions')
        .select('id, date, total_score, max_score, status, round:round_id(name)')
        .eq('archer_id', userId!)
        .order('date', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as unknown as ScoreRow[]
    },
  })

  // ── 7. Latest achievement ────────────────────────────────────
  const { data: latestAchievement } = useQuery<AchievementRow | null>({
    queryKey: ['archer-profile-achievement', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from('user_achievements')
        .select('id, earned_at, definition:achievement_id(name, icon, category)')
        .eq('profile_id', userId!)
        .order('earned_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return (data as unknown as AchievementRow) ?? null
    },
  })

  // ── Derived ──────────────────────────────────────────────────
  const approvedScores = scores.filter((s) => s.status === 'admin_approved')
  const bestScore = approvedScores.reduce<ScoreRow | null>((best, s) => {
    if (!best) return s
    return scorePct(s.total_score, s.max_score) > scorePct(best.total_score, best.max_score) ? s : best
  }, null)

  const archerCode = fullProfile?.archer_id ?? null
  const qrPayload  = archerCode
    ? JSON.stringify({ type: 'archer_profile', archer_id: archerCode, user_id: userId })
    : null

  // ── Handlers ─────────────────────────────────────────────────
  function handleCopyId() {
    if (!archerCode) return
    navigator.clipboard.writeText(archerCode)
      .then(() => {
        ok(t('archerProfile.idCopied'))
        if (userId) writeAuditLog(userId, 'archer.id_copied', 'profile', userId, { archer_id: archerCode })
      })
      .catch(() => err(t('archerProfile.copyFailed')))
  }

  function handleDownloadQR() {
    const canvas = document.getElementById('archer-qr-download-canvas') as HTMLCanvasElement | null
    if (!canvas) return
    const url = canvas.toDataURL('image/png')
    const a   = document.createElement('a')
    a.download = `archer-qr-${archerCode ?? 'id'}.png`
    a.href     = url
    a.click()
    if (userId) writeAuditLog(userId, 'archer.qr_downloaded', 'profile', userId, { archer_id: archerCode })
    ok(t('archerProfile.qrDownloaded'))
  }

  if (!profile) return null

  const bowCategory = fullProfile?.bow_category ?? archerExt?.bow_category

  return (
    <PageWrapper>
      <PageHead
        title={t('archerProfile.title')}
        description={t('archerProfile.description')}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 items-start">

        {/* ── LEFT COLUMN ── */}
        <div className="space-y-4">

          {/* Profile Summary */}
          <SectionCard>
            {loadingProfile ? (
              <div className="py-8 text-center text-text-faint text-sm">{t('common.loading')}</div>
            ) : !fullProfile ? (
              <EmptyState
                title={t('archerProfile.notFound')}
                description={t('archerProfile.notFoundHint')}
              />
            ) : (
              <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
                <Avatar
                  name={fullProfile.name}
                  src={fullProfile.avatar_url ?? undefined}
                  size="lg"
                  className="!w-16 !h-16 !text-xl flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <h3 className="text-[18px] font-display font-semibold">{fullProfile.name}</h3>
                    <div className="flex gap-1.5 flex-wrap">
                      <AccountStatusBadge status={fullProfile.status as 'pending' | 'approved' | 'rejected' | 'suspended' | 'inactive'} />
                      <RoleBadge role={fullProfile.role as Role} />
                    </div>
                  </div>
                  {archerCode && (
                    <div className="mt-1.5 font-mono text-xs text-primary bg-section rounded px-2 py-0.5 inline-block tracking-wider">
                      {archerCode}
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <InfoRow label={t('common.email')}        value={fullProfile.email} />
                    {fullProfile.phone && <InfoRow label={t('common.phone')} value={fullProfile.phone} />}
                    {fullProfile.date_of_birth && (
                      <InfoRow label={t('archerProfile.dateOfBirth')} value={formatDate(fullProfile.date_of_birth)} />
                    )}
                    {fullProfile.gender && (
                      <InfoRow
                        label={t('archerProfile.gender')}
                        value={fullProfile.gender.replace(/_/g, ' ')}
                      />
                    )}
                    <InfoRow label={t('common.joined')} value={formatDate(fullProfile.created_at)} />
                  </div>
                  {fullProfile.status === 'rejected' && fullProfile.rejection_reason && (
                    <div className="mt-3 p-3 rounded-[var(--r)] bg-danger-soft text-sm text-danger">
                      <strong>{t('archerProfile.rejectionReason')}:</strong> {fullProfile.rejection_reason}
                    </div>
                  )}
                </div>
              </div>
            )}
          </SectionCard>

          {/* School & Organization */}
          <SectionCard title={t('archerProfile.schoolOrg')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
              <OrgField label={t('common.school')}       value={orgData?.school?.name} empty={t('archerProfile.notAssigned')} />
              <OrgField label={t('common.pld')}          value={orgData?.pld?.name}    empty={t('archerProfile.notAssigned')} />
              <OrgField
                label={t('common.state')}
                value={orgData?.state ? `${orgData.state.name} (${orgData.state.code})` : undefined}
                empty={t('archerProfile.notAssigned')}
              />
              <OrgField
                label={t('common.bowCategory')}
                value={bowCategory ?? undefined}
                empty={t('archerProfile.notSet')}
              />
              {archerExt?.age_group && (
                <OrgField label={t('common.ageGroup')}     value={archerExt.age_group.toUpperCase()} />
              )}
              {archerExt?.dominant_hand && (
                <OrgField label={t('archerProfile.dominantHand')} value={archerExt.dominant_hand} />
              )}
              {archerExt?.draw_length_in != null && (
                <OrgField label={t('archerProfile.drawLength')}   value={`${archerExt.draw_length_in}"`} />
              )}
            </div>
            {fullProfile && !orgData?.school && !orgData?.pld && !orgData?.state && fullProfile.status === 'approved' && (
              <p className="text-xs text-text-faint mt-4">
                {t('archerProfile.orgMissing')}
              </p>
            )}
          </SectionCard>

          {/* Pending coach requests — a coach reached out; the archer consents.
              Approving here is what unlocks the coach's access to scores/proofs. */}
          {coachRequests.length > 0 && (
            <SectionCard title={t('archerProfile.coachRequests')}>
              <p className="text-xs text-text-dim mb-3">{t('archerProfile.coachRequestsHint')}</p>
              <div className="space-y-2">
                {coachRequests.map((r) => (
                  <div key={r.link_id} className="flex items-center justify-between gap-3 p-3 rounded-[var(--r)] bg-surface-soft">
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{r.coach_name ?? t('common.unknown')}</div>
                      <div className="text-xs text-text-dim mt-0.5 truncate">
                        {r.coach_school ?? ''}{r.coach_school ? ' · ' : ''}{t('archerProfile.requestSent')} {formatDate(r.requested_at)}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button variant="primary" size="sm" disabled={respondingId === r.link_id}
                        onClick={() => respondToRequest(r.link_id, true)}>
                        {t('common.approve')}
                      </Button>
                      <Button variant="ghost" size="sm" disabled={respondingId === r.link_id}
                        onClick={() => respondToRequest(r.link_id, false)}>
                        {t('common.reject')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {/* Coach Link */}
          <SectionCard title={t('archerProfile.coachLink')}>
            {!coachLink ? (
              <EmptyState
                icon={<PersonIcon />}
                title={t('archerProfile.noCoach')}
                description={t('archerProfile.noCoachHint')}
              />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-text-dim">{t('archerProfile.linkStatus')}</span>
                  <CoachLinkBadge status={coachLink.status} />
                </div>

                {coachProfile && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 pt-3 border-t border-line">
                    <OrgField label={t('archerProfile.coachName')}  value={coachProfile.name} />
                    <OrgField label={t('archerProfile.coachEmail')} value={coachProfile.email} />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 pt-3 border-t border-line">
                  <OrgField label={t('archerProfile.requestSent')} value={formatDate(coachLink.linked_at)} />
                  {coachLink.status === 'active' && coachLink.approved_at && (
                    <OrgField label={t('archerProfile.activeSince')} value={formatDate(coachLink.approved_at)} />
                  )}
                  {coachLink.status === 'rejected' && coachLink.rejected_at && (
                    <OrgField label={t('archerProfile.rejectedOn')} value={formatDate(coachLink.rejected_at)} />
                  )}
                  {coachLink.status === 'inactive' && coachLink.unlinked_at && (
                    <OrgField label={t('archerProfile.unlinkedOn')} value={formatDate(coachLink.unlinked_at)} />
                  )}
                </div>

                {coachLink.status === 'rejected' && coachLink.rejection_reason && (
                  <div className="p-3 rounded-[var(--r)] bg-danger-soft text-sm text-danger">
                    <strong>{t('archerProfile.rejectionReason')}:</strong> {coachLink.rejection_reason}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          {/* Recent Activity */}
          <SectionCard title={t('archerProfile.recentActivity')}>
            {/* Mini stats */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <MiniStat label={t('archerProfile.submitted')}    value={scores.length} />
              <MiniStat label={t('status.approved')}     value={approvedScores.length} />
              <MiniStat
                label={t('archerDash.bestScore')}
                value={
                  bestScore
                    ? scoreDisplay(bestScore.total_score, bestScore.max_score)
                    : '—'
                }
              />
            </div>

            {scores.length === 0 ? (
              <EmptyState
                title={t('archerDash.noScoresYet')}
                description={t('archerProfile.submitFromDash')}
              />
            ) : (
              <div className="space-y-2">
                {scores.slice(0, 5).map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between px-3 py-2.5 rounded-[var(--r)] bg-surface-soft text-sm"
                  >
                    <div>
                      <div className="font-medium">{(Array.isArray(s.round) ? s.round[0]?.name : s.round?.name) ?? t('common.score')}</div>
                      <div className="text-xs text-text-faint mt-0.5">{formatDate(s.date)}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display font-semibold">{scoreDisplay(s.total_score, s.max_score)}</div>
                      <div className="mt-0.5">
                        <SubmissionStatusBadge status={s.status} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Latest achievement */}
            {latestAchievement && (
              <div className="mt-4 pt-4 border-t border-line">
                <p className="text-xs font-medium text-text-faint mb-2 uppercase tracking-wide">{t('archerProfile.latestAchievement')}</p>
                <div className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--r)] bg-surface-soft">
                  <span className="text-2xl leading-none">
                    {(Array.isArray(latestAchievement.definition) ? latestAchievement.definition[0]?.icon : latestAchievement.definition?.icon) ?? '🏆'}
                  </span>
                  <div>
                    <div className="text-sm font-medium">
                      {(Array.isArray(latestAchievement.definition) ? latestAchievement.definition[0]?.name : latestAchievement.definition?.name) ?? t('archerProfile.achievementUnlocked')}
                    </div>
                    <div className="text-xs text-text-faint">{timeAgo(latestAchievement.earned_at)}</div>
                  </div>
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ── RIGHT SIDEBAR ── */}
        <div className="space-y-4">

          {/* QR Code & Archer ID */}
          <SectionCard title={t('archerProfile.idQr')}>
            {!archerCode ? (
              <EmptyState
                title={t('archerProfile.idNotAssigned')}
                description={t('archerProfile.idNotAssignedHint')}
              />
            ) : (
              <div className="flex flex-col items-center gap-4">
                {/* SVG QR preview */}
                <div className="p-4 bg-white rounded-[var(--r)] border border-line shadow-sm">
                  <QRCodeSVG
                    value={qrPayload!}
                    size={200}
                    level="M"
                    includeMargin={false}
                  />
                </div>

                {/* Archer code label */}
                <div className="text-center">
                  <p className="font-mono text-base font-bold tracking-widest text-text">
                    {archerCode}
                  </p>
                  <p className="text-[11px] text-text-faint mt-1 max-w-[220px]">
                    {t('archerProfile.qrHint')}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 w-full">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handleCopyId}
                    icon={<CopyIcon />}
                  >
                    {t('archerProfile.copyId')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handleDownloadQR}
                    icon={<DownloadIcon />}
                  >
                    {t('common.download')}
                  </Button>
                </div>

                {/* Hidden canvas for PNG download (positioned off-screen so it renders) */}
                <div
                  className="absolute pointer-events-none"
                  style={{ left: '-9999px', top: '-9999px' }}
                  aria-hidden="true"
                >
                  <QRCodeCanvas
                    id="archer-qr-download-canvas"
                    value={qrPayload!}
                    size={600}
                    level="M"
                    includeMargin
                  />
                </div>
              </div>
            )}
          </SectionCard>

          {/* Password & Security */}
          <PasswordChangeSection />

          {/* Profile Editor — birth year / age group (self-editable) */}
          <div id="profile-editor">
            <ProfileEditorCard
              userId={userId}
              currentBirthYear={fullProfile?.birth_year ?? null}
              currentGender={fullProfile?.gender ?? null}
              currentDisciplines={disciplines ?? null}
              onSaved={async () => {
                queryClient.invalidateQueries({ queryKey: ['archer-full-profile', userId] })
                queryClient.invalidateQueries({ queryKey: ['leaderboard'] })
                if (userId) {
                  const fresh = await loadProfile(userId)
                  if (fresh) setProfile(fresh)
                }
              }}
            />
          </div>

          {/* Profile Change Request */}
          <SectionCard title={t('archerProfile.changeRequest')}>
            <p className="text-sm text-text-dim mb-4">
              {t('archerProfile.changeRequestHint')}
            </p>
            <p className="text-xs text-text-faint mb-4">
              {t('archerProfile.lockedFields')}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => navigate('/archer/change-request')}
              icon={<EditIcon />}
            >
              {t('archerProfile.requestChange')}
            </Button>
          </SectionCard>
        </div>
      </div>
    </PageWrapper>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div>
      <p className="text-[11px] text-text-faint uppercase tracking-wide">{label}</p>
      <p className="text-sm font-medium text-text mt-0.5">{value}</p>
    </div>
  )
}

function OrgField({ label, value, empty }: { label: string; value?: string | null; empty?: string }) {
  return (
    <div>
      <p className="text-[11px] text-text-faint uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${value ? 'text-text' : 'text-text-faint italic'}`}>
        {value ?? empty ?? '—'}
      </p>
    </div>
  )
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center px-2 py-3 rounded-[var(--r)] bg-surface-soft">
      <p className="font-display font-bold text-lg leading-none">{value}</p>
      <p className="text-[11px] text-text-faint mt-1">{label}</p>
    </div>
  )
}

/**
 * Self-service birth-year editor (Task 6). The archer updates only their own
 * birth year; the profile self-guard (migrations 031–033) locks role/status/
 * scope/coach, so this passes RLS with no special RPC. The competition age +
 * age group preview uses the SAME calendar-year logic as the leaderboard.
 */
function ProfileEditorCard({
  userId, currentBirthYear, currentGender, currentDisciplines, onSaved,
}: {
  userId?: string
  currentBirthYear: number | null
  currentGender: string | null
  currentDisciplines: string[] | null
  onSaved: () => void | Promise<void>
}) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const [value, setValue] = useState<string>(currentBirthYear != null ? String(currentBirthYear) : '')
  const [gender, setGender] = useState<string>(currentGender ?? '')
  const [disciplines, setDisciplines] = useState<string[]>(currentDisciplines ?? [])
  const [saving, setSaving] = useState(false)

  // The profile queries resolve AFTER this card first mounts (props start as
  // null on a page refresh), and useState initializers only run once — so sync
  // local state when a prop changes. Guard: only overwrite a field if the user
  // hasn't edited it (state still matches the PREVIOUS prop value), so an
  // in-progress edit is never clobbered by a background refetch.
  const prevYearRef = useRef(currentBirthYear)
  useEffect(() => {
    const prevStr = prevYearRef.current != null ? String(prevYearRef.current) : ''
    prevYearRef.current = currentBirthYear
    setValue((v) => (v === prevStr ? (currentBirthYear != null ? String(currentBirthYear) : '') : v))
  }, [currentBirthYear])

  const prevGenderRef = useRef(currentGender)
  useEffect(() => {
    const prevStr = prevGenderRef.current ?? ''
    prevGenderRef.current = currentGender
    setGender((g) => (g === prevStr ? (currentGender ?? '') : g))
  }, [currentGender])

  const prevDiscRef = useRef(currentDisciplines)
  useEffect(() => {
    const join = (a: string[] | null) => [...(a ?? [])].sort().join(',')
    const prevStr = join(prevDiscRef.current)
    prevDiscRef.current = currentDisciplines
    setDisciplines((d) => (join(d) === prevStr ? (currentDisciplines ?? []) : d))
  }, [currentDisciplines])

  const thisYear = competitionYear()
  const parsed = value ? parseInt(value, 10) : NaN
  const valid = Number.isFinite(parsed) && parsed >= 1900 && parsed <= thisYear
  const preview = valid ? ageSnapshot(parsed) : null
  const yearDirty = value !== (currentBirthYear != null ? String(currentBirthYear) : '')
  const genderDirty = gender !== (currentGender ?? '')
  const sortedJoin = (a: string[]) => [...a].sort().join(',')
  const discDirty = sortedJoin(disciplines) !== sortedJoin(currentDisciplines ?? [])
  const dirty = yearDirty || genderDirty || discDirty

  const toggleDiscipline = (d: string) =>
    setDisciplines((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d])

  async function save() {
    if (!userId || !valid) { err(t('profileEditor.invalidYear')); return }
    setSaving(true)
    try {
      const base: { birth_year: number; gender?: string } = { birth_year: parsed }
      if (gender) base.gender = gender

      const { error } = await supabase.from('profiles').update({ ...base, disciplines }).eq('id', userId)
      if (error) {
        // Column not visible yet (migration 076 pending / API schema cache
        // stale): save the rest so birth year + gender still persist, and tell
        // the user how to enable disciplines.
        if (/disciplines/i.test(error.message)) {
          const { error: e2 } = await supabase.from('profiles').update(base).eq('id', userId)
          if (e2) throw e2
          writeAuditLog(userId, 'profile.birth_year_updated', 'profile', userId, base).catch(() => {})
          ok(t('profileEditor.saved'))
          err(t('profileEditor.disciplinesUnavailable'))
          await onSaved()
          return
        }
        throw error
      }
      writeAuditLog(userId, 'profile.birth_year_updated', 'profile', userId, { ...base, disciplines }).catch(() => {})
      ok(t('profileEditor.saved'))
      await onSaved()
    } catch (e) {
      err((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title={t('profileEditor.title')}>
      <p className="text-sm text-text-dim mb-3">{t('profileEditor.description')}</p>
      <Input
        label={t('profileEditor.birthYear')}
        type="number"
        inputMode="numeric"
        min={1900}
        max={thisYear}
        placeholder={t('profileEditor.birthYearPlaceholder')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        error={value && !valid ? t('profileEditor.invalidYear') : undefined}
      />

      <div className="mt-3">
        <Select
          label={t('archerProfile.gender')}
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          placeholder={t('profileEditor.genderPlaceholder')}
          options={[
            { value: 'male',   label: t('kpm.gender.male') },
            { value: 'female', label: t('kpm.gender.female') },
          ]}
        />
      </div>

      {/* Disciplines the archer shoots — controls which rounds they can score. */}
      <div className="mt-3">
        <label className="text-[12px] font-semibold text-text-dim block mb-1.5">{t('profileEditor.disciplines')}</label>
        <div className="flex flex-wrap gap-2">
          {(['recurve', 'compound', 'barebow', 'traditional', 'longbow'] as const).map((d) => {
            const on = disciplines.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDiscipline(d)}
                className={[
                  'px-3 py-1.5 rounded-[var(--r)] text-sm font-semibold border transition-all',
                  on ? 'bg-primary text-on-primary border-primary'
                     : 'bg-surface border-line text-text-dim hover:border-line-strong',
                ].join(' ')}
              >
                {t(`bowCategories.${d}`)}
              </button>
            )
          })}
        </div>
        <p className="text-[11px] text-text-faint mt-1">{t('profileEditor.disciplinesHint')}</p>
      </div>

      {preview && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="text-center px-2 py-2.5 rounded-[var(--r)] bg-surface-soft">
            <p className="font-display font-bold text-lg leading-none">{preview.competition_age}</p>
            <p className="text-[11px] text-text-faint mt-1">{t('profileEditor.competitionAge')}</p>
          </div>
          <div className="text-center px-2 py-2.5 rounded-[var(--r)] bg-primary-soft">
            <p className="font-display font-bold text-lg leading-none text-primary">{t(`ageGroups.${preview.age_group.toLowerCase()}`)}</p>
            <p className="text-[11px] text-text-faint mt-1">{t('common.ageGroup')}</p>
          </div>
        </div>
      )}

      <p className="text-xs text-text-faint mt-3 leading-relaxed">{t('profileEditor.autoUpdateHint')}</p>

      <Button
        variant="primary"
        size="sm"
        className="w-full mt-3"
        loading={saving}
        disabled={!dirty || !valid}
        onClick={save}
      >
        {t('common.save')}
      </Button>
    </SectionCard>
  )
}

// ── Icons ──────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function PersonIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M20 21c0-4-3.58-7-8-7s-8 3-8 7" />
    </svg>
  )
}

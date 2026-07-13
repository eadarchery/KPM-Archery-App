/**
 * Coach Profile service — read/write the logged-in coach's profile data.
 *
 * Data sources (all public-schema views, security_invoker = true):
 *   public.profiles      → core.profiles    (name, email, phone, avatar_url, org FKs)
 *   public.coach_profiles → coaching.coach_profiles  (bio, coaching fields — created by migration 023)
 *   public.coach_archer_links → coaching.coach_archer_links
 *   public.certifications → certification.certifications
 *   storage:avatars      (public bucket — upload path: {uid}/{filename})
 *
 * Writes:
 *   profiles.phone / profiles.avatar_url — allowed by core_profiles_own_update
 *   coach_profiles.*                     — allowed by coaching_coach_profiles_own_update
 *                                          + coaching_coach_profiles_own_insert (migration 023)
 *
 * Audit: writes coach_profile.updated / coach_profile.photo_uploaded via log_audit RPC.
 */
import { supabase } from './supabase'
import { useAuthStore } from '@/store/authStore'
import { writeAuditLog } from './auditLog'
import { compressImage, compressPresets } from '@/lib/imageCompress'

// ─── TYPES ─────────────────────────────────────────────────────────────────

export interface CoachCoreProfile {
  id: string
  email: string
  name: string
  role: string
  status: string
  phone: string | null
  avatar_url: string | null
  school_id: string | null
  pld_id: string | null
  state_id: string | null
  date_of_birth: string | null
  gender: string | null
  created_at: string
}

export interface CoachExtProfile {
  id: string
  profile_id: string
  coach_code: string | null
  bio: string | null
  experience_years: number | null
  affiliated_org: string | null
  is_certified: boolean
  certification_level: string | null
  coaching_level: string | null
  specialization: string[] | null
  preferred_bow_categories: string[] | null
  created_at: string
  updated_at: string
}

export interface FullCoachProfile {
  core: CoachCoreProfile
  ext: CoachExtProfile | null
  school_name: string | null
  pld_name: string | null
  state_name: string | null
  state_code: string | null
}

export interface CoachProfilePayload {
  phone?: string | null
  bio?: string | null
  experience_years?: number | null
  coaching_level?: string | null
  specialization?: string[]
  preferred_bow_categories?: string[]
}

export interface LinkedArcherInfo {
  link_id: string
  archer_id: string
  name: string
  school_name: string | null
  bow_category: string | null
  linked_at: string
  status: string
}

export interface LinkedArchersSummary {
  total: number
  active: number
  pending: number
  inactive: number
  recent: LinkedArcherInfo[]
}

export interface CertSummary {
  total: number
  approved: number
  pending: number
  rejected: number
  latest_date: string | null
}

export interface ProfileCompletion {
  pct: number
  done: number
  total: number
  missing: string[]
}

// ─── INTERNAL ──────────────────────────────────────────────────────────────

function uid(): string {
  return useAuthStore.getState().profile?.id ?? ''
}

// ─── READ ──────────────────────────────────────────────────────────────────

export async function getMyCoachProfile(): Promise<FullCoachProfile> {
  const me = uid()
  if (!me) throw new Error('Not authenticated.')

  const [coreRes, extRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, name, role, status, phone, avatar_url, school_id, pld_id, state_id, date_of_birth, gender, created_at')
      .eq('id', me)
      .single(),
    supabase
      .from('coach_profiles')
      .select('id, profile_id, coach_code, bio, experience_years, affiliated_org, is_certified, certification_level, coaching_level, specialization, preferred_bow_categories, created_at, updated_at')
      .eq('profile_id', me)
      .maybeSingle(),
  ])

  if (coreRes.error) throw coreRes.error
  const core = coreRes.data as unknown as CoachCoreProfile
  const ext = extRes.data as CoachExtProfile | null

  const [schoolRes, pldRes, stateRes] = await Promise.all([
    core.school_id
      ? supabase.from('schools').select('id, name').eq('id', core.school_id).maybeSingle()
      : Promise.resolve({ data: null }),
    core.pld_id
      ? supabase.from('plds').select('id, name').eq('id', core.pld_id).maybeSingle()
      : Promise.resolve({ data: null }),
    core.state_id
      ? supabase.from('states').select('id, name, code').eq('id', core.state_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    core,
    ext,
    school_name: (schoolRes.data as { name: string } | null)?.name ?? null,
    pld_name:    (pldRes.data   as { name: string } | null)?.name ?? null,
    state_name:  (stateRes.data as { name: string; code: string } | null)?.name ?? null,
    state_code:  (stateRes.data as { name: string; code: string } | null)?.code ?? null,
  }
}

export async function getMyLinkedArchersSummary(): Promise<LinkedArchersSummary> {
  const me = uid()
  if (!me) throw new Error('Not authenticated.')

  const { data: links, error } = await supabase
    .from('coach_archer_links')
    .select('id, archer_id, status, linked_at')
    .eq('coach_id', me)
    .order('linked_at', { ascending: false })

  if (error) throw error
  const rows = (links ?? []) as { id: string; archer_id: string; status: string; linked_at: string }[]

  const archerIds = [...new Set(rows.map(r => r.archer_id))]
  let archerMeta: Record<string, { name: string; school_id: string | null; bow_category: string | null }> = {}

  if (archerIds.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, name, school_id, bow_category')
      .in('id', archerIds)
    const schoolIds = [...new Set(
      ((profs ?? []) as { school_id: string | null }[])
        .map(p => p.school_id)
        .filter((x): x is string => !!x)
    )]
    let schoolNames: Record<string, string> = {}
    if (schoolIds.length) {
      const { data: schools } = await supabase.from('schools').select('id, name').in('id', schoolIds)
      schoolNames = Object.fromEntries(((schools ?? []) as { id: string; name: string }[]).map(s => [s.id, s.name]))
    }
    archerMeta = Object.fromEntries(
      ((profs ?? []) as { id: string; name: string; school_id: string | null; bow_category: string | null }[])
        .map(p => [p.id, {
          name: p.name,
          school_id: p.school_id,
          bow_category: p.bow_category,
        }])
    )
    // Attach school names
    for (const [, v] of Object.entries(archerMeta)) {
      (v as unknown as { school_name: string | null }).school_name = v.school_id ? (schoolNames[v.school_id] ?? null) : null
    }
  }

  const recent: LinkedArcherInfo[] = rows.slice(0, 5).map(r => ({
    link_id: r.id,
    archer_id: r.archer_id,
    name: archerMeta[r.archer_id]?.name ?? 'Unknown',
    school_name: (archerMeta[r.archer_id] as unknown as { school_name: string | null })?.school_name ?? null,
    bow_category: archerMeta[r.archer_id]?.bow_category ?? null,
    linked_at: r.linked_at,
    status: r.status,
  }))

  return {
    total: rows.length,
    active: rows.filter(r => r.status === 'active').length,
    pending: rows.filter(r => r.status === 'pending').length,
    inactive: rows.filter(r => r.status === 'inactive' || r.status === 'rejected').length,
    recent,
  }
}

export async function getMyCertificationSummary(): Promise<CertSummary> {
  const me = uid()
  if (!me) throw new Error('Not authenticated.')

  const { data, error } = await supabase
    .from('certifications')
    .select('id, status, created_at')
    .eq('coach_id', me)
    .order('created_at', { ascending: false })

  if (error) throw error
  const rows = (data ?? []) as { id: string; status: string; created_at: string }[]

  return {
    total: rows.length,
    approved: rows.filter(r => r.status === 'approved').length,
    pending:  rows.filter(r => r.status === 'pending').length,
    rejected: rows.filter(r => r.status === 'rejected').length,
    latest_date: rows[0]?.created_at ?? null,
  }
}

// ─── COMPLETION ────────────────────────────────────────────────────────────

export function getCoachProfileCompletion(
  data: FullCoachProfile,
  certTotal: number,
): ProfileCompletion {
  const { core, ext } = data
  const checks: [string, boolean][] = [
    ['Profile photo',             !!core.avatar_url],
    ['Phone number',              !!core.phone?.trim()],
    ['Bio',                       !!ext?.bio?.trim()],
    ['Experience years',          (ext?.experience_years ?? 0) > 0],
    ['Coaching level',            !!ext?.coaching_level?.trim()],
    ['Specialties',               (ext?.specialization?.length ?? 0) > 0],
    ['Preferred bow categories',  (ext?.preferred_bow_categories?.length ?? 0) > 0],
    ['School / organisation',     !!core.school_id],
    ['At least one certification', certTotal > 0],
  ]
  const done    = checks.filter(([, v]) => v).length
  const missing = checks.filter(([, v]) => !v).map(([k]) => k)
  return { pct: Math.round((done / checks.length) * 100), done, total: checks.length, missing }
}

// ─── WRITE ─────────────────────────────────────────────────────────────────

export async function updateMyCoachProfile(payload: CoachProfilePayload): Promise<void> {
  const me = uid()
  if (!me) throw new Error('Not authenticated.')

  // 1. Update core profile (phone only — email/role/status are read-only here)
  if (payload.phone !== undefined) {
    const { error } = await supabase
      .from('profiles')
      .update({ phone: payload.phone })
      .eq('id', me)
    if (error) throw error
  }

  // 2. Upsert coach extension profile
  const { data: existing } = await supabase
    .from('coach_profiles')
    .select('id')
    .eq('profile_id', me)
    .maybeSingle()

  const coachFields = {
    bio:                    payload.bio      !== undefined ? payload.bio      : undefined,
    experience_years:       payload.experience_years !== undefined ? payload.experience_years : undefined,
    coaching_level:         payload.coaching_level   !== undefined ? payload.coaching_level   : undefined,
    specialization:         payload.specialization            ?? undefined,
    preferred_bow_categories: payload.preferred_bow_categories ?? undefined,
  }
  // Remove undefined keys so we don't accidentally null out fields we didn't touch.
  const cleanFields = Object.fromEntries(
    Object.entries(coachFields).filter(([, v]) => v !== undefined),
  )

  if (existing) {
    const { error } = await supabase.from('coach_profiles').update(cleanFields).eq('profile_id', me)
    if (error) throw error
  } else {
    const { error } = await supabase.from('coach_profiles').insert({ profile_id: me, ...cleanFields })
    if (error) throw error
  }

  writeAuditLog(me, 'coach_profile.updated', 'coach_profile', me, { fields: Object.keys(cleanFields) }).catch(console.warn)
}

export async function uploadCoachProfilePhoto(file: File): Promise<string> {
  const me = uid()
  if (!me) throw new Error('Not authenticated.')

  // Avatars render small everywhere — compress to a 512px JPEG before upload.
  const upload = await compressImage(file, compressPresets.avatar)
  const ext   = upload.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path  = `${me}/coach-avatar-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, upload, {
    cacheControl: '3600', upsert: true, contentType: upload.type,
  })
  if (uploadError) throw uploadError

  const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path)

  const { error: updateError } = await supabase
    .from('profiles')
    .update({ avatar_url: publicUrl })
    .eq('id', me)
  if (updateError) throw updateError

  writeAuditLog(me, 'coach_profile.photo_uploaded', 'coach_profile', me, { path }).catch(console.warn)
  return publicUrl
}

import { supabase } from './supabase'
import { useAuthStore } from '@/store/authStore'
import { assertCan, canViewEquipment } from '@/lib/permissions'
import { writeAuditLog } from './auditLog'
import { fetchOrgMaps } from './orgLookup'
import type { EquipmentSetup } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type EquipmentPayload = Omit<
  EquipmentSetup,
  'id' | 'profile_id' | 'active' | 'created_at' | 'updated_at' | 'updated_by'
>

export interface LinkedArcher {
  id: string
  name: string
  email?: string
  archer_id?: string
  age?: number
  bow_category?: string
  school?: { id: string; name: string } | null
}

// ─── GUARDS ──────────────────────────────────────────────────────────────────

function currentActor() {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

function assertCanView(): void {
  assertCan(canViewEquipment(currentActor().role), 'view equipment')
}

// ─── READS ───────────────────────────────────────────────────────────────────

/** Fetch the current user's own equipment profile (archer). */
export async function getMyEquipment(profileId: string): Promise<EquipmentSetup | null> {
  assertCanView()
  const { data, error } = await supabase
    .from('equipment_setups')
    .select('*')
    .eq('profile_id', profileId)
    .maybeSingle()
  if (error) throw error
  return data as EquipmentSetup | null
}

/** Fetch a linked archer's equipment profile (coach / admin). */
export async function getArcherEquipment(archerId: string): Promise<EquipmentSetup | null> {
  assertCanView()
  const { data, error } = await supabase
    .from('equipment_setups')
    .select('*')
    .eq('profile_id', archerId)
    .maybeSingle()
  if (error) throw error
  return data as EquipmentSetup | null
}

/** Return all active-linked archers for a coach (for the archer selector). */
export async function getCoachLinkedArchers(coachId: string): Promise<LinkedArcher[]> {
  // No embedding: fetch link ids, then archer profiles + org names, and stitch.
  const { data: linkRows, error } = await supabase
    .from('coach_archer_links')
    .select('archer_id, created_at')
    .eq('coach_id', coachId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
  if (error) throw error
  const ids = [...new Set((linkRows ?? []).map((r: { archer_id: string }) => r.archer_id))]
  if (ids.length === 0) return []

  const [profRes, maps] = await Promise.all([
    supabase.from('profiles').select('id, name, email, archer_id, age, bow_category, school_id').in('id', ids),
    fetchOrgMaps(),
  ])
  type RawProf = { id: string; name: string; email: string | null; archer_id: string | null; age: number | null; bow_category: string | null; school_id: string | null }
  const byId = new Map(((profRes.data ?? []) as RawProf[]).map((p) => [p.id, p]))
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is RawProf => !!p)
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email ?? undefined,
      archer_id: p.archer_id ?? undefined,
      age: p.age ?? undefined,
      bow_category: p.bow_category ?? undefined,
      school: p.school_id ? maps.schools.get(p.school_id) ?? null : null,
    }))
}

// ─── WRITES ──────────────────────────────────────────────────────────────────

/** Archer saves their own equipment (upsert — one profile per archer). */
export async function saveMyEquipment(
  profileId: string,
  payload: EquipmentPayload,
): Promise<EquipmentSetup> {
  const { id: actorId, role } = currentActor()
  assertCan(
    role === 'archer' || role === 'coach' || role === 'admin2' || role === 'super_admin',
    'edit your own equipment',
  )

  // Determine if this is a create or update for the audit log
  const { data: existing } = await supabase
    .from('equipment_setups')
    .select('id')
    .eq('profile_id', profileId)
    .maybeSingle()

  const { data, error } = await supabase
    .from('equipment_setups')
    .upsert(
      { ...payload, profile_id: profileId, updated_by: actorId ?? null },
      { onConflict: 'profile_id' },
    )
    .select('*')
    .single()
  if (error) throw error

  writeAuditLog(
    actorId!,
    existing ? 'equipment.updated' : 'equipment.created',
    'equipment',
    data.id,
    { profile_id: profileId },
  ).catch(console.warn)

  return data as EquipmentSetup
}

/** Coach (or admin) updates a linked archer's equipment. */
export async function coachUpdateEquipment(
  archerId: string,
  payload: EquipmentPayload,
): Promise<EquipmentSetup> {
  const { id: actorId, role } = currentActor()
  assertCan(
    role === 'coach' || role === 'admin2' || role === 'super_admin',
    'edit archer equipment',
  )

  const { data: existing } = await supabase
    .from('equipment_setups')
    .select('id')
    .eq('profile_id', archerId)
    .maybeSingle()

  const { data, error } = await supabase
    .from('equipment_setups')
    .upsert(
      { ...payload, profile_id: archerId, updated_by: actorId ?? null },
      { onConflict: 'profile_id' },
    )
    .select('*')
    .single()
  if (error) throw error

  writeAuditLog(
    actorId!,
    role === 'coach' ? 'equipment.coach_updated' : (existing ? 'equipment.updated' : 'equipment.created'),
    'equipment',
    data.id,
    { archer_id: archerId, updated_by: actorId },
  ).catch(console.warn)

  return data as EquipmentSetup
}

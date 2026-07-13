/**
 * Admin 2 User Management service.
 *
 * Every mutation here is defence-in-depth: it fails fast on the client with a
 * friendly message, but RLS in supabase/migrations/006 + 017 remains the real
 * server-side guard. Super Admin protection is enforced TWICE — once by reading
 * the target's actual role from the DB (so a forged argument can't bypass it)
 * and once by RLS once migration 017 PART 2 is applied.
 *
 * Reads/writes go through the writable `public.*` compatibility views
 * (security_invoker), exactly like the other services in this project.
 */
import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import { useAuthStore } from '@/store/authStore'
import {
  assertCan,
  canManageUsers,
  canManageUserWithRole,
  isSuperAdmin,
} from '@/lib/permissions'
import type { AccountStatus, Profile, Role, School, State, Pld } from '@/types'

// ─── ACTOR + GUARD HELPERS ───────────────────────────────────────────────────

function currentActor(): { id: string | undefined; role: Role | undefined } {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

/** Caller must be able to manage users at all (admin2 + super_admin). */
function assertCanManageUsers(): Role | undefined {
  const { role } = currentActor()
  assertCan(canManageUsers(role), 'manage users')
  return role
}

/**
 * Resolve the target's *current* role/status from the DB and assert the actor
 * may act on it. Reading the role server-side means a forged client argument
 * cannot trick the guard into letting Admin 2 touch a Super Admin.
 */
async function assertCanActOnUserId(
  id: string,
): Promise<{ actorId?: string; actorRole?: Role; targetRole: Role; targetStatus: AccountStatus }> {
  const { id: actorId, role: actorRole } = currentActor()
  assertCan(canManageUsers(actorRole), 'manage users')

  const { data, error } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', id)
    .single()
  // With migration 017 PART 2 applied, Admin 2 selecting a Super Admin row
  // returns no rows → this throws, which is the desired denial.
  if (error) throw error

  const targetRole = data.role as Role
  assertCan(
    canManageUserWithRole(actorRole, targetRole),
    `manage a ${targetRole} account`,
  )
  return { actorId, actorRole, targetRole, targetStatus: data.status as AccountStatus }
}

/**
 * Columns that existed BEFORE migration 017. If the migration has not been run
 * yet, writes to the new columns fail with Postgres 42703 (undefined_column);
 * we then retry with only these legacy columns so the core action still works.
 */
const LEGACY_PROFILE_COLUMNS = new Set<string>([
  'status', 'role', 'name', 'age', 'phone',
  'approved_by', 'approved_at', 'rejection_reason',
  'school_id', 'pld_id', 'state_id',
])

/**
 * Update public.profiles, degrading gracefully if migration 017 isn't applied.
 * Exported so the Admin 1 approvals service can reuse the same 42703 fallback.
 */
export async function safeProfileUpdate(id: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('profiles').update(payload).eq('id', id)
  if (!error) return

  if ((error as { code?: string }).code === '42703') {
    const reduced: Record<string, unknown> = {}
    for (const k of Object.keys(payload)) {
      if (LEGACY_PROFILE_COLUMNS.has(k)) reduced[k] = payload[k]
    }
    if (Object.keys(reduced).length > 0) {
      const { error: e2 } = await supabase.from('profiles').update(reduced).eq('id', id)
      if (e2) throw e2
      console.warn(
        '[users] Migration 017 not applied — saved core fields only. ' +
          'Run 017_user_management.sql in Supabase SQL Editor for full tracking.',
      )
      return
    }
  }
  throw error
}

// Plain column selects — NO embedded org joins. PostgREST relationship
// embedding (school:school_id(...)) is unreliable through the security_invoker
// public.profiles view and can fail the whole query with PGRST200, which the
// 42703 fallback below does not catch. We resolve school/PLD/state names
// client-side from a separate lookup instead (see attachOrgRelations).
const PROFILE_SELECT = `
  id, email, name, age, role, status, archer_id, coach_id,
  rejection_reason, approved_by, approved_at,
  rejected_at, rejected_by, suspended_at, suspended_by, suspension_reason,
  admin_notes, phone, gender, bow_category, avatar_url, is_pld_coach,
  school_id, pld_id, state_id, requested_school_id, created_at, updated_at
`

/** Legacy column set for the select, used if 017 columns don't exist yet. */
const PROFILE_SELECT_LEGACY = `
  id, email, name, age, role, status, archer_id, coach_id,
  rejection_reason, approved_by, approved_at,
  phone, gender, bow_category, avatar_url,
  school_id, pld_id, state_id, created_at, updated_at
`

// ─── ORG NAME RESOLUTION (client-side join, replaces PostgREST embedding) ─────

interface OrgLookupMaps {
  states:  Map<string, State>
  plds:    Map<string, Pld>
  schools: Map<string, School>
}

/** Load id→row maps for states/plds/schools so we can attach names to profiles. */
async function fetchOrgLookupMaps(): Promise<OrgLookupMaps> {
  const [st, pl, sc] = await Promise.all([
    supabase.from('states').select('id, name, code'),
    supabase.from('plds').select('id, name, state_id'),
    supabase.from('schools').select('id, name, pld_id, state_id'),
  ])
  const states  = new Map<string, State>((st.data ?? []).map((s) => [s.id, s as State]))
  const plds    = new Map<string, Pld>((pl.data ?? []).map((p) => [p.id, p as Pld]))
  const schools = new Map<string, School>((sc.data ?? []).map((s) => [s.id, s as School]))
  return { states, plds, schools }
}

/** Populate a profile's school/pld/state relations from the lookup maps. */
function attachOrgRelations(p: Profile, maps: OrgLookupMaps): Profile {
  return {
    ...p,
    school: p.school_id ? maps.schools.get(p.school_id) : undefined,
    pld:    p.pld_id    ? maps.plds.get(p.pld_id)       : undefined,
    state:  p.state_id  ? maps.states.get(p.state_id)   : undefined,
    requested_school: p.requested_school_id ? maps.schools.get(p.requested_school_id) : undefined,
  }
}

// ─── READS ───────────────────────────────────────────────────────────────────

/** All users the actor is allowed to see (RLS scopes Super Admins out for Admin 2). */
export interface AdminUserRow extends Profile {
  link_count: number
}

export interface AdminUsersCursor {
  createdAt: string
  id: string
}

export interface AdminUsersFilters {
  search?: string
  role?: string
  status?: string
  stateId?: string
  pldId?: string
  schoolId?: string
  limit?: number
}

interface AdminUserRpcRow extends Omit<Profile, 'role' | 'status' | 'archer_id'> {
  role: Role
  status: AccountStatus
  archer_code: string | null
  school_name: string | null
  pld_name: string | null
  state_name: string | null
  state_code: string | null
  link_count: number | string
}

function mapAdminUserRow(row: AdminUserRpcRow): AdminUserRow {
  return {
    ...row,
    archer_id: row.archer_code ?? undefined,
    link_count: Number(row.link_count),
    school: row.school_id && row.school_name
      ? ({ id: row.school_id, name: row.school_name } as School)
      : undefined,
    pld: row.pld_id && row.pld_name
      ? ({ id: row.pld_id, name: row.pld_name } as Pld)
      : undefined,
    state: row.state_id && row.state_name
      ? ({ id: row.state_id, name: row.state_name, code: row.state_code } as State)
      : undefined,
  } as AdminUserRow
}

export async function getUsersAdminPage(
  filters: AdminUsersFilters = {},
  cursor: AdminUsersCursor | null = null,
): Promise<{ items: AdminUserRow[]; nextCursor: AdminUsersCursor | null; hasMore: boolean }> {
  assertCanManageUsers()
  const pageSize = Math.min(Math.max(filters.limit ?? 50, 1), 100)
  const { data, error } = await supabase.rpc('admin_users_page', {
    p_search: filters.search?.trim() || null,
    p_role: filters.role || null,
    p_status: filters.status || null,
    p_state_id: filters.stateId || null,
    p_pld_id: filters.pldId || null,
    p_school_id: filters.schoolId || null,
    p_after_created: cursor?.createdAt ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: pageSize,
  })
  if (error) throw error

  const fetched = (data ?? []) as unknown as AdminUserRpcRow[]
  const hasMore = fetched.length > pageSize
  const visible = hasMore ? fetched.slice(0, pageSize) : fetched
  const items = visible.map(mapAdminUserRow)
  const last = items[items.length - 1]
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

export interface AdminUserSummary {
  total: number
  pending: number
  approved: number
  rejected: number
  suspended: number
  archers: number
  coaches: number
  admin1: number
  admin2: number
}

export async function getAdminUserSummary(): Promise<AdminUserSummary> {
  assertCanManageUsers()
  const { data, error } = await supabase.rpc('admin_user_summary')
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, number | string> | null
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    rejected: Number(row?.rejected ?? 0),
    suspended: Number(row?.suspended ?? 0),
    archers: Number(row?.archers ?? 0),
    coaches: Number(row?.coaches ?? 0),
    admin1: Number(row?.admin1 ?? 0),
    admin2: Number(row?.admin2 ?? 0),
  }
}

export interface UserDetail {
  profile: Profile
  archer?: {
    age_group?: string
    bow_category?: string
    dominant_hand?: string
    draw_length_in?: number
    notes?: string
  }
  coach?: {
    coach_code?: string
    experience_years?: number
    is_certified?: boolean
    certification_level?: string
    affiliated_org?: string
  }
  recentScores: { id: string; date: string; total_score: number; max_score: number; status: string }[]
  achievementCount: number
  auditLogs: { id: string; action: string; created_at: string; meta?: Record<string, unknown> }[]
}

/** Rich detail for the View modal. Each extra is best-effort and degrades to empty. */
export async function getUserByIdAdmin(id: string): Promise<UserDetail> {
  assertCanManageUsers()

  const primary = await supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', id)
    .single()
  let profileRow: unknown = primary.data
  if (primary.error) {
    if ((primary.error as { code?: string }).code === '42703') {
      const legacy = await supabase
        .from('profiles')
        .select(PROFILE_SELECT_LEGACY)
        .eq('id', id)
        .single()
      if (legacy.error) throw legacy.error
      profileRow = legacy.data
    } else {
      throw primary.error
    }
  }
  const rawProfile = profileRow as Profile
  const maps = await fetchOrgLookupMaps()
  const p = attachOrgRelations(rawProfile, maps)

  const detail: UserDetail = { profile: p, recentScores: [], achievementCount: 0, auditLogs: [] }

  if (p.role === 'archer') {
    const { data } = await supabase
      .from('archer_profiles')
      .select('age_group, bow_category, dominant_hand, draw_length_in, notes')
      .eq('profile_id', id)
      .maybeSingle()
      .then((r) => r, () => ({ data: null }))
    if (data) detail.archer = data as UserDetail['archer']

    const { data: scores } = await supabase
      .from('score_submissions')
      .select('id, date, total_score, max_score, status')
      .eq('archer_id', id)
      .order('date', { ascending: false })
      .limit(5)
      .then((r) => r, () => ({ data: [] }))
    detail.recentScores = (scores ?? []) as UserDetail['recentScores']
  }

  if (p.role === 'coach') {
    const { data } = await supabase
      .from('coach_profiles')
      .select('coach_code, experience_years, is_certified, certification_level, affiliated_org')
      .eq('profile_id', id)
      .maybeSingle()
      .then((r) => r, () => ({ data: null }))
    if (data) detail.coach = data as UserDetail['coach']
  }

  const { count } = await supabase
    .from('user_achievements')
    .select('id', { count: 'exact', head: true })
    .eq('profile_id', id)
    .then((r) => r, () => ({ count: 0 }))
  detail.achievementCount = count ?? 0

  const { data: logs } = await supabase
    .from('audit_logs')
    .select('id, action, created_at, meta')
    .eq('target_id', id)
    .order('created_at', { ascending: false })
    .limit(8)
    .then((r) => r, () => ({ data: [] }))
  detail.auditLogs = (logs ?? []) as UserDetail['auditLogs']

  return detail
}

// ─── ORGANIZATION OPTIONS ────────────────────────────────────────────────────

export interface OrganizationOptions {
  states: State[]
  plds: Pld[]
  schools: School[]
}

export async function getOrganizationOptions(): Promise<OrganizationOptions> {
  const [statesRes, pldsRes, schoolsRes] = await Promise.all([
    supabase.from('states').select('id, name, code').order('name'),
    supabase.from('plds').select('id, name, state_id').order('name'),
    supabase.from('schools').select('id, name, pld_id, state_id, active').order('name'),
  ])
  if (statesRes.error) throw statesRes.error
  return {
    states: (statesRes.data ?? []) as State[],
    plds: (pldsRes.data ?? []) as Pld[],
    schools: (schoolsRes.data ?? []) as School[],
  }
}

// ─── COACH–ARCHER LINKS ──────────────────────────────────────────────────────

export interface CoachArcherLinkRow {
  id: string
  coach_id: string
  archer_id: string
  status: string
  linked_at: string
  unlinked_at?: string
}

export interface AdminUserLinkRow extends CoachArcherLinkRow {
  other_id: string
  other_name: string
  other_archer_code?: string
}

export async function getCoachArcherLinksForUser(userId: string): Promise<AdminUserLinkRow[]> {
  assertCanManageUsers()
  const { data, error } = await supabase.rpc('admin_user_links', { p_user: userId })
  if (error) throw error
  return (data ?? []) as unknown as AdminUserLinkRow[]
}

// ─── LIFECYCLE MUTATIONS ─────────────────────────────────────────────────────

export async function approveUser(id: string): Promise<void> {
  const { actorId, targetRole } = await assertCanActOnUserId(id)
  await safeProfileUpdate(id, {
    status: 'approved' as AccountStatus,
    approved_by: actorId ?? null,
    approved_at: new Date().toISOString(),
    rejection_reason: null,
    rejected_at: null,
    rejected_by: null,
    suspension_reason: null,
    suspended_at: null,
    suspended_by: null,
  })
  if (actorId) {
    await writeAuditLog(actorId, 'user.approved', 'profile', id, { target_role: targetRole })
  }
}

export async function rejectUser(id: string, reason: string): Promise<void> {
  const clean = reason.trim()
  if (!clean) throw new Error('A rejection reason is required.')
  const { actorId, targetRole } = await assertCanActOnUserId(id)
  await safeProfileUpdate(id, {
    status: 'rejected' as AccountStatus,
    rejection_reason: clean,
    rejected_at: new Date().toISOString(),
    rejected_by: actorId ?? null,
  })
  if (actorId) {
    await writeAuditLog(actorId, 'user.rejected', 'profile', id, {
      target_role: targetRole,
      reason: clean,
    })
  }
}

export async function suspendUser(id: string, reason: string): Promise<void> {
  const clean = reason.trim()
  if (!clean) throw new Error('A suspension reason is required.')
  const { actorId, targetRole } = await assertCanActOnUserId(id)
  await safeProfileUpdate(id, {
    status: 'suspended' as AccountStatus,
    suspension_reason: clean,
    suspended_at: new Date().toISOString(),
    suspended_by: actorId ?? null,
  })
  if (actorId) {
    await writeAuditLog(actorId, 'user.suspended', 'profile', id, {
      target_role: targetRole,
      reason: clean,
    })
  }
}

export async function reactivateUser(id: string): Promise<void> {
  const { actorId, targetRole } = await assertCanActOnUserId(id)
  await safeProfileUpdate(id, {
    status: 'approved' as AccountStatus,
    suspension_reason: null,
    suspended_at: null,
    suspended_by: null,
  })
  if (actorId) {
    await writeAuditLog(actorId, 'user.reactivated', 'profile', id, { target_role: targetRole })
  }
}

/**
 * SUPER ADMIN ONLY — permanently delete a user and ALL their data end-to-end
 * (profile + cascaded data + auth login). Backed by the admin_delete_user RPC
 * (SECURITY DEFINER), which also enforces super-admin-only + no-self-delete and
 * writes the audit log server-side. This is irreversible.
 */
export async function deleteUserCompletely(id: string): Promise<void> {
  const { id: actorId, role } = currentActor()
  assertCan(isSuperAdmin(role), 'permanently delete users')
  if (id === actorId) throw new Error('You cannot delete your own account.')
  const { error } = await supabase.rpc('admin_delete_user', { p_target: id })
  if (error) throw error
}

// ─── PROFILE / ORG / ROLE EDITS ──────────────────────────────────────────────

export interface UpdateUserPayload {
  name?: string
  status?: AccountStatus
  state_id?: string | null
  pld_id?: string | null
  school_id?: string | null
  phone?: string | null
  admin_notes?: string | null
  /** Coach only — designates the PLD Coach who validates coach scores in their PLD. */
  is_pld_coach?: boolean
}

/** Edit non-role profile/admin fields. Role changes go through changeUserRole. */
export async function updateUserAdmin(id: string, payload: UpdateUserPayload): Promise<void> {
  const { actorId, targetRole } = await assertCanActOnUserId(id)

  const update: Record<string, unknown> = {}
  if (payload.name !== undefined) update.name = payload.name.trim()
  if (payload.status !== undefined) update.status = payload.status
  if (payload.state_id !== undefined) update.state_id = payload.state_id
  if (payload.pld_id !== undefined) update.pld_id = payload.pld_id
  if (payload.school_id !== undefined) update.school_id = payload.school_id
  if (payload.phone !== undefined) update.phone = payload.phone
  if (payload.admin_notes !== undefined) update.admin_notes = payload.admin_notes
  if (payload.is_pld_coach !== undefined) update.is_pld_coach = payload.is_pld_coach

  if (Object.keys(update).length === 0) return
  await safeProfileUpdate(id, update)

  if (actorId) {
    await writeAuditLog(actorId, 'user.updated', 'profile', id, {
      target_role: targetRole,
      fields: Object.keys(update),
    })
  }
}

export async function assignUserOrganization(
  id: string,
  stateId: string | null,
  pldId: string | null,
  schoolId: string | null,
): Promise<void> {
  const { actorId, targetRole } = await assertCanActOnUserId(id)
  await safeProfileUpdate(id, {
    state_id: stateId,
    pld_id: pldId,
    school_id: schoolId,
  })
  if (actorId) {
    await writeAuditLog(actorId, 'user.organization_assigned', 'profile', id, {
      target_role: targetRole,
      state_id: stateId,
      pld_id: pldId,
      school_id: schoolId,
    })
  }
}

export async function changeUserRole(id: string, newRole: Role): Promise<void> {
  const { actorId, actorRole, targetRole } = await assertCanActOnUserId(id)

  // Only Super Admin may ASSIGN the super_admin role. Admin 2 is capped below it.
  if (newRole === 'super_admin') {
    assertCan(isSuperAdmin(actorRole), 'assign the Super Admin role')
  }
  // Re-confirm the actor may act on the *target* role too (e.g. cannot demote SA).
  assertCan(canManageUserWithRole(actorRole, targetRole), `change a ${targetRole} account's role`)

  if (newRole === targetRole) return

  await safeProfileUpdate(id, { role: newRole })

  if (actorId) {
    await writeAuditLog(actorId, 'user.role_changed', 'profile', id, {
      old_role: targetRole,
      new_role: newRole,
    })
  }
}

// ─── COACH–ARCHER LINK MUTATIONS ─────────────────────────────────────────────

/**
 * Link a coach to an archer. Idempotent against the (coach_id, archer_id) unique
 * constraint: a pre-existing (possibly inactive) link is re-activated rather than
 * re-inserted, so re-linking never throws a duplicate-key error.
 */
export async function linkCoachToArcher(coachId: string, archerId: string): Promise<void> {
  const actorRole = assertCanManageUsers()
  if (coachId === archerId) throw new Error('A user cannot be linked to themselves.')

  const now = new Date().toISOString()
  const { id: actorId } = currentActor()

  const { data: existing } = await supabase
    .from('coach_archer_links')
    .select('id, status')
    .eq('coach_id', coachId)
    .eq('archer_id', archerId)
    .maybeSingle()

  if (existing) {
    if (existing.status === 'active') return // already linked, nothing to do
    const { error } = await supabase
      .from('coach_archer_links')
      .update({
        status: 'active',
        linked_at: now,
        approved_at: now,
        approved_by: actorId ?? null,
        unlinked_at: null,
        rejected_at: null,
        rejection_reason: null,
      })
      .eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('coach_archer_links').insert({
      coach_id: coachId,
      archer_id: archerId,
      status: 'active',
      linked_at: now,
      approved_at: now,
      approved_by: actorId ?? null,
    })
    if (error) throw error
  }

  if (actorId) {
    await writeAuditLog(actorId, 'coach_archer_link.created', 'coach_archer_link', undefined, {
      coach_id: coachId,
      archer_id: archerId,
      by_role: actorRole,
    })
  }
}

/** Soft-remove a link (status → inactive) so the relationship history is kept. */
export async function unlinkCoachFromArcher(linkId: string): Promise<void> {
  assertCanManageUsers()
  const { id: actorId } = currentActor()

  const { data: link, error: readErr } = await supabase
    .from('coach_archer_links')
    .select('coach_id, archer_id')
    .eq('id', linkId)
    .maybeSingle()
  if (readErr) throw readErr

  const { error } = await supabase
    .from('coach_archer_links')
    .update({ status: 'inactive', unlinked_at: new Date().toISOString() })
    .eq('id', linkId)
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'coach_archer_link.removed', 'coach_archer_link', linkId, {
      coach_id: link?.coach_id,
      archer_id: link?.archer_id,
    })
  }
}

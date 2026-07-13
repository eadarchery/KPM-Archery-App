/**
 * Admin 1 Approval Center service.
 *
 * Admin 1 may approve/reject ONLY archers and coaches inside their assigned (or
 * derived) scope. Scope is enforced three ways:
 *   1. Client UI hides/disables out-of-scope actions.
 *   2. These service guards re-check role + scope before any write (and read
 *      the target's location from the DB, so a forged arg can't bypass it).
 *   3. RLS `core_profiles_admin1_approve_in_scope` (migration 018) is the real
 *      server-side guard.
 * Super Admin bypasses scope (full override).
 *
 * Reuses src/services/users.ts (`safeProfileUpdate`, `getOrganizationOptions`)
 * and src/lib/scope.ts to avoid duplicating logic.
 */
import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import { safeProfileUpdate, getOrganizationOptions, type OrganizationOptions } from './users'
import { fetchOrgMaps } from './orgLookup'
import { useAuthStore } from '@/store/authStore'
import { assertCan, canApproveRegistrations, canAccessAdmin1, isSuperAdmin } from '@/lib/permissions'
import { isUserWithinAdminScope, matchesAssignments } from '@/lib/scope'
import { getAdmin1Scopes } from './adminScopes'
import type { Profile } from '@/types'

// ─── ACTOR + GUARDS ──────────────────────────────────────────────────────────

function actor(): Profile | null {
  return useAuthStore.getState().profile
}

/** Page/data access: Admin 1 or Super Admin (admin2 uses its own user manager). */
function assertCanAccessApprovals(): Profile | null {
  const a = actor()
  assertCan(
    canApproveRegistrations(a?.role) && canAccessAdmin1(a?.role),
    'access the approval center',
  )
  return a
}

// ─── SELECTS (with 42703 fallback for pre-017 DBs) ───────────────────────────

// Plain columns — no embedded org joins (see src/services/orgLookup.ts).
const SELECT_FULL = `
  id, email, name, role, status, archer_id, phone, age, gender, bow_category,
  rejection_reason, approved_by, approved_at, rejected_at, rejected_by,
  created_at, updated_at, school_id, pld_id, state_id
`
const SELECT_LEGACY = `
  id, email, name, role, status, archer_id, phone, age, gender, bow_category,
  rejection_reason, approved_by, approved_at,
  created_at, updated_at, school_id, pld_id, state_id
`

async function fetchApprovalRows(statuses: string[]): Promise<Profile[]> {
  const run = (sel: string) =>
    supabase
      .from('profiles')
      .select(sel)
      .in('role', ['archer', 'coach'])
      .in('status', statuses)
      .order('created_at', { ascending: false })

  const primary = await run(SELECT_FULL)
  let rows: unknown = primary.data
  if (primary.error) {
    if ((primary.error as { code?: string }).code === '42703') {
      const legacy = await run(SELECT_LEGACY)
      if (legacy.error) throw legacy.error
      rows = legacy.data
    } else {
      throw primary.error
    }
  }
  const profiles = (rows ?? []) as Profile[]
  const maps = await fetchOrgMaps()
  return profiles.map((p) => ({
    ...p,
    school: p.school_id ? maps.schools.get(p.school_id) : undefined,
    pld:    p.pld_id    ? maps.plds.get(p.pld_id)       : undefined,
    state:  p.state_id  ? maps.states.get(p.state_id)   : undefined,
  })) as unknown as Profile[]
}

// ─── READS ───────────────────────────────────────────────────────────────────

/** Pending archers/coaches (admin1 reads nationally; the page splits by scope). */
export async function getPendingApprovalsForAdmin1(_admin?: Profile | null): Promise<Profile[]> {
  assertCanAccessApprovals()
  return fetchApprovalRows(['pending'])
}

/** Approved + rejected archers/coaches for the history tabs. */
export async function getApprovalHistoryForAdmin1(_admin?: Profile | null): Promise<Profile[]> {
  assertCanAccessApprovals()
  return fetchApprovalRows(['approved', 'rejected'])
}

/** Organisation lookups for the scope banner + filters. Reuses users.ts. */
export async function getAdmin1ScopeOptions(): Promise<OrganizationOptions> {
  return getOrganizationOptions()
}

/** Thin wrapper around the pure scope helper, for service-style callers. */
export function getScopeMatchForUser(admin: Profile | null | undefined, target: Profile): boolean {
  return isUserWithinAdminScope(admin, target)
}

// ─── INTERNAL: shared approve/reject guard ───────────────────────────────────

async function assertCanActOnTarget(userId: string): Promise<{
  admin: Profile | null
  target: Pick<Profile, 'id' | 'role' | 'status' | 'school_id' | 'pld_id' | 'state_id'>
}> {
  const admin = actor()
  assertCan(
    canApproveRegistrations(admin?.role) && canAccessAdmin1(admin?.role),
    'approve or reject registrations',
  )

  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, status, school_id, pld_id, state_id')
    .eq('id', userId)
    .single()
  if (error) throw error
  const target = data as Pick<Profile, 'id' | 'role' | 'status' | 'school_id' | 'pld_id' | 'state_id'>

  if (!isSuperAdmin(admin?.role)) {
    // Admin 1 may only act on archers/coaches — never Admin 2 / Super Admin.
    if (target.role !== 'archer' && target.role !== 'coach') {
      throw new Error('Admin 1 can only approve archers and coaches.')
    }
    // …and only inside their scope. Multi-scope assignments (migration 052)
    // take precedence over the legacy single/derived scope when any exist.
    const assignments = admin?.id ? await getAdmin1Scopes(admin.id).catch(() => []) : []
    const scoped = assignments.length > 0
      ? matchesAssignments(assignments, {
          stateId: target.state_id ?? undefined,
          pldId: target.pld_id ?? undefined,
          schoolId: target.school_id ?? undefined,
        })
      : isUserWithinAdminScope(admin, target as Profile)
    if (!scoped) {
      if (admin?.id) {
        await writeAuditLog(admin.id, 'approval.scope_denied', 'profile', userId, {
          target_role: target.role,
          target_state: target.state_id,
          target_pld: target.pld_id,
          target_school: target.school_id,
        })
      }
      throw new Error('This user is outside your approval scope.')
    }
  }
  return { admin, target }
}

// ─── MUTATIONS ───────────────────────────────────────────────────────────────

export async function approveUserByAdmin1(userId: string): Promise<void> {
  const { admin, target } = await assertCanActOnTarget(userId)
  await safeProfileUpdate(userId, {
    status: 'approved',
    approved_by: admin?.id ?? null,
    approved_at: new Date().toISOString(),
    rejection_reason: null,
    rejected_at: null,
    rejected_by: null,
  })
  if (admin?.id) {
    await writeAuditLog(admin.id, 'user.approved_by_admin1', 'profile', userId, {
      target_role: target.role,
    })
  }
}

export async function rejectUserByAdmin1(userId: string, reason: string): Promise<void> {
  const clean = reason.trim()
  if (!clean) throw new Error('A rejection reason is required.')
  const { admin, target } = await assertCanActOnTarget(userId)
  await safeProfileUpdate(userId, {
    status: 'rejected',
    rejection_reason: clean,
    rejected_at: new Date().toISOString(),
    rejected_by: admin?.id ?? null,
  })
  if (admin?.id) {
    await writeAuditLog(admin.id, 'user.rejected_by_admin1', 'profile', userId, {
      target_role: target.role,
      reason: clean,
    })
  }
}

/** Best-effort audit when an admin opens a user's approval details. Non-blocking. */
export async function logApprovalDetailView(userId: string, targetRole?: string): Promise<void> {
  const a = actor()
  if (!a?.id) return
  try {
    await writeAuditLog(a.id, 'approval.viewed_details', 'profile', userId, { target_role: targetRole })
  } catch {
    /* non-critical */
  }
}

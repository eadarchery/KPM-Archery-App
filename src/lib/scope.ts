/**
 * Admin 1 approval-scope logic — pure helpers (no React, no Supabase) so the
 * same rules run in the page, the service guard, and (mirrored) in the RLS
 * function `core.admin1_in_scope` from supabase/migrations/018.
 *
 * An Admin 1's effective scope is resolved in priority order:
 *   1. Explicit assignment — `scope_type` + the matching `assigned_*_id`
 *      (set by Admin 2 / Super Admin in user management).
 *   2. Derived from the admin's own location — most specific of
 *      `school_id` → `pld_id` → `state_id`.
 *   3. None — the admin has no scope and may approve nobody.
 *
 * A target user is "in scope" when their profile's location matches the admin's
 * effective scope at the relevant level. Super Admin bypasses scope entirely
 * (handled by the caller, not here).
 */
import type { Profile } from '@/types'

type Translate = (key: string, vars?: Record<string, string | number>) => string

export type ScopeType = 'national' | 'state' | 'pld' | 'school' | 'none'

export interface AdminScope {
  type: ScopeType
  stateId?: string
  pldId?: string
  schoolId?: string
  /** Where the scope came from — useful for UI hints. */
  source: 'assigned' | 'derived' | 'none'
}

export interface UserScope {
  stateId?: string
  pldId?: string
  schoolId?: string
}

export interface ScopeNames {
  state?: string
  pld?: string
  school?: string
}

/** The location a target user belongs to (used for matching). */
export function getUserScope(p: Profile): UserScope {
  return { stateId: p.state_id, pldId: p.pld_id, schoolId: p.school_id }
}

// ─── MULTI-SCOPE (migration 052: core.admin1_scopes checkboxes) ─────────────
// When an Admin 1 has assignment rows, effective scope = UNION of all ticks:
// a state tick covers everything in the state; a PLD tick everything in the
// PLD; a school tick that school only. Mirrors core.admin1_in_scope.

export interface ScopeAssignment {
  level: 'state' | 'pld' | 'school'
  ref_id: string
}

export function matchesAssignments(rows: ScopeAssignment[], user: UserScope): boolean {
  return rows.some(r =>
    (r.level === 'state'  && !!user.stateId  && r.ref_id === user.stateId) ||
    (r.level === 'pld'    && !!user.pldId    && r.ref_id === user.pldId) ||
    (r.level === 'school' && !!user.schoolId && r.ref_id === user.schoolId),
  )
}

/** Short human label: "2 states · 1 PLD · 3 schools". */
export function assignmentsSummary(t: Translate, rows: ScopeAssignment[]): string {
  const n = (level: ScopeAssignment['level']) => rows.filter(r => r.level === level).length
  const parts: string[] = []
  const s = n('state'), p = n('pld'), c = n('school')
  if (s) parts.push(t('scope.statesCount', { count: s }))
  if (p) parts.push(t('scope.pldsCount', { count: p }))
  if (c) parts.push(t('scope.schoolsCount', { count: c }))
  return parts.join(' · ') || t('scope.noAssignments')
}

/** Resolve an Admin 1's effective approval scope (assigned → derived → none). */
export function getAdminScope(admin: Profile | null | undefined): AdminScope {
  if (!admin) return { type: 'none', source: 'none' }

  // 1. Explicit assignment
  switch (admin.scope_type) {
    case 'national':
      return { type: 'national', source: 'assigned' }
    case 'school':
      if (admin.assigned_school_id) return { type: 'school', schoolId: admin.assigned_school_id, source: 'assigned' }
      break
    case 'pld':
      if (admin.assigned_pld_id) return { type: 'pld', pldId: admin.assigned_pld_id, source: 'assigned' }
      break
    case 'state':
      if (admin.assigned_state_id) return { type: 'state', stateId: admin.assigned_state_id, source: 'assigned' }
      break
  }

  // 2. Derived from the admin's own location (most specific first)
  if (admin.school_id) return { type: 'school', schoolId: admin.school_id, source: 'derived' }
  if (admin.pld_id)    return { type: 'pld', pldId: admin.pld_id, source: 'derived' }
  if (admin.state_id)  return { type: 'state', stateId: admin.state_id, source: 'derived' }

  // 3. No scope
  return { type: 'none', source: 'none' }
}

/** True when `target` falls within `admin`'s effective scope. Default deny. */
export function isUserWithinAdminScope(admin: Profile | null | undefined, target: Profile): boolean {
  const scope = getAdminScope(admin)
  switch (scope.type) {
    case 'national': return true
    case 'school':   return !!scope.schoolId && target.school_id === scope.schoolId
    case 'pld':      return !!scope.pldId && target.pld_id === scope.pldId
    case 'state':    return !!scope.stateId && target.state_id === scope.stateId
    case 'none':     return false
  }
}

/** Human-readable reason a target is out of scope, or null when in scope. */
export function getScopeMismatchReason(t: Translate, admin: Profile | null | undefined, target: Profile): string | null {
  const scope = getAdminScope(admin)
  if (scope.type === 'none') return t('scope.noneReason')
  if (isUserWithinAdminScope(admin, target)) return null
  switch (scope.type) {
    case 'school': return t('scope.mismatchSchool')
    case 'pld':    return t('scope.mismatchPld')
    case 'state':  return t('scope.mismatchState')
    default:       return t('scope.mismatchGeneric')
  }
}

/** A short label for the admin's scope, e.g. "School — SMK Example" or "Not assigned". */
export function getScopeLabel(t: Translate, admin: Profile | null | undefined, names?: ScopeNames): string {
  const scope = getAdminScope(admin)
  switch (scope.type) {
    case 'national': return t('scope.national')
    case 'school':   return `${t('common.school')} — ${names?.school ?? t('scope.assignedSchool')}`
    case 'pld':      return `${t('common.pld')} — ${names?.pld ?? t('scope.assignedPld')}`
    case 'state':    return `${t('common.state')} — ${names?.state ?? t('scope.assignedState')}`
    case 'none':     return t('scope.notAssigned')
  }
}

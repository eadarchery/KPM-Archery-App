/**
 * Centralised, role-based permission helpers — the app's STRUCTURAL
 * permission model (what a role can *ever* do).
 *
 * These are PURE functions of the user's role (no React, no Supabase) so the
 * same check can run in components, route guards and services.
 *
 * They intentionally mirror the database RLS helpers in
 * supabase/migrations/006_rls_api_views.sql:
 *   core.is_admin()        → admin2 + super_admin   →  isOperationalAdmin()
 *   core.is_super_admin()  → super_admin            →  isSuperAdmin()
 * RLS remains the FINAL authority on the server; these helpers gate the UI
 * and fail fast with friendly messages on the client.
 *
 * Relationship to the other permission modules:
 *   • this file (lib/permissions)      — fixed, role-based baseline (use first)
 *   • services/permissions.ts          — super-admin-configurable permission MAP
 *   • hooks/usePermissions.ts          — React access to that DB map (`can()`)
 * Treat this file as the ceiling a role can never exceed; the DB map may only
 * narrow behaviour within it later.
 *
 * Every helper grants super_admin by design — super_admin overrides all
 * normal restrictions.
 */
import type { Role } from '@/types'
import { type AppSection, ROLE_SECTIONS, sectionForPath } from './roleConfig'

// Re-export config helpers so callers can import everything from one place.
export {
  getHomePath,
  roleRank,
  roleAtLeast,
  ROLE_HIERARCHY,
  sectionForPath,
} from './roleConfig'
export type { AppSection } from './roleConfig'

type MaybeRole = Role | null | undefined

/** Internal — true when `role` is one of `roles`. */
function oneOf(role: MaybeRole, roles: Role[]): boolean {
  return role != null && roles.includes(role)
}

// ─── ROLE PREDICATES ────────────────────────────────────────────────────────────

export function isSuperAdmin(role: MaybeRole): boolean {
  return role === 'super_admin'
}

/** Any admin tier — regional (admin1), national (admin2) or system owner. */
export function isAdminRole(role: MaybeRole): boolean {
  return oneOf(role, ['admin1', 'admin2', 'super_admin'])
}

/**
 * National operational admin — mirrors DB `core.is_admin()`.
 * May manage national content (achievements, articles, users, schools, PLDs,
 * states, audit). admin1 is intentionally excluded (it is read-mostly and,
 * once scope fields ship, region-limited).
 */
export function isOperationalAdmin(role: MaybeRole): boolean {
  return oneOf(role, ['admin2', 'super_admin'])
}

// ─── SECTION / ROUTE ACCESS ──────────────────────────────────────────────────────

export function canAccessRoleSection(role: MaybeRole, section: AppSection): boolean {
  return role != null && ROLE_SECTIONS[role].includes(section)
}

export function canAccessRoute(role: MaybeRole, path: string): boolean {
  const section = sectionForPath(path)
  if (section == null) return true // public / unknown → leave to the router
  return canAccessRoleSection(role, section)
}

export function canAccessAdmin1(role: MaybeRole): boolean {
  return oneOf(role, ['admin1', 'super_admin'])
}

export function canAccessAdmin2(role: MaybeRole): boolean {
  return oneOf(role, ['admin2', 'super_admin'])
}

export function canAccessSuperAdmin(role: MaybeRole): boolean {
  return isSuperAdmin(role)
}

// ─── ACHIEVEMENTS ─────────────────────────────────────────────────────────────────

export function canManageAchievements(role: MaybeRole): boolean {
  return isOperationalAdmin(role) // admin2 + super_admin (RLS-backed)
}

export function canViewAchievements(_role: MaybeRole): boolean {
  return true // all approved users
}

// ─── NOTIFICATIONS ─────────────────────────────────────────────────────────────────
// admin1 may author notifications today; scoped/global targeting is future work.

export function canManageNotifications(role: MaybeRole): boolean {
  return oneOf(role, ['admin1', 'admin2', 'super_admin'])
}

export function canViewNotifications(_role: MaybeRole): boolean {
  return true
}

// ─── ARTICLES ─────────────────────────────────────────────────────────────────────

export function canManageArticles(role: MaybeRole): boolean {
  return isOperationalAdmin(role) // admin2 + super_admin (RLS-backed)
}

export function canViewArticles(_role: MaybeRole): boolean {
  return true
}

// ─── EQUIPMENT ────────────────────────────────────────────────────────────────

/** Archer, coach, admin2 and super_admin may view equipment profiles. */
export function canViewEquipment(role: MaybeRole): boolean {
  return oneOf(role, ['archer', 'coach', 'admin2', 'super_admin'])
}

/**
 * Static baseline for direct equipment edits (admin2/super_admin only).
 * Archer and coach edit access is gated by system rules at the component
 * level; the RLS coach-update policy enforces it server-side.
 */
export function canEditEquipment(role: MaybeRole): boolean {
  return isOperationalAdmin(role)
}

// ─── USERS / ORG STRUCTURE ──────────────────────────────────────────────────────────

export function canManageUsers(role: MaybeRole): boolean {
  return isOperationalAdmin(role)
}

export function canManageSchools(role: MaybeRole): boolean {
  return isOperationalAdmin(role)
}

export function canManagePLDs(role: MaybeRole): boolean {
  return isOperationalAdmin(role)
}

export function canManageStates(role: MaybeRole): boolean {
  return isOperationalAdmin(role)
}

// ─── APPROVALS / SCORE VALIDATION ────────────────────────────────────────────────────

export function canApproveRegistrations(role: MaybeRole): boolean {
  // admin1 approves registrations within its assigned scope (Approval Center);
  // scope is enforced separately via src/lib/scope.ts + RLS (migration 018).
  return oneOf(role, ['coach', 'admin1', 'admin2', 'super_admin'])
}

export function canValidateTrainingScores(role: MaybeRole): boolean {
  return oneOf(role, ['coach', 'admin2', 'super_admin'])
}

export function canValidateTournamentScores(role: MaybeRole): boolean {
  return isOperationalAdmin(role) // admin2 + super_admin
}

/** Umbrella: may approve/validate at least one kind of score. */
export function canApproveScores(role: MaybeRole): boolean {
  return canValidateTrainingScores(role) || canValidateTournamentScores(role)
}

// ─── PROFILE ─────────────────────────────────────────────────────────────────────────

/** Archer and coach may edit their own profile. */
export function canEditOwnProfile(role: MaybeRole): boolean {
  return oneOf(role, ['archer', 'coach'])
}

/** Coach can view their own certifications; admin2/super_admin can view all. */
export function canViewCertifications(role: MaybeRole): boolean {
  return oneOf(role, ['coach', 'admin2', 'super_admin'])
}

/** Coach and super_admin may access coach-section routes. */
export function canAccessCoach(role: MaybeRole): boolean {
  return oneOf(role, ['coach', 'super_admin'])
}

// ─── REPORTS / AUDIT ──────────────────────────────────────────────────────────────────

export function canViewReports(role: MaybeRole): boolean {
  return oneOf(role, ['admin1', 'admin2', 'super_admin'])
}

export function canViewAuditLogs(role: MaybeRole): boolean {
  return isOperationalAdmin(role) // admin2 + super_admin
}

// ─── SUPER-ADMIN ONLY ────────────────────────────────────────────────────────────────

export function canManageSystemRules(role: MaybeRole): boolean {
  return isSuperAdmin(role)
}

export function canManageRolePermissions(role: MaybeRole): boolean {
  return isSuperAdmin(role)
}

export function canManageAppSettings(role: MaybeRole): boolean {
  return isSuperAdmin(role)
}

export function canManageBranding(role: MaybeRole): boolean {
  return isSuperAdmin(role)
}

// ─── SUPER-ADMIN-PROTECTED TARGET CHECKS ──────────────────────────────────────────────
// Guard rails so a non-super-admin can never act on a super_admin account.

/**
 * Only Super Admin may create, edit or otherwise manage Super Admin accounts.
 * This is the single source of truth for the "who can touch a super_admin"
 * question — `canManageUserWithRole()` defers to it for super_admin targets.
 */
export function canManageSuperAdminUsers(role: MaybeRole): boolean {
  return isSuperAdmin(role)
}

/**
 * Entry gate for changing another user's role (admin2 + super_admin).
 *
 * This only says the actor may use the change-role control at all. Acting on, or
 * elevating a user TO, super_admin additionally requires
 * `canManageSuperAdminUsers()` / `canManageUserWithRole()` — so Admin 2 can never
 * elevate a user to Super Admin nor modify an existing Super Admin.
 */
export function canChangeUserRole(role: MaybeRole): boolean {
  return isOperationalAdmin(role)
}

/** Can `actor` create/edit/suspend a user whose role is `targetRole`? */
export function canManageUserWithRole(actor: MaybeRole, targetRole: Role): boolean {
  if (!canManageUsers(actor)) return false
  if (targetRole === 'super_admin') return canManageSuperAdminUsers(actor) // only SA touches SA
  return true
}

/** Can `actor` delete or demote a user whose role is `targetRole`? */
export function canDeleteOrDemoteUser(actor: MaybeRole, targetRole: Role): boolean {
  if (targetRole === 'super_admin') return false // super_admin is never demotable from UI
  return canManageUserWithRole(actor, targetRole)
}

// ─── OPTIONAL SERVICE-LAYER GUARD ──────────────────────────────────────────────────────

/**
 * Fail fast on an unauthorized client-side mutation with a clear message,
 * instead of surfacing a raw Postgres/RLS error. RLS is still the real guard;
 * use this sparingly in service functions for defense-in-depth + better UX.
 */
export function assertCan(allowed: boolean, action = 'perform this action'): void {
  if (!allowed) {
    throw new Error(`You do not have permission to ${action}.`)
  }
}

// ─── DYNAMIC ROLE PERMISSIONS (DB-backed, layered on the static model) ──────────────

/**
 * Permission keys permanently restricted to Super Admin. Lower roles can NEVER
 * hold these — even if a DB row or a failed fetch suggests otherwise. This is the
 * hard safety floor for `hasRolePermission()` and the source of truth shared with
 * the role-permissions seed defaults (src/services/rolePermissions.ts).
 */
export const SUPER_ADMIN_LOCKED_OFF_KEYS: ReadonlySet<string> = new Set([
  'manage_role_permissions',
  'manage_system_rules',
  'manage_super_admin_users',
  'access_super_admin_role_permissions',
  'access_super_admin_system_rules',
  'enable_maintenance_mode',
  'disable_maintenance_mode',
])

/** Map of `${role}:${permission_key}` → enabled, built from DB role_permissions. */
export type RolePermissionMap = Record<string, boolean>

export function rolePermissionKey(role: Role, permissionKey: string): string {
  return `${role}:${permissionKey}`
}

/**
 * Dynamic permission check, layered safely on top of the static role model.
 *
 *  • Super Admin → always allowed (overrides everything).
 *  • Lower roles → super-admin-only keys are ALWAYS denied (locked floor), so a
 *    missing or failed fetch can never escalate privileges.
 *  • Otherwise use the DB value when present; else fall back to the caller's
 *    static result (e.g. `canManageArticles(role)`); else a safe `false`.
 *
 * The static helpers above remain the dependable fallback — pass one as `fallback`.
 */
export function hasRolePermission(
  role: MaybeRole,
  permissionKey: string,
  dynamic?: RolePermissionMap,
  fallback?: boolean,
): boolean {
  if (role == null) return false
  if (role === 'super_admin') return true
  if (SUPER_ADMIN_LOCKED_OFF_KEYS.has(permissionKey)) return false
  const dynVal = dynamic?.[rolePermissionKey(role, permissionKey)]
  if (typeof dynVal === 'boolean') return dynVal
  return fallback ?? false
}

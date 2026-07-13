import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import { useAuthStore } from '@/store/authStore'
import {
  assertCan,
  canManageRolePermissions,
  SUPER_ADMIN_LOCKED_OFF_KEYS,
} from '@/lib/permissions'
import type { Role, RolePermission } from '@/types'

// ─── CATEGORIES ────────────────────────────────────────────────────────────────

export const ROLE_PERMISSION_CATEGORIES: { key: string; label: string; labelKey: string }[] = [
  { key: 'navigation',    label: 'Navigation',      labelKey: 'rolePermCat.navigation' },
  { key: 'users',         label: 'Users',           labelKey: 'rolePermCat.users' },
  { key: 'scores',        label: 'Scores',          labelKey: 'rolePermCat.scores' },
  { key: 'achievements',  label: 'Achievements',    labelKey: 'rolePermCat.achievements' },
  { key: 'notifications', label: 'Notifications',   labelKey: 'rolePermCat.notifications' },
  { key: 'articles',      label: 'Articles',        labelKey: 'rolePermCat.articles' },
  { key: 'equipment',     label: 'Equipment',       labelKey: 'rolePermCat.equipment' },
  { key: 'organization',  label: 'Organization',    labelKey: 'rolePermCat.organization' },
  { key: 'reports',       label: 'Reports & Audit', labelKey: 'rolePermCat.reports' },
  { key: 'system',        label: 'System',          labelKey: 'rolePermCat.system' },
]

export const ASSIGNABLE_ROLES: Role[] = ['archer', 'coach', 'admin1', 'admin2', 'super_admin']

/** Permissions that require a confirmation step before toggling. */
export const DANGEROUS_PERMISSION_KEYS = new Set<string>([
  'manage_system_rules',
  'manage_role_permissions',
  'manage_super_admin_users',
  'delete_users',
  'delete_school',
  'delete_pld',
  'delete_state',
  'enable_maintenance_mode',
  'disable_maintenance_mode',
  'view_audit_logs',
  'export_audit_logs',
])

// Locked ON for Super Admin (cannot be disabled). The locked-OFF-for-lower set
// lives in src/lib/permissions.ts (SUPER_ADMIN_LOCKED_OFF_KEYS) so the static
// safety guard and these defaults share one source of truth.
const LOCKED_ON_SUPER = new Set<string>([
  'manage_system_rules',
  'manage_role_permissions',
  'access_super_admin_dashboard',
  'access_super_admin_system_rules',
  'access_super_admin_role_permissions',
])

const LOCK_ON_REASON = 'Required for Super Admin — cannot be disabled.'
const LOCK_OFF_REASON = 'Restricted to Super Admin.'

// ─── PERMISSION CATALOG ──────────────────────────────────────────────────────────
// Master list of every permission (key + human label + category). Mirrors the
// CTE seed in supabase/migrations/016_role_permissions.sql — keep in sync.

export interface PermissionCatalogEntry {
  key: string
  label: string
  category: string
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  // Navigation
  { key: 'access_archer_dashboard',            label: 'Access: Archer dashboard',          category: 'navigation' },
  { key: 'access_archer_scores',               label: 'Access: Archer scores',             category: 'navigation' },
  { key: 'access_archer_achievements',         label: 'Access: Archer achievements',       category: 'navigation' },
  { key: 'access_archer_notifications',        label: 'Access: Archer notifications',      category: 'navigation' },
  { key: 'access_archer_equipment',            label: 'Access: Archer equipment',          category: 'navigation' },
  { key: 'access_coach_dashboard',             label: 'Access: Coach dashboard',           category: 'navigation' },
  { key: 'access_coach_archers',               label: 'Access: Coach archers',             category: 'navigation' },
  { key: 'access_coach_scores',                label: 'Access: Coach scores',              category: 'navigation' },
  { key: 'access_coach_achievements',          label: 'Access: Coach achievements',        category: 'navigation' },
  { key: 'access_coach_notifications',         label: 'Access: Coach notifications',       category: 'navigation' },
  { key: 'access_coach_certifications',        label: 'Access: Coach certifications',      category: 'navigation' },
  { key: 'access_admin1_dashboard',            label: 'Access: Admin 1 dashboard',         category: 'navigation' },
  { key: 'access_admin1_approvals',            label: 'Access: Admin 1 approvals',         category: 'navigation' },
  { key: 'access_admin1_schools',              label: 'Access: Admin 1 schools',           category: 'navigation' },
  { key: 'access_admin1_coaches',              label: 'Access: Admin 1 coaches',           category: 'navigation' },
  { key: 'access_admin1_notifications',        label: 'Access: Admin 1 notifications',     category: 'navigation' },
  { key: 'access_admin1_reports',              label: 'Access: Admin 1 reports',           category: 'navigation' },
  { key: 'access_admin2_dashboard',            label: 'Access: Admin 2 dashboard',         category: 'navigation' },
  { key: 'access_admin2_achievements',         label: 'Access: Admin 2 achievements',      category: 'navigation' },
  { key: 'access_admin2_notifications',        label: 'Access: Admin 2 notifications',     category: 'navigation' },
  { key: 'access_admin2_articles',             label: 'Access: Admin 2 articles',          category: 'navigation' },
  { key: 'access_admin2_users',                label: 'Access: Admin 2 users',             category: 'navigation' },
  { key: 'access_admin2_schools',              label: 'Access: Admin 2 schools',           category: 'navigation' },
  { key: 'access_admin2_plds',                 label: 'Access: Admin 2 PLDs',              category: 'navigation' },
  { key: 'access_admin2_states',               label: 'Access: Admin 2 states',            category: 'navigation' },
  { key: 'access_admin2_reports',              label: 'Access: Admin 2 reports',           category: 'navigation' },
  { key: 'access_admin2_audit',                label: 'Access: Admin 2 audit',             category: 'navigation' },
  { key: 'access_super_admin_dashboard',       label: 'Access: Super Admin dashboard',     category: 'navigation' },
  { key: 'access_super_admin_system_rules',    label: 'Access: Super Admin system rules',  category: 'navigation' },
  { key: 'access_super_admin_role_permissions', label: 'Access: Super Admin role permissions', category: 'navigation' },
  { key: 'access_super_admin_users',           label: 'Access: Super Admin users',         category: 'navigation' },
  { key: 'access_super_admin_settings',        label: 'Access: Super Admin settings',      category: 'navigation' },
  { key: 'access_super_admin_audit_logs',      label: 'Access: Super Admin audit logs',    category: 'navigation' },
  { key: 'access_super_admin_change_requests', label: 'Access: Super Admin change requests', category: 'navigation' },
  { key: 'access_articles',                    label: 'Access: Articles',                  category: 'navigation' },
  { key: 'access_coach_equipment',             label: 'Access: Coach equipment',            category: 'navigation' },

  // Users
  { key: 'view_users',              label: 'View users',                  category: 'users' },
  { key: 'create_users',            label: 'Create users',                category: 'users' },
  { key: 'edit_users',              label: 'Edit users',                  category: 'users' },
  { key: 'approve_users',           label: 'Approve users',               category: 'users' },
  { key: 'reject_users',            label: 'Reject users',                category: 'users' },
  { key: 'suspend_users',           label: 'Suspend users',               category: 'users' },
  { key: 'reactivate_users',        label: 'Reactivate users',            category: 'users' },
  { key: 'change_user_role',        label: 'Change user role',            category: 'users' },
  { key: 'assign_user_school',      label: 'Assign user school',          category: 'users' },
  { key: 'assign_user_pld',         label: 'Assign user PLD',             category: 'users' },
  { key: 'assign_user_state',       label: 'Assign user state',           category: 'users' },
  { key: 'link_coach_to_archer',    label: 'Link coach to archer',        category: 'users' },
  { key: 'unlink_coach_from_archer', label: 'Unlink coach from archer',   category: 'users' },
  { key: 'delete_users',            label: 'Delete users',                category: 'users' },
  { key: 'manage_admin1_users',     label: 'Manage Admin 1 users',        category: 'users' },
  { key: 'manage_admin2_users',     label: 'Manage Admin 2 users',        category: 'users' },
  { key: 'manage_super_admin_users', label: 'Manage Super Admin users',   category: 'users' },

  // Scores
  { key: 'submit_own_training_score',    label: 'Submit own training score',     category: 'scores' },
  { key: 'submit_own_tournament_score',  label: 'Submit own tournament score',   category: 'scores' },
  { key: 'submit_score_for_archer',      label: 'Submit score for archer',       category: 'scores' },
  { key: 'edit_own_score',               label: 'Edit own score',                category: 'scores' },
  { key: 'edit_archer_score',            label: 'Edit archer score',             category: 'scores' },
  { key: 'delete_own_score',             label: 'Delete own score',              category: 'scores' },
  { key: 'delete_archer_score',          label: 'Delete archer score',           category: 'scores' },
  { key: 'validate_training_score',      label: 'Validate training score',       category: 'scores' },
  { key: 'validate_tournament_score',    label: 'Validate tournament score',     category: 'scores' },
  { key: 'reject_score',                 label: 'Reject score',                  category: 'scores' },
  { key: 'request_score_resubmission',   label: 'Request score resubmission',    category: 'scores' },
  { key: 'upload_tournament_proof',      label: 'Upload tournament proof',       category: 'scores' },
  { key: 'review_tournament_proof',      label: 'Review tournament proof',       category: 'scores' },
  { key: 'approve_tournament_proof',     label: 'Approve tournament proof',      category: 'scores' },

  // Achievements
  { key: 'view_own_achievements',            label: 'View own achievements',          category: 'achievements' },
  { key: 'view_linked_archer_achievements',  label: 'View linked archer achievements', category: 'achievements' },
  { key: 'view_all_achievements',            label: 'View all achievements',          category: 'achievements' },
  { key: 'create_achievement_definition',    label: 'Create achievement definition',  category: 'achievements' },
  { key: 'edit_achievement_definition',      label: 'Edit achievement definition',    category: 'achievements' },
  { key: 'activate_achievement_definition',  label: 'Activate achievement definition', category: 'achievements' },
  { key: 'deactivate_achievement_definition', label: 'Deactivate achievement definition', category: 'achievements' },
  { key: 'upload_achievement_badge',         label: 'Upload achievement badge',       category: 'achievements' },
  { key: 'manually_grant_achievement',       label: 'Manually grant achievement',     category: 'achievements' },
  { key: 'revoke_achievement',               label: 'Revoke achievement',             category: 'achievements' },

  // Notifications
  { key: 'view_own_notifications',     label: 'View own notifications',     category: 'notifications' },
  { key: 'mark_notification_read',     label: 'Mark notification read',     category: 'notifications' },
  { key: 'create_notification',        label: 'Create notification',        category: 'notifications' },
  { key: 'edit_notification',          label: 'Edit notification',          category: 'notifications' },
  { key: 'publish_notification',       label: 'Publish notification',       category: 'notifications' },
  { key: 'schedule_notification',      label: 'Schedule notification',      category: 'notifications' },
  { key: 'archive_notification',       label: 'Archive notification',       category: 'notifications' },
  { key: 'delete_notification',        label: 'Delete notification',        category: 'notifications' },
  { key: 'send_global_notification',   label: 'Send global notification',   category: 'notifications' },
  { key: 'send_role_notification',     label: 'Send role notification',     category: 'notifications' },
  { key: 'send_scope_notification',    label: 'Send scope notification',    category: 'notifications' },
  { key: 'send_archer_notification',   label: 'Send archer notification',   category: 'notifications' },

  // Articles
  { key: 'view_articles',             label: 'View articles',              category: 'articles' },
  { key: 'create_article',            label: 'Create article',             category: 'articles' },
  { key: 'edit_article',              label: 'Edit article',               category: 'articles' },
  { key: 'publish_article',           label: 'Publish article',            category: 'articles' },
  { key: 'archive_article',           label: 'Archive article',            category: 'articles' },
  { key: 'delete_article',            label: 'Delete article',             category: 'articles' },
  { key: 'duplicate_article',         label: 'Duplicate article',          category: 'articles' },
  { key: 'upload_article_media',      label: 'Upload article media',       category: 'articles' },
  { key: 'submit_article_suggestion', label: 'Submit article suggestion',  category: 'articles' },
  { key: 'review_article_suggestion', label: 'Review article suggestion',  category: 'articles' },

  // Equipment
  { key: 'view_own_equipment',           label: 'View own equipment',           category: 'equipment' },
  { key: 'edit_own_equipment',           label: 'Edit own equipment',           category: 'equipment' },
  { key: 'view_linked_archer_equipment', label: 'View linked archer equipment', category: 'equipment' },
  { key: 'edit_linked_archer_equipment', label: 'Edit linked archer equipment', category: 'equipment' },
  { key: 'view_all_equipment',           label: 'View all equipment',           category: 'equipment' },
  { key: 'edit_all_equipment',           label: 'Edit all equipment',           category: 'equipment' },

  // Organization
  { key: 'view_schools',    label: 'View schools',    category: 'organization' },
  { key: 'create_school',   label: 'Create school',   category: 'organization' },
  { key: 'edit_school',     label: 'Edit school',     category: 'organization' },
  { key: 'archive_school',  label: 'Archive school',  category: 'organization' },
  { key: 'delete_school',   label: 'Delete school',   category: 'organization' },
  { key: 'view_plds',       label: 'View PLDs',       category: 'organization' },
  { key: 'create_pld',      label: 'Create PLD',      category: 'organization' },
  { key: 'edit_pld',        label: 'Edit PLD',        category: 'organization' },
  { key: 'archive_pld',     label: 'Archive PLD',     category: 'organization' },
  { key: 'delete_pld',      label: 'Delete PLD',      category: 'organization' },
  { key: 'view_states',     label: 'View states',     category: 'organization' },
  { key: 'create_state',    label: 'Create state',    category: 'organization' },
  { key: 'edit_state',      label: 'Edit state',      category: 'organization' },
  { key: 'archive_state',   label: 'Archive state',   category: 'organization' },
  { key: 'delete_state',    label: 'Delete state',    category: 'organization' },

  // Reports & Audit
  { key: 'view_own_reports',           label: 'View own reports',            category: 'reports' },
  { key: 'view_linked_archer_reports', label: 'View linked archer reports',  category: 'reports' },
  { key: 'view_school_reports',        label: 'View school reports',         category: 'reports' },
  { key: 'view_pld_reports',           label: 'View PLD reports',            category: 'reports' },
  { key: 'view_state_reports',         label: 'View state reports',          category: 'reports' },
  { key: 'view_national_reports',      label: 'View national reports',       category: 'reports' },
  { key: 'export_reports',             label: 'Export reports',              category: 'reports' },
  { key: 'view_audit_logs',            label: 'View audit logs',             category: 'reports' },
  { key: 'export_audit_logs',          label: 'Export audit logs',           category: 'reports' },

  // System
  { key: 'manage_system_rules',     label: 'Manage system rules',     category: 'system' },
  { key: 'manage_role_permissions', label: 'Manage role permissions', category: 'system' },
  { key: 'manage_feature_flags',    label: 'Manage feature flags',    category: 'system' },
  { key: 'enable_maintenance_mode', label: 'Enable maintenance mode', category: 'system' },
  { key: 'disable_maintenance_mode', label: 'Disable maintenance mode', category: 'system' },
  { key: 'manage_app_settings',     label: 'Manage app settings',     category: 'system' },
  { key: 'view_change_requests',    label: 'View change requests',    category: 'system' },
  { key: 'approve_change_requests', label: 'Approve change requests', category: 'system' },
  { key: 'reject_change_requests',  label: 'Reject change requests',  category: 'system' },
]

// ─── PER-ROLE DEFAULT ENABLED SETS ───────────────────────────────────────────────
// super_admin enables everything. Lower roles enable only the keys below.

const ARCHER_ENABLED = new Set<string>([
  'access_archer_dashboard', 'access_archer_scores', 'access_archer_achievements',
  'access_archer_notifications', 'access_archer_equipment', 'access_articles',
  'submit_own_training_score', 'submit_own_tournament_score', 'edit_own_score',
  'upload_tournament_proof', 'view_own_achievements', 'view_own_notifications',
  'mark_notification_read', 'view_articles', 'view_own_reports',
  'view_own_equipment', 'edit_own_equipment',
])

const COACH_ENABLED = new Set<string>([
  'access_coach_dashboard', 'access_coach_archers', 'access_coach_scores',
  'access_coach_achievements', 'access_coach_notifications', 'access_coach_certifications',
  'access_coach_equipment', 'access_articles', 'submit_score_for_archer',
  'view_linked_archer_achievements', 'view_own_notifications', 'mark_notification_read',
  'view_articles', 'view_linked_archer_reports', 'validate_training_score',
  'edit_archer_score', 'view_linked_archer_equipment',
])

const ADMIN1_ENABLED = new Set<string>([
  'access_admin1_dashboard', 'access_admin1_approvals', 'access_admin1_schools',
  'access_admin1_coaches', 'access_admin1_notifications', 'access_admin1_reports',
  'access_articles', 'view_users', 'view_schools', 'view_school_reports',
  'view_pld_reports', 'view_state_reports', 'view_own_notifications',
  'mark_notification_read', 'view_articles', 'send_scope_notification',
])

const ADMIN2_ENABLED = new Set<string>([
  // Navigation
  'access_admin2_dashboard', 'access_admin2_achievements', 'access_admin2_notifications',
  'access_admin2_articles', 'access_admin2_users', 'access_admin2_schools',
  'access_admin2_plds', 'access_admin2_states', 'access_admin2_reports',
  'access_admin2_audit', 'access_articles',
  // Users
  'view_users', 'create_users', 'edit_users', 'approve_users', 'reject_users',
  'suspend_users', 'reactivate_users', 'change_user_role', 'assign_user_school',
  'assign_user_pld', 'assign_user_state', 'link_coach_to_archer', 'unlink_coach_from_archer',
  // Scores
  'validate_training_score', 'validate_tournament_score', 'reject_score',
  'request_score_resubmission', 'review_tournament_proof', 'approve_tournament_proof',
  // Achievements
  'view_all_achievements', 'create_achievement_definition', 'edit_achievement_definition',
  'activate_achievement_definition', 'deactivate_achievement_definition', 'upload_achievement_badge',
  // Notifications
  'view_own_notifications', 'mark_notification_read', 'create_notification', 'edit_notification',
  'publish_notification', 'schedule_notification', 'archive_notification', 'delete_notification',
  'send_global_notification', 'send_role_notification', 'send_scope_notification',
  // Articles
  'view_articles', 'create_article', 'edit_article', 'publish_article', 'archive_article',
  'delete_article', 'duplicate_article', 'upload_article_media',
  // Equipment
  'view_all_equipment', 'edit_all_equipment',
  // Organization
  'view_schools', 'create_school', 'edit_school', 'archive_school',
  'view_plds', 'create_pld', 'edit_pld', 'archive_pld',
  'view_states', 'create_state', 'edit_state', 'archive_state',
  // Reports & Audit
  'view_national_reports', 'export_reports', 'view_audit_logs',
])

const ROLE_ENABLED: Record<Exclude<Role, 'super_admin'>, Set<string>> = {
  archer: ARCHER_ENABLED,
  coach:  COACH_ENABLED,
  admin1: ADMIN1_ENABLED,
  admin2: ADMIN2_ENABLED,
}

/** The default enabled/locked state for a (role, key) pair. */
export function defaultForPermission(
  role: Role,
  key: string,
): { enabled: boolean; locked: boolean; locked_reason: string | null } {
  if (role === 'super_admin') {
    const locked = LOCKED_ON_SUPER.has(key)
    return { enabled: true, locked, locked_reason: locked ? LOCK_ON_REASON : null }
  }
  if (SUPER_ADMIN_LOCKED_OFF_KEYS.has(key)) {
    return { enabled: false, locked: true, locked_reason: LOCK_OFF_REASON }
  }
  return { enabled: ROLE_ENABLED[role].has(key), locked: false, locked_reason: null }
}

interface DefaultRow {
  role: Role
  permission_key: string
  label: string
  description: string | null
  category: string
  enabled: boolean
  locked: boolean
  locked_reason: string | null
  updated_by: string | null
}

function buildDefaultRows(role: Role, actorId: string | null): DefaultRow[] {
  return PERMISSION_CATALOG.map((c) => {
    const d = defaultForPermission(role, c.key)
    return {
      role,
      permission_key: c.key,
      label: c.label,
      description: null,
      category: c.category,
      enabled: d.enabled,
      locked: d.locked,
      locked_reason: d.locked_reason,
      updated_by: actorId,
    }
  })
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────────

function currentActor(): { id: string | undefined; role: Role | undefined } {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

/** All mutations are super-admin only; RLS is the real guard, this fails fast. */
function assertCanManage(): void {
  assertCan(canManageRolePermissions(currentActor().role), 'manage role permissions')
}

// ─── READS ───────────────────────────────────────────────────────────────────────

export async function getRolePermissions(): Promise<RolePermission[]> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('*')
    .order('role', { ascending: true })
    .order('category', { ascending: true })
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as RolePermission[]
}

export async function getPermissionsForRole(role: Role): Promise<RolePermission[]> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('*')
    .eq('role', role)
    .order('category', { ascending: true })
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as RolePermission[]
}

export async function getPermission(role: Role, permissionKey: string): Promise<RolePermission | null> {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('*')
    .eq('role', role)
    .eq('permission_key', permissionKey)
    .maybeSingle()
  if (error) throw error
  return data as RolePermission | null
}

/** Resilient single check with a safe fallback (returns fallback on any error). */
export async function hasPermission(role: Role, permissionKey: string, fallback = false): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('role_permissions')
      .select('enabled')
      .eq('role', role)
      .eq('permission_key', permissionKey)
      .maybeSingle()
    if (error || !data) return fallback
    return data.enabled === true
  } catch {
    return fallback
  }
}

// ─── MUTATIONS (super admin only) ──────────────────────────────────────────────────

export async function updateRolePermission(
  role: Role,
  permissionKey: string,
  enabled: boolean,
): Promise<RolePermission> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing } = await supabase
    .from('role_permissions')
    .select('enabled, locked')
    .eq('role', role)
    .eq('permission_key', permissionKey)
    .maybeSingle()

  if (existing?.locked) {
    throw new Error('This permission is locked and cannot be changed.')
  }

  const { data, error } = await supabase
    .from('role_permissions')
    .update({ enabled, updated_by: actorId ?? null })
    .eq('role', role)
    .eq('permission_key', permissionKey)
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'role_permission.updated', 'role_permission', data.id, {
      role, permission_key: permissionKey, old_value: existing?.enabled ?? null, new_value: enabled,
    })
    await writeAuditLog(
      actorId,
      enabled ? 'role_permission.enabled' : 'role_permission.disabled',
      'role_permission', data.id, { role, permission_key: permissionKey },
    )
  }
  return data as RolePermission
}

export interface RolePermissionPayload {
  role: Role
  permission_key: string
  label: string
  description?: string
  category: string
  enabled?: boolean
  locked?: boolean
  locked_reason?: string
}

export async function createRolePermission(payload: RolePermissionPayload): Promise<RolePermission> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const row = {
    role:           payload.role,
    permission_key: payload.permission_key,
    label:          payload.label,
    description:    payload.description ?? null,
    category:       payload.category,
    enabled:        payload.enabled ?? false,
    locked:         payload.locked ?? false,
    locked_reason:  payload.locked_reason ?? null,
    updated_by:     actorId ?? null,
  }

  const { data, error } = await supabase
    .from('role_permissions')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'role_permission.created', 'role_permission', data.id, {
      role: payload.role, permission_key: payload.permission_key,
    })
  }
  return data as RolePermission
}

/**
 * Enable/disable every permission in a category for a role. Locked rows are
 * never touched.
 */
export async function bulkUpdateRolePermissions(
  role: Role,
  category: string,
  enabled: boolean,
): Promise<void> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { error } = await supabase
    .from('role_permissions')
    .update({ enabled, updated_by: actorId ?? null })
    .eq('role', role)
    .eq('category', category)
    .eq('locked', false)
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'role_permission.bulk_updated', 'role_permission', undefined, {
      role, category, new_value: enabled,
    })
  }
}

/**
 * Reset every permission for a role back to its seeded default
 * (enabled + locked + locked_reason). Overwrites customisations — confirm first.
 */
export async function resetRolePermissionsToDefault(role: Role): Promise<void> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const rows = buildDefaultRows(role, actorId ?? null)
  const { error } = await supabase
    .from('role_permissions')
    .upsert(rows, { onConflict: 'role,permission_key' })
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'role_permission.reset_to_default', 'role_permission', undefined, { role })
  }
}

/** Insert any default (role, permission) rows that are missing, without overwriting existing. */
export async function restoreMissingDefaultRolePermissions(): Promise<{ inserted: number }> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing, error } = await supabase
    .from('role_permissions')
    .select('role, permission_key')
  if (error) throw error

  const present = new Set((existing ?? []).map((r) => `${r.role}:${r.permission_key}`))
  const missing: DefaultRow[] = []
  for (const role of ASSIGNABLE_ROLES) {
    for (const row of buildDefaultRows(role, actorId ?? null)) {
      if (!present.has(`${row.role}:${row.permission_key}`)) missing.push(row)
    }
  }
  if (missing.length === 0) return { inserted: 0 }

  const { error: insErr } = await supabase.from('role_permissions').insert(missing)
  if (insErr) throw insErr

  if (actorId) {
    await writeAuditLog(actorId, 'role_permission.restored_missing_defaults', 'role_permission', undefined, {
      count: missing.length,
    })
  }
  return { inserted: missing.length }
}

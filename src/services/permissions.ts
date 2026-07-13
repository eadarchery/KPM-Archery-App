import { supabase } from './supabase'
import type { PermissionKey, PermissionMap, Role } from '@/types'

// Default permissions — used as fallback until DB permissions load
const DEFAULT_PERMISSIONS: Record<Role, PermissionMap> = {
  archer: {
    can_view_dashboard: true,
    can_submit_own_score: true,
  },
  coach: {
    can_view_dashboard: true,
    can_submit_own_score: true,
    can_submit_archer_score: true,
    can_upload_excel: true,
    can_validate_training: true,
    can_approve_users: true,
  },
  admin1: {
    can_view_dashboard: true,
    can_view_all_malaysia: true,
    can_create_notification: true,
    can_publish_notification: true,
    can_target_notification: true,
  },
  admin2: {
    can_view_dashboard: true,
    can_view_all_malaysia: true,
    can_validate_tournament: true,
    can_create_notification: true,
    can_publish_notification: true,
    can_target_notification: true,
    can_create_edit_articles: true,
    can_manage_badges: true,
    can_manage_users: true,
    can_approve_users: true,
    can_view_audit_logs: true,
    can_upload_excel: true,
  },
  super_admin: {
    can_view_dashboard: true,
    can_submit_own_score: true,
    can_submit_archer_score: true,
    can_upload_excel: true,
    can_validate_training: true,
    can_validate_tournament: true,
    can_create_notification: true,
    can_publish_notification: true,
    can_target_notification: true,
    can_create_edit_articles: true,
    can_manage_badges: true,
    can_manage_users: true,
    can_approve_users: true,
    can_manage_roles: true,
    can_view_all_malaysia: true,
    can_view_audit_logs: true,
    can_change_app_settings: true,
    can_change_logo_favicon: true,
    can_manage_font_size: true,
  },
}

export function getDefaultPermissions(role: Role): PermissionMap {
  return DEFAULT_PERMISSIONS[role] ?? {}
}

export async function loadPermissionsForRole(role: Role): Promise<PermissionMap> {
  try {
    const { data, error } = await supabase
      .from('permissions')
      .select('permission_key, allowed')
      .eq('role_name', role)

    if (error || !data?.length) return getDefaultPermissions(role)

    const map: PermissionMap = {}
    data.forEach((row) => {
      map[row.permission_key as PermissionKey] = row.allowed
    })
    return map
  } catch {
    return getDefaultPermissions(role)
  }
}

export function hasPermission(map: PermissionMap, key: PermissionKey): boolean {
  return map[key] === true
}

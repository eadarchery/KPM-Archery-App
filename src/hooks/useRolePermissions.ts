import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getRolePermissions, getPermissionsForRole } from '@/services/rolePermissions'
import { hasRolePermission, rolePermissionKey, type RolePermissionMap } from '@/lib/permissions'
import type { Role, RolePermission } from '@/types'

/** All role permissions (super admin sees all; admin2 read-all; others see own role). */
export function useRolePermissions() {
  return useQuery<RolePermission[]>({
    queryKey: ['role-permissions'],
    queryFn: getRolePermissions,
    staleTime: 1000 * 60 * 2,
    retry: false, // empty result falls back to static permissions safely
  })
}

export function usePermissionsForRole(role: Role) {
  return useQuery<RolePermission[]>({
    queryKey: ['role-permissions', role],
    queryFn: () => getPermissionsForRole(role),
    enabled: !!role,
    staleTime: 1000 * 60 * 2,
    retry: false,
  })
}

/** Lookup map (`role:key` → enabled) for `hasRolePermission()`. */
export function useRolePermissionMap(): RolePermissionMap {
  const { data } = useRolePermissions()
  return useMemo(() => {
    const map: RolePermissionMap = {}
    for (const p of data ?? []) map[rolePermissionKey(p.role, p.permission_key)] = p.enabled
    return map
  }, [data])
}

/**
 * Dynamic permission check bound to the current cache. Always pass a safe static
 * `fallback` (e.g. `canManageArticles(role)`) so a missing/failed fetch degrades
 * to the static model rather than blocking or escalating.
 */
export function useHasPermission(
  role: Role | null | undefined,
  permissionKey: string,
  fallback = false,
): boolean {
  const map = useRolePermissionMap()
  return hasRolePermission(role, permissionKey, map, fallback)
}

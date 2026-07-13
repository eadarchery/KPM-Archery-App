import { useAuthStore } from '@/store/authStore'
import { hasPermission } from '@/services/permissions'
import type { PermissionKey, Role } from '@/types'

export function usePermissions() {
  const { permissions, profile } = useAuthStore()

  const can = (key: PermissionKey): boolean => hasPermission(permissions, key)

  const is = (role: Role | Role[]): boolean => {
    if (!profile) return false
    if (Array.isArray(role)) return role.includes(profile.role)
    return profile.role === role
  }

  const isAtLeast = (role: Role): boolean => {
    if (!profile) return false
    const hierarchy: Role[] = ['archer', 'coach', 'admin1', 'admin2', 'super_admin']
    return hierarchy.indexOf(profile.role) >= hierarchy.indexOf(role)
  }

  return { can, is, isAtLeast, role: profile?.role }
}

export function useCan(key: PermissionKey): boolean {
  const { permissions } = useAuthStore()
  return hasPermission(permissions, key)
}

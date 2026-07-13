import { RoleOverview } from '@/components/common/RoleOverview'

/**
 * Admin 2 → Role Overview (read-only).
 *
 * Admin 2 may VIEW role definitions for reference but can never edit role
 * permissions — there is no edit control here, and the database RLS on
 * system.role_permissions restricts writes to Super Admin only. Editing lives
 * solely at /super-admin/role-permissions.
 */
export default function Admin2Roles() {
  return <RoleOverview />
}

import { RoleOverview } from '@/components/common/RoleOverview'

/**
 * Super Admin → Role Overview (read-only reference).
 *
 * This is NOT the editor. The single editable permission manager is
 * /super-admin/role-permissions. This page shows what each role is for and
 * links across to the editor (canEdit), so the two are never confused.
 */
export default function SuperAdminRoles() {
  return <RoleOverview canEdit />
}

import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

/**
 * Retired stub. App-level settings are Super Admin-owned
 * (/super-admin/app-settings + /super-admin/system-rules). Admin 2 cannot manage
 * them, so this orphan route redirects sensibly by role instead of showing a dead
 * "coming soon" page. The account-menu "App settings" shortcut now points Super
 * Admin straight at /super-admin/app-settings.
 */
export default function Admin2Settings() {
  const { profile } = useAuth()
  const target = profile?.role === 'super_admin' ? '/super-admin/app-settings' : '/admin2/centre'
  return <Navigate to={target} replace />
}

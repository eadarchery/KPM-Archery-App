import { Navigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

/**
 * Retired stub. "Appearance" here meant global logo / favicon / theme, which is
 * owned by Super Admin Branding (/super-admin/branding). Admin 2 cannot manage
 * global branding, and per-user theme + font size already live in the header.
 * Redirect by role instead of showing a dead "coming soon" page.
 */
export default function Admin2Appearance() {
  const { profile } = useAuth()
  const target = profile?.role === 'super_admin' ? '/super-admin/branding' : '/admin2/centre'
  return <Navigate to={target} replace />
}

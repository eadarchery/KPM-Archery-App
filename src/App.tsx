import { Suspense, lazy, useEffect, useState, type ReactNode } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from '@/components/ui/Toast'
import { LanguageProvider } from '@/contexts/LanguageContext'
import { AppLayout } from '@/layouts/AppLayout'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth, useAuthInit } from '@/hooks/useAuth'
import { useApplyBranding } from '@/hooks/useApplyBranding'
import { getHomePath } from '@/lib/permissions'
import { queryRetryDelay, shouldRetryQuery } from '@/lib/queryRetry'
import { supabase } from '@/services/supabase'
import type { Role } from '@/types'

// ─── LAZY PAGES ──────────────────────────────────────────────────────────────

const Login         = lazy(() => import('@/pages/Login'))
const PendingGate   = lazy(() => import('@/pages/PendingGate'))
const NotFound      = lazy(() => import('@/pages/NotFound'))
const ForgotPassword = lazy(() => import('@/pages/auth/ForgotPassword'))
const ResetPassword  = lazy(() => import('@/pages/auth/ResetPassword'))
const ForgotEmail    = lazy(() => import('@/pages/auth/ForgotEmail'))
const AdminMfa       = lazy(() => import('@/pages/auth/AdminMfa'))
const ArticlesPage       = lazy(() => import('@/pages/Articles'))
const ArticleDetailPage  = lazy(() => import('@/pages/ArticleDetail'))

// Archer
const ArcherDashboard     = lazy(() => import('@/pages/archer/Dashboard'))
const ArcherAchievements  = lazy(() => import('@/pages/archer/Achievements'))
const ArcherLeaderboard   = lazy(() => import('@/pages/archer/Leaderboard'))
const ArcherNotifications = lazy(() => import('@/pages/archer/Notifications'))
const ArcherProfile       = lazy(() => import('@/pages/archer/Profile'))
const ArcherEquipment     = lazy(() => import('@/pages/archer/Equipment'))
const ArcherChangeRequest = lazy(() => import('@/pages/archer/ChangeRequest'))

// Coach
const CoachDashboard      = lazy(() => import('@/pages/coach/Dashboard'))
const CoachArchers        = lazy(() => import('@/pages/coach/Archers'))
const CoachArcherDetail   = lazy(() => import('@/pages/coach/ArcherDetail'))
const CoachScores         = lazy(() => import('@/pages/coach/Scores'))
const CoachAchievements   = lazy(() => import('@/pages/coach/Achievements'))
const CoachNotifications  = lazy(() => import('@/pages/coach/Notifications'))
const CoachProfile        = lazy(() => import('@/pages/coach/Profile'))
const CoachCertifications = lazy(() => import('@/pages/coach/Certifications'))
const CoachEquipment      = lazy(() => import('@/pages/coach/Equipment'))
const CoachMyPerformance  = lazy(() => import('@/pages/coach/MyPerformance'))
const CoachLeaderboard    = lazy(() => import('@/pages/coach/CoachLeaderboard'))
const CoachPldValidation  = lazy(() => import('@/pages/coach/PldValidation'))

// Admin 1
const Admin1Overview      = lazy(() => import('@/pages/admin1/Overview'))
const Admin1Approvals     = lazy(() => import('@/pages/admin1/Approvals'))
const Admin1Notifications = lazy(() => import('@/pages/admin1/Notifications'))
const Admin1Reports       = lazy(() => import('@/pages/admin1/Reports'))
const Admin1StateReport   = lazy(() => import('@/pages/admin1/StateReport'))

// Admin 2
const Admin2Centre        = lazy(() => import('@/pages/admin2/ControlCentre'))
const Admin2Notifications = lazy(() => import('@/pages/admin2/Notifications'))
const Admin2Users         = lazy(() => import('@/pages/admin2/Users'))
const Admin2Scores        = lazy(() => import('@/pages/admin2/Scores'))
const UnlinkedValidation  = lazy(() => import('@/pages/shared/UnlinkedValidation'))
const Admin2Reports       = lazy(() => import('@/pages/admin2/Reports'))
const Admin2Certifications = lazy(() => import('@/pages/admin2/Certifications'))
const Admin2Articles      = lazy(() => import('@/pages/admin2/Articles'))
const Admin2Achievements  = lazy(() => import('@/pages/admin2/Achievements'))
const Admin2Audit         = lazy(() => import('@/pages/admin2/Audit'))
const Admin2Appearance    = lazy(() => import('@/pages/admin2/Appearance'))
const Admin2Roles         = lazy(() => import('@/pages/admin2/Roles'))
const Admin2Settings        = lazy(() => import('@/pages/admin2/AdminSettings'))
const Admin2ChangeRequests  = lazy(() => import('@/pages/admin2/ChangeRequests'))
const Admin2States          = lazy(() => import('@/pages/admin2/States'))
const Admin2PLDs            = lazy(() => import('@/pages/admin2/PLDs'))
const Admin2Schools         = lazy(() => import('@/pages/admin2/Schools'))
const Admin2AccountRecovery = lazy(() => import('@/pages/admin2/AccountRecovery'))
const Admin2Rounds          = lazy(() => import('@/pages/admin2/Rounds'))

// Super Admin
const SuperAdminSettings  = lazy(() => import('@/pages/superadmin/Settings'))
const SuperAdminRoles     = lazy(() => import('@/pages/superadmin/Roles'))
const SuperAdminAppSettings = lazy(() => import('@/pages/superadmin/AppSettings'))
const SuperAdminBranding  = lazy(() => import('@/pages/superadmin/Branding'))
const SuperAdminSystemRules = lazy(() => import('@/pages/superadmin/SystemRules'))
const SuperAdminRolePermissions = lazy(() => import('@/pages/superadmin/RolePermissions'))
const SuperAdminDemoData   = lazy(() => import('@/pages/superadmin/DemoData'))
const SuperAdminTalentConfig = lazy(() => import('@/pages/superadmin/TalentConfig'))

// ─── QUERY CLIENT ────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,   // 2 min
      gcTime: 1000 * 60 * 5,      // 5 min; bounds inactive page memory
      retry: shouldRetryQuery,
      retryDelay: queryRetryDelay,
      refetchOnWindowFocus: false,
    },
  },
})

// ─── ROUTE GUARDS ────────────────────────────────────────────────────────────

function RequireAuth({
  children,
  allowedRoles,
  onDenied = 'redirect',
}: {
  children: ReactNode
  allowedRoles?: Role[]
  /** Role mismatch handling: silently redirect home (default) or show Access Denied. */
  onDenied?: 'redirect' | 'deny'
}) {
  const { profile, loading, initialized } = useAuth()
  const location = useLocation()

  if (!initialized || loading) return <PageSpinner />

  if (!profile) return <Navigate to="/login" state={{ from: location }} replace />

  if (profile.status === 'pending' || profile.status === 'rejected') {
    return <Navigate to="/pending" replace />
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return onDenied === 'deny'
      ? <AccessDenied />
      : <Navigate to={getHomePath(profile.role)} replace />
  }

  return <>{children}</>
}

function RequireGuest({ children }: { children: ReactNode }) {
  const { profile, loading, initialized } = useAuth()

  if (!initialized || loading) return <PageSpinner />

  if (profile) {
    if (profile.status !== 'approved') return <Navigate to="/pending" replace />
    return <Navigate to={getHomePath(profile.role)} replace />
  }

  return <>{children}</>
}

/** Application admins must complete a TOTP challenge before admin routes load. */
function RequireAdminMfa({ children }: { children: ReactNode }) {
  const location = useLocation()
  const [checking, setChecking] = useState(true)
  const [hasAal2, setHasAal2] = useState(false)

  useEffect(() => {
    let active = true
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data, error }) => {
        if (!active) return
        setHasAal2(!error && data.currentLevel === 'aal2')
      })
      .finally(() => active && setChecking(false))
    return () => { active = false }
  }, [])

  if (checking) return <PageSpinner />
  if (!hasAal2) {
    return (
      <Navigate
        to="/admin-mfa"
        state={{ from: `${location.pathname}${location.search}` }}
        replace
      />
    )
  }
  return <>{children}</>
}

// ─── LOADING SPINNER ─────────────────────────────────────────────────────────

function PageSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="flex flex-col items-center gap-3">
        <div
          className="w-11 h-11 rounded-[13px] flex items-center justify-center"
          style={{ background: 'linear-gradient(140deg, var(--primary), var(--primary-hover))' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="white"/>
          </svg>
        </div>
        <p className="text-text-faint text-sm">Loading…</p>
      </div>
    </div>
  )
}

// ─── AUTH INIT WRAPPER ───────────────────────────────────────────────────────

function AuthInitializer({ children }: { children: ReactNode }) {
  useAuthInit()
  useApplyBranding()
  return <>{children}</>
}

// ─── ROUTER ──────────────────────────────────────────────────────────────────

function AppRoutes() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Routes>
        {/* Root redirect */}
        <Route path="/" element={<RootRedirect />} />

        {/* Auth */}
        <Route
          path="/login"
          element={
            <RequireGuest>
              <Login />
            </RequireGuest>
          }
        />
        <Route path="/pending" element={<PendingGate />} />

        {/* Account recovery — public, standalone (no guest guard).
            /reset-password must stay unguarded: the Supabase recovery link
            creates a session that would otherwise redirect the user away. */}
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/forgot-email" element={<ForgotEmail />} />
        <Route
          path="/admin-mfa"
          element={
            <RequireAuth allowedRoles={['admin1', 'admin2', 'super_admin']}>
              <AdminMfa />
            </RequireAuth>
          }
        />

        {/* ── ARCHER ── */}
        <Route
          path="/archer"
          element={
            <RequireAuth allowedRoles={['archer', 'super_admin']}>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard"     element={<ArcherDashboard />} />
          <Route path="achievements"  element={<ArcherAchievements />} />
          <Route path="leaderboard"   element={<ArcherLeaderboard />} />
          <Route path="notifications" element={<ArcherNotifications />} />
          <Route path="profile"       element={<ArcherProfile />} />
          <Route path="equipment"     element={<ArcherEquipment />} />
          <Route path="change-request" element={<ArcherChangeRequest />} />
        </Route>

        {/* ── COACH ── */}
        <Route
          path="/coach"
          element={
            <RequireAuth allowedRoles={['coach', 'super_admin']}>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard"     element={<CoachDashboard />} />
          <Route path="archers"          element={<CoachArchers />} />
          <Route path="archers/:archerId" element={<CoachArcherDetail />} />
          <Route path="scores"        element={<CoachScores />} />
          <Route path="achievements"  element={<CoachAchievements />} />
          <Route path="notifications" element={<CoachNotifications />} />
          <Route path="profile"       element={<CoachProfile />} />
          <Route path="certifications" element={<CoachCertifications />} />
          <Route path="equipment"     element={<CoachEquipment />} />
          <Route path="performance"   element={<CoachMyPerformance />} />
          <Route path="leaderboard"   element={<CoachLeaderboard />} />
          <Route path="pld-validation" element={<CoachPldValidation />} />
          {/* Archers' state leaderboard — same page archers see, scoped to the coach's state */}
          <Route path="archer-leaderboard" element={<ArcherLeaderboard />} />
        </Route>

        {/* ── ADMIN 1 ── */}
        <Route
          path="/admin1"
          element={
            <RequireAuth allowedRoles={['admin1', 'super_admin']}>
              <RequireAdminMfa><AppLayout /></RequireAdminMfa>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="overview" replace />} />
          <Route path="overview"      element={<Admin1Overview />} />
          <Route path="approvals"     element={<Admin1Approvals />} />
          <Route path="unlinked"      element={<UnlinkedValidation />} />
          <Route path="reports"       element={<Admin1Reports />} />
          <Route path="state-report"  element={<Admin1StateReport />} />
          <Route path="notifications" element={<Admin1Notifications />} />
        </Route>

        {/* ── ADMIN 2 ── */}
        <Route
          path="/admin2"
          element={
            <RequireAuth allowedRoles={['admin2', 'super_admin']}>
              <RequireAdminMfa><AppLayout /></RequireAdminMfa>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="centre" replace />} />
          <Route path="centre"         element={<Admin2Centre />} />
          <Route path="notifications"  element={<Admin2Notifications />} />
          <Route path="users"          element={<Admin2Users />} />
          <Route path="scores"         element={<Admin2Scores />} />
          <Route path="unlinked"       element={<UnlinkedValidation />} />
          <Route path="reports"        element={<Admin2Reports />} />
          <Route path="certifications" element={<Admin2Certifications />} />
          <Route path="articles"       element={<Admin2Articles />} />
          <Route path="achievements"   element={<Admin2Achievements />} />
          <Route path="audit"          element={<Admin2Audit />} />
          <Route path="appearance"     element={<Admin2Appearance />} />
          <Route path="roles"          element={<Admin2Roles />} />
          <Route path="settings"        element={<Admin2Settings />} />
          <Route path="change-requests" element={<Admin2ChangeRequests />} />
          <Route path="states"          element={<Admin2States />} />
          <Route path="plds"            element={<Admin2PLDs />} />
          <Route path="schools"         element={<Admin2Schools />} />
          <Route path="account-recovery" element={<Admin2AccountRecovery />} />
          <Route path="rounds"          element={<Admin2Rounds />} />
        </Route>

        {/* ── SUPER ADMIN ── */}
        <Route
          path="/super-admin"
          element={
            <RequireAuth allowedRoles={['super_admin']}>
              <RequireAdminMfa><AppLayout /></RequireAdminMfa>
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="settings" replace />} />
          <Route path="settings"      element={<SuperAdminSettings />} />
          <Route path="users"         element={<Admin2Users />} />
          <Route path="roles"         element={<SuperAdminRoles />} />
          <Route path="app-settings"  element={<SuperAdminAppSettings />} />
          <Route path="branding"      element={<SuperAdminBranding />} />
          <Route path="system-rules"  element={<SuperAdminSystemRules />} />
          <Route path="role-permissions" element={<SuperAdminRolePermissions />} />
          <Route path="demo-data"     element={<SuperAdminDemoData />} />
          <Route path="talent-config" element={<SuperAdminTalentConfig />} />
        </Route>

        {/* ── SHARED ── */}
        <Route
          path="/articles"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<ArticlesPage />} />
          <Route path=":slug" element={<ArticleDetailPage />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

function RootRedirect() {
  const { profile, loading, initialized } = useAuth()
  if (!initialized || loading) return <PageSpinner />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.status !== 'approved') return <Navigate to="/pending" replace />
  return <Navigate to={getHomePath(profile.role)} replace />
}

// ─── APP ROOT ────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <BrowserRouter>
          <ToastProvider>
            <AuthInitializer>
              <AppRoutes />
            </AuthInitializer>
          </ToastProvider>
        </BrowserRouter>
      </LanguageProvider>
    </QueryClientProvider>
  )
}

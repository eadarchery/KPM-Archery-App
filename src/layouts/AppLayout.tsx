import { Outlet } from 'react-router-dom'
import { Header } from '@/components/layout/Header'
import { BottomTabBar } from '@/components/layout/BottomTabBar'
import { MaintenanceMode } from '@/components/common/MaintenanceMode'
import { OnboardingTour } from '@/components/onboarding/OnboardingTour'
import { useAuth } from '@/hooks/useAuth'
import { useRuleValue } from '@/hooks/useSystemRules'
import { isOperationalAdmin } from '@/lib/permissions'

export function AppLayout() {
  const { profile } = useAuth()
  // Safe fallback: if the flag can't be read, maintenance stays off.
  const maintenance = useRuleValue<boolean>('maintenance_mode', false)

  // Admin 2 + Super Admin bypass maintenance; everyone else is locked out.
  if (maintenance && !isOperationalAdmin(profile?.role)) {
    return <MaintenanceMode />
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg)' }}>
      <Header />
      <div className="flex-1">
        <Outlet />
      </div>
      <BottomTabBar />
      <OnboardingTour />
    </div>
  )
}

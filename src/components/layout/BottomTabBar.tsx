import { useNavigate, useLocation } from 'react-router-dom'
import { cn } from '@/utils/cn'
import { RedDot } from '@/components/ui/RedDot'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useUiStore } from '@/store/uiStore'
import type { Role } from '@/types'

interface TabItem {
  path: string
  /** i18n key resolved at render time (e.g. 'nav.home'). */
  labelKey: string
  icon: React.ReactNode
  roles: Role[]
  badgeKey?: keyof ReturnType<typeof useUiStore.getState>['badges']
}

const TABS: TabItem[] = [
  { path: '/archer/dashboard',     labelKey: 'nav.home',         icon: <HomeIcon />,   roles: ['archer'] },
  { path: '/archer/achievements',  labelKey: 'nav.achievements', icon: <BadgeIcon />,  roles: ['archer'], badgeKey: 'achievements' },
  { path: '/archer/leaderboard',   labelKey: 'nav.leaderboard',  icon: <TrophyIcon />, roles: ['archer'] },
  { path: '/archer/notifications', labelKey: 'nav.alerts',       icon: <BellIcon />,      roles: ['archer'], badgeKey: 'notifications' },
  { path: '/articles',             labelKey: 'nav.articles',     icon: <ArticleIcon />,   roles: ['archer', 'coach'] },

  { path: '/coach/dashboard',      labelKey: 'nav.home',      icon: <HomeIcon />,      roles: ['coach'] },
  { path: '/coach/archers',        labelKey: 'nav.archers',   icon: <PeopleIcon />,    roles: ['coach'], badgeKey: 'pendingApprovals' },
  { path: '/coach/equipment',      labelKey: 'nav.equipment', icon: <EquipmentIcon />, roles: ['coach'] },
  { path: '/coach/scores',         labelKey: 'nav.scores',    icon: <EditIcon />,      roles: ['coach'] },
  { path: '/coach/notifications',  labelKey: 'nav.alerts',    icon: <BellIcon />,      roles: ['coach'], badgeKey: 'notifications' },
  { path: '/coach/achievements',   labelKey: 'nav.awards',    icon: <BadgeIcon />,     roles: ['coach'] },

  { path: '/admin1/overview',      labelKey: 'nav.overview',     icon: <ChartIcon />,  roles: ['admin1'] },
  { path: '/admin1/approvals',     labelKey: 'nav.approvals',    icon: <CheckCircleIcon />, roles: ['admin1'] },
  { path: '/admin1/notifications', labelKey: 'nav.alerts',       icon: <BellIcon />,   roles: ['admin1'], badgeKey: 'notifications' },
  { path: '/articles',             labelKey: 'nav.articles',     icon: <ArticleIcon />, roles: ['admin1'] },

  { path: '/admin2/centre',        labelKey: 'nav.centre',       icon: <ShieldIcon />,  roles: ['admin2', 'super_admin'], badgeKey: 'pendingValidations' },
  { path: '/admin2/notifications', labelKey: 'nav.alerts',       icon: <BellIcon />,    roles: ['admin2'], badgeKey: 'notifications' },
  { path: '/admin2/articles',      labelKey: 'nav.manage',       icon: <EditIcon />,    roles: ['admin2', 'super_admin'] },
  { path: '/articles',             labelKey: 'nav.articles',     icon: <ArticleIcon />, roles: ['admin2'] },

  { path: '/super-admin/settings', labelKey: 'nav.settings',     icon: <SettingsIcon />, roles: ['super_admin'] },
  { path: '/articles',             labelKey: 'nav.articles',     icon: <ArticleIcon />, roles: ['super_admin'] },
]

export function BottomTabBar() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const badges = useUiStore((s) => s.badges)

  const role = profile?.role
  if (!role) return null

  let tabs = TABS.filter((t) => t.roles.includes(role))
  // PLD coaches get their validation queue in place of the awards tab.
  if (role === 'coach' && (profile as { is_pld_coach?: boolean } | null)?.is_pld_coach) {
    tabs = tabs.map((t) =>
      t.path === '/coach/achievements'
        ? { path: '/coach/pld-validation', labelKey: 'nav.approvals', icon: <CheckCircleTabIcon />, roles: ['coach' as Role] }
        : t,
    )
  }
  tabs = tabs.slice(0, 5)

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed left-0 right-0 bottom-0 z-70 flex justify-around border-t border-line"
      style={{
        background: 'var(--header)',
        backdropFilter: 'saturate(160%) blur(16px)',
        WebkitBackdropFilter: 'saturate(160%) blur(16px)',
        padding: `8px 8px calc(8px + var(--safe-b))`,
      }}
    >
      {tabs.map((tab) => {
        const active = location.pathname.startsWith(tab.path.split('/').slice(0, 3).join('/'))
        const badgeCount = tab.badgeKey ? badges[tab.badgeKey] : 0
        const label = t(tab.labelKey)

        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex flex-col items-center gap-0.5 px-1 py-1.5 min-h-[52px] flex-1',
              'rounded-xl text-[10.5px] font-display font-semibold',
              'transition-colors duration-150',
              active ? 'text-primary' : 'text-text-faint',
            )}
          >
            <span
              className={cn(
                'w-5 h-5 transition-transform duration-200',
                active && '-translate-y-0.5',
              )}
            >
              {tab.icon}
            </span>
            <span>{label}</span>
            {badgeCount > 0 && (
              <RedDot
                count={badgeCount}
                className="absolute top-1.5 right-[calc(50%-14px)]"
              />
            )}
          </button>
        )
      })}
    </nav>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

function HomeIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> }
function BadgeIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg> }
function TrophyIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M6 9H4.5a2.5 2.5 0 0 0 0 5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 1 0 5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg> }
function BellIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> }
function ArticleIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M4 4h13a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0 1.5 1.5H6a2 2 0 0 1-2-2V4z"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="12" x2="15" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg> }
function PeopleIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><circle cx="9" cy="8" r="3.4"/><path d="M3.5 20a6 6 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16 14.5a5 5 0 0 1 4.5 5"/></svg> }
function EditIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function ChartIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="7" rx="1"/><rect x="11" y="6" width="3" height="12" rx="1"/><rect x="16" y="13" width="3" height="5" rx="1"/></svg> }
function CheckCircleIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> }
function CheckCircleTabIcon() { return <CheckCircleIcon /> }
function ShieldIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z"/></svg> }
function SettingsIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> }
function EquipmentIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="14 7 19 12 14 17"/><path d="M5 12 8 9.5M5 12 8 14.5"/></svg> }

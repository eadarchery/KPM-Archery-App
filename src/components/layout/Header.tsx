import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getUnreadCount } from '@/services/notifications'
import { getLatestArticleDate } from '@/services/articles'
import { cn } from '@/utils/cn'
import { Avatar } from '@/components/ui/Avatar'
import { RedDot } from '@/components/ui/RedDot'
import { useAuth, useSignOut } from '@/hooks/useAuth'
import { supabase } from '@/services/supabase'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { useTheme } from '@/hooks/useTheme'
import { useFontSize } from '@/hooks/useFontSize'
import { useBrandingValue } from '@/hooks/useBranding'
import { useUiStore } from '@/store/uiStore'
import { useOnboardingStore } from '@/store/onboardingStore'
import { getHomePath } from '@/lib/permissions'
import { useLanguage } from '@/contexts/LanguageContext'
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher'
import type { Role } from '@/types'

// ─── NAVIGATION ITEMS PER ROLE ────────────────────────────────────────────────

interface NavItem {
  path: string
  /** i18n key resolved at render time (e.g. 'nav.dashboard'). */
  labelKey: string
  icon: React.ReactNode
  roles: Role[]
}

const NAV_ITEMS: NavItem[] = [
  {
    path: '/archer/dashboard', labelKey: 'nav.dashboard',
    icon: <TargetIcon />,
    roles: ['archer'],
  },
  {
    path: '/archer/achievements', labelKey: 'nav.achievements',
    icon: <BadgeIcon />,
    roles: ['archer'],
  },
  {
    path: '/archer/leaderboard', labelKey: 'nav.leaderboard',
    icon: <ChartBarIcon />,
    roles: ['archer'],
  },
  {
    path: '/archer/notifications', labelKey: 'nav.notifications',
    icon: <BellIcon />,
    roles: ['archer'],
  },
  {
    path: '/coach/dashboard', labelKey: 'nav.dashboard',
    icon: <TargetIcon />,
    roles: ['coach'],
  },
  {
    path: '/coach/archers', labelKey: 'nav.myArchers',
    icon: <PeopleIcon />,
    roles: ['coach'],
  },
  {
    path: '/coach/scores', labelKey: 'nav.scoreUpload',
    icon: <EditIcon />,
    roles: ['coach'],
  },
  {
    path: '/coach/notifications', labelKey: 'nav.notifications',
    icon: <BellIcon />,
    roles: ['coach'],
  },
  {
    path: '/coach/achievements', labelKey: 'nav.achievements',
    icon: <BadgeIcon />,
    roles: ['coach'],
  },
  {
    path: '/admin1/overview', labelKey: 'nav.overview',
    icon: <ChartBarIcon />,
    roles: ['admin1'],
  },
  {
    path: '/admin1/approvals', labelKey: 'nav.approvals',
    icon: <CheckCircleIcon />,
    roles: ['admin1'],
  },
  {
    path: '/admin1/unlinked', labelKey: 'nav.unlinked',
    icon: <CheckCircleIcon />,
    roles: ['admin1'],
  },
  {
    path: '/admin1/reports', labelKey: 'nav.reports',
    icon: <ChartBarIcon />,
    roles: ['admin1'],
  },
  {
    path: '/admin1/notifications', labelKey: 'nav.notifications',
    icon: <BellIcon />,
    roles: ['admin1'],
  },
  {
    path: '/admin2/centre', labelKey: 'nav.controlCentre',
    icon: <ShieldIcon />,
    roles: ['admin2', 'super_admin'],
  },
  {
    path: '/admin2/reports', labelKey: 'nav.reports',
    icon: <ChartBarIcon />,
    roles: ['admin2', 'super_admin'],
  },
  {
    path: '/admin2/articles', labelKey: 'nav.articlesManager',
    icon: <ArticlesIcon />,
    roles: ['admin2', 'super_admin'],
  },
  {
    path: '/admin2/notifications', labelKey: 'nav.notifications',
    icon: <BellIcon />,
    roles: ['admin2', 'super_admin'],
  },
  {
    path: '/super-admin/settings', labelKey: 'nav.settings',
    icon: <SettingsIcon />,
    roles: ['super_admin'],
  },
  {
    path: '/articles', labelKey: 'nav.articles',
    icon: <ArticlesIcon />,
    roles: ['archer', 'coach', 'admin1', 'admin2', 'super_admin'],
  },
]

// ─── NAV BADGES ──────────────────────────────────────────────────────────────

const ARTICLES_SEEN_KEY = 'asm-articles-seen'

/** Red-dot state for the nav tabs: unread notifications count and whether an
 *  article newer than the user's last visit to /articles exists.
 *  ponytail: polls every 60s + refetches on route change; realtime
 *  subscriptions if that ever feels stale. */
function useNavDots(profileId: string | undefined, role: Role | undefined, pathname: string) {
  const unread = useQuery({
    queryKey: ['nav-unread-notifications', profileId],
    queryFn: () => getUnreadCount(profileId!),
    enabled: !!profileId,
    refetchInterval: 60_000,
  })
  const latestArticle = useQuery({
    queryKey: ['nav-latest-article', role],
    queryFn: () => getLatestArticleDate(role!),
    enabled: !!role,
    refetchInterval: 60_000,
  })

  const [articlesSeenAt, setArticlesSeenAt] = useState(() => localStorage.getItem(ARTICLES_SEEN_KEY) ?? '')

  const refetchUnread = unread.refetch
  useEffect(() => {
    if (pathname.startsWith('/articles')) {
      const now = new Date().toISOString()
      localStorage.setItem(ARTICLES_SEEN_KEY, now)
      setArticlesSeenAt(now)
    }
    // Route change is when reads happen — refresh the count so the dot clears.
    if (profileId) void refetchUnread()
  }, [pathname, profileId, refetchUnread])

  return {
    notifications: unread.data ?? 0,
    newArticle: !!latestArticle.data && latestArticle.data > articlesSeenAt,
  }
}

// ─── HEADER ──────────────────────────────────────────────────────────────────

export function Header() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { theme, toggleTheme } = useTheme()
  const badges = useUiStore((s) => s.badges)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  const role = profile?.role
  const navItems = role ? NAV_ITEMS.filter((item) => item.roles.includes(role)) : []
  const dots = useNavDots(profile?.id, role, location.pathname)

  // Close dropdown on outside click — checks both trigger and portal dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !dropdownRef.current?.contains(t)) {
        setMenuOpen(false)
      }
    }
    const kh = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', kh)
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', kh) }
  }, [])

  const totalBadge = badges.notifications + badges.achievements + badges.pendingApprovals + dots.notifications

  // Branding (Super Admin → Branding) — fall back to the built-in identity.
  const brandName  = useBrandingValue<string>('brand_name', 'Archery Scene Monitor')
  const brandShort = useBrandingValue<string>('brand_short_name', 'EAD · KPM Development')
  const logoLight  = useBrandingValue<string>('brand_logo_light', '')
  const logoDark   = useBrandingValue<string>('brand_logo_dark', '')
  const brandLogo  = (theme === 'dark' ? logoDark || logoLight : logoLight || logoDark).trim()

  return (
    <header
      className="sticky top-0 z-60 border-b border-line"
      style={{
        background: 'var(--header)',
        backdropFilter: 'saturate(160%) blur(14px)',
        WebkitBackdropFilter: 'saturate(160%) blur(14px)',
        paddingTop: 'var(--safe-t)',
      }}
    >
      <div className="max-w-[1240px] mx-auto px-4 py-2.5 flex items-center gap-3">
        {/* Logo */}
        <button
          onClick={() => navigate(role ? getHomePath(role) : '/')}
          className="flex items-center gap-2.5 min-w-0 hover:opacity-80 transition-opacity"
        >
          {brandLogo ? (
            <img
              src={brandLogo}
              alt={brandName}
              className="h-9 max-w-[140px] object-contain flex-shrink-0"
            />
          ) : (
            <div
              className="w-9 h-9 rounded-[11px] flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(140deg, var(--primary), var(--primary-hover))', boxShadow: '0 6px 16px var(--primary-soft)' }}
            >
              <TargetIcon size={20} className="text-primary-on" />
            </div>
          )}
          <div className="min-w-0 hidden sm:block">
            <div className="font-display font-semibold text-[15.5px] leading-tight text-text truncate">{brandName}</div>
            <div className="text-[10px] text-text-faint uppercase tracking-[.07em] truncate">{brandShort}</div>
          </div>
        </button>

        {/* Desktop top nav */}
        {profile && (
          <nav
            className="ml-auto mr-2 hidden md:flex bg-section rounded-[13px] p-1 gap-0.5"
            aria-label="Primary navigation"
          >
            {navItems.slice(0, 5).map((item) => {
              const active = location.pathname.startsWith(item.path.split('/').slice(0, 3).join('/'))
              const showDot =
                (item.labelKey === 'nav.notifications' && dots.notifications > 0) ||
                (item.labelKey === 'nav.articles' && dots.newArticle)
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    'relative flex items-center gap-1.5 px-3 py-2 rounded-[9px] text-[13px] font-display font-medium',
                    'transition-all duration-150 ease-[var(--ease-out)] whitespace-nowrap',
                    active
                      ? 'bg-surface text-text shadow-[0_2px_8px_rgba(0,0,0,.07)]'
                      : 'text-text-dim hover:text-text hover:bg-surface-soft',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <span className="w-4 h-4">{item.icon}</span>
                  {t(item.labelKey)}
                  {showDot && <RedDot pulse className="absolute top-1 right-1.5" />}
                </button>
              )
            })}
          </nav>
        )}

        {/* Right tools */}
        <div className={cn('flex items-center gap-2', profile ? 'ml-auto md:ml-0' : 'ml-auto')}>
          {/* Font size lives in the account dropdown (FontSizeMenuRow) */}

          {/* Language — lives in the account dropdown once signed in */}
          {!profile && <LanguageSwitcher />}

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            aria-label={t('menu.toggleDarkMode')}
            className="w-10 h-10 rounded-[11px] border border-line bg-surface text-text-dim inline-flex items-center justify-center hover:text-text hover:border-line-strong hover:-translate-y-px transition-all active:scale-90"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Account dropdown */}
          {profile && (
            <div className="relative">
              <button
                ref={triggerRef}
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-[11px] px-2 py-1.5 hover:bg-surface-soft text-text-dim hover:text-text transition-colors"
              >
                <div className="relative">
                  <Avatar name={profile.name || profile.email} size="sm" />
                  {totalBadge > 0 && (
                    <RedDot count={totalBadge} className="absolute -top-1 -right-1" />
                  )}
                </div>
                <span className="text-[13px] text-text-dim hidden sm:inline max-w-[150px] truncate">
                  {profile.name || profile.email}
                </span>
                <ChevronDown
                  className={cn('w-3.5 h-3.5 text-text-faint transition-transform duration-200', menuOpen && 'rotate-180')}
                />
              </button>

              {menuOpen && (
                <AccountMenu
                  profile={profile}
                  role={role!}
                  onClose={() => setMenuOpen(false)}
                  onChangePassword={() => { setMenuOpen(false); setPwOpen(true) }}
                  triggerRef={triggerRef}
                  dropdownRef={dropdownRef}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </header>
  )
}

// ─── CHANGE PASSWORD ─────────────────────────────────────────────────────────

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (pw.length < 6) { err(t('changePw.tooShort')); return }
    if (pw !== pw2) { err(t('changePw.noMatch')); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: pw })
      if (error) throw error
      ok(t('changePw.changed'))
      setPw(''); setPw2('')
      onClose()
    } catch (e: unknown) {
      err(t('changePw.failed'), (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={() => !saving && onClose()} title={t('changePw.title')} width="min(400px,100%)">
      <div className="space-y-4">
        <Input
          label={t('changePw.newPassword')}
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder={t('changePw.atLeast6')}
          autoComplete="new-password"
        />
        <Input
          label={t('changePw.confirmNew')}
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          placeholder={t('changePw.repeatNew')}
          autoComplete="new-password"
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button variant="primary" size="sm" loading={saving} onClick={submit}>{t('changePw.title')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── ACCOUNT DROPDOWN ────────────────────────────────────────────────────────

function AccountMenu({
  profile, role, onClose, onChangePassword, triggerRef, dropdownRef,
}: {
  profile: NonNullable<ReturnType<typeof useAuth>['profile']>
  role: Role
  onClose: () => void
  onChangePassword: () => void
  triggerRef: React.RefObject<HTMLButtonElement>
  dropdownRef: React.RefObject<HTMLDivElement>
}) {
  const navigate = useNavigate()
  const signOut = useSignOut()
  const { t } = useLanguage()
  const [pos, setPos] = useState({ top: 0, right: 0 })

  useEffect(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({ top: r.bottom + 9, right: window.innerWidth - r.right })
  }, [triggerRef])

  const go = (path: string) => { onClose(); navigate(path) }
  const logout = async () => { onClose(); await signOut() }

  return createPortal(
    <div
      ref={dropdownRef}
      className="fixed w-[min(290px,calc(100vw-28px))] bg-surface border border-line rounded-[var(--r-lg)] shadow-card-lg p-1.5 z-[200] animate-menu-in overflow-y-auto"
      style={{ top: pos.top, right: pos.right, maxHeight: `calc(100vh - ${pos.top}px - 12px)` }}
      role="menu"
    >
      {/* Head */}
      <div className="flex items-center gap-2.5 px-2.5 py-2 mb-1">
        <Avatar name={profile.name || profile.email} size="lg" />
        <div className="min-w-0">
          <div className="font-display font-semibold text-sm text-text truncate">{profile.name || profile.email}</div>
          <div className="text-[11.5px] text-text-faint truncate">{profile.email}</div>
          <span className="inline-block mt-1 text-[10px] font-semibold uppercase tracking-[.05em] px-2 py-0.5 rounded-md bg-primary-soft text-primary">
            {t('roles.' + role)}
          </span>
        </div>
      </div>

      <div className="h-px bg-line mx-0.5 mb-1" />

      {/* Role-specific items */}
      {role === 'archer' && (
        <>
          <MenuItem icon={<IdCardIcon />} label={t('menu.personalDetails')} onClick={() => go('/archer/profile')} />
          <MenuItem icon={<EditIcon />} label={t('menu.profileEditor')} onClick={() => go('/archer/profile#profile-editor')} />
          <MenuItem icon={<BowIcon />} label={t('menu.equipmentSetup')} onClick={() => go('/archer/equipment')} />
          <MenuItem icon={<ArticlesIcon />} label={t('nav.articles')} onClick={() => go('/articles')} />
          <MenuItem icon={<EditIcon />} label={t('menu.requestProfileChange')} onClick={() => go('/archer/change-request')} />
        </>
      )}
      {role === 'coach' && (
        <>
          <MenuItem icon={<IdCardIcon />} label={t('menu.coachProfile')} onClick={() => go('/coach/profile')} />
          <MenuItem icon={<TargetIcon size={16} />} label={t('nav.myPerformance')} onClick={() => go('/coach/performance')} />
          <MenuItem icon={<ChartBarIcon />} label={t('nav.coachLeaderboard')} onClick={() => go('/coach/leaderboard')} />
          <MenuItem icon={<ChartBarIcon />} label={t('nav.archersLeaderboard')} onClick={() => go('/coach/archer-leaderboard')} />
          {(profile as { is_pld_coach?: boolean } | null)?.is_pld_coach && (
            <MenuItem icon={<CheckCircleIcon />} label={t('nav.pldValidation')} onClick={() => go('/coach/pld-validation')} />
          )}
          <MenuItem icon={<BowIcon />} label={t('menu.equipmentSetup')} onClick={() => go('/coach/equipment')} />
          <MenuItem icon={<BadgeIcon />} label={t('nav.achievements')} onClick={() => go('/coach/achievements')} />
          <MenuItem icon={<CertIcon />} label={t('nav.certifications')} onClick={() => go('/coach/certifications')} />
        </>
      )}
      {['admin2', 'super_admin'].includes(role) && (
        <>
          <MenuItem icon={<OrgIcon />}     label={t('nav.states')}  onClick={() => go('/admin2/states')} />
          <MenuItem icon={<OrgIcon />}     label={t('nav.plds')}    onClick={() => go('/admin2/plds')} />
          <MenuItem icon={<OrgIcon />}     label={t('nav.schools')} onClick={() => go('/admin2/schools')} />
        </>
      )}
      {role === 'super_admin' && (
        <>
          <MenuItem icon={<ShieldIcon />}   label={t('menu.userManager')}      onClick={() => go('/super-admin/users')} />
          <MenuItem icon={<ChartBarIcon />} label={t('menu.operationsCentre')} onClick={() => go('/admin2/centre')} />
          <MenuItem icon={<CheckCircleIcon />} label={t('menu.approvalsAdmin1')} onClick={() => go('/admin1/approvals')} />
          <MenuItem icon={<ChartBarIcon />} label={t('menu.nationalOverview')} onClick={() => go('/admin1/overview')} />
          <MenuItem icon={<SettingsIcon />} label={t('menu.adminPanel')}       onClick={() => go('/super-admin/settings')} />
          <MenuItem icon={<FlaskIcon />}    label="Demo Data"                 onClick={() => go('/super-admin/demo-data')} />
          <MenuItem icon={<TargetIcon />}   label="Talent Rating"             onClick={() => go('/super-admin/talent-config')} />
        </>
      )}

      <div className="h-px bg-line mx-0.5 my-1" />

      {/* Language — EN/BM toggle, same for every role */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
        <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-text">
          <span className="w-4.5 h-4.5 flex-shrink-0 text-text-dim"><GlobeIcon /></span>
          {t('menu.language')}
        </span>
        <LanguageSwitcher />
      </div>

      {/* Font size — mirrors the header control so mobile/tablet can reach it */}
      <FontSizeMenuRow />

      {/* Replay the first-login walkthrough (Onboarding, Task 5) */}
      <MenuItem
        icon={<TourIcon />}
        label={t('onboarding.menuLabel')}
        onClick={() => { onClose(); useOnboardingStore.getState().openTour() }}
      />
      <MenuItem icon={<KeyMenuIcon />} label={t('changePw.title')} onClick={onChangePassword} />
      <MenuItem icon={<LogoutIcon />} label={t('menu.logout')} onClick={logout} danger />
    </div>,
    document.body
  )
}

/** Font size picker inside the account dropdown (Small → Max). */
function FontSizeMenuRow() {
  const { t } = useLanguage()
  const { fontSize, setFontSize } = useFontSize()
  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-2">
      <span className="flex items-center gap-2.5 text-[13.5px] font-medium text-text">
        <span className="w-4.5 h-4.5 flex-shrink-0 text-text-dim"><FontIcon /></span>
        {t('fontSize.fontLabel')}
      </span>
      <div className="flex items-center bg-section rounded-[9px] p-0.5 gap-0.5">
        {([
          { size: 'small',  labelKey: 'fontSize.small',  cls: 'text-[10px]' },
          { size: 'normal', labelKey: 'fontSize.normal', cls: 'text-[11px]' },
          { size: 'large',  labelKey: 'fontSize.large',  cls: 'text-[12.5px]' },
          { size: 'xl',     labelKey: 'fontSize.xl',     cls: 'text-[14px]' },
          { size: 'max',    labelKey: 'fontSize.max',    cls: 'text-[16px]' },
        ] as const).map(({ size, labelKey, cls }) => (
          <button
            key={size}
            onClick={() => setFontSize(size)}
            title={t(labelKey)}
            className={cn(
              'w-6 h-6 rounded-[7px] font-display font-semibold transition-all duration-150 leading-none',
              cls,
              fontSize === size ? 'bg-surface text-text shadow-sm' : 'text-text-faint hover:text-text',
            )}
          >
            A
            <span className="sr-only">{t(labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function TourIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function FontIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
    </svg>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      role="menuitem"
      className={cn(
        'w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-[var(--r-sm)] text-[13.5px] font-medium text-left transition-colors',
        danger ? 'text-danger hover:bg-danger-soft' : 'text-text hover:bg-surface-soft',
      )}
    >
      <span className={cn('w-4.5 h-4.5 flex-shrink-0', danger ? 'text-danger' : 'text-text-dim')}>{icon}</span>
      {label}
    </button>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

function TargetIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/>
    </svg>
  )
}

function BadgeIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z"/><path d="M9.5 12l1.8 1.8L15 10"/></svg>
}

function ChartBarIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="20" x2="20" y2="20"/><rect x="6" y="11" width="3" height="7" rx="1"/><rect x="11" y="6" width="3" height="12" rx="1"/><rect x="16" y="13" width="3" height="5" rx="1"/></svg>
}

function BellIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
}

function CheckCircleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
}

function PeopleIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M3.5 20a6 6 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16 14.5a5 5 0 0 1 4.5 5"/></svg>
}

function EditIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}

function ShieldIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z"/></svg>
}

function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}

function ArticlesIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h13a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0 1.5 1.5H6a2 2 0 0 1-2-2V4z"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="12" x2="15" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>
}

function SunIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>
}

function MoonIcon() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A8.5 8.5 0 1 1 11.2 3 6.6 6.6 0 0 0 21 12.8z"/></svg>
}

function IdCardIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M5.8 16a3.2 3.2 0 0 1 6.4 0"/><line x1="15" y1="10" x2="18" y2="10"/><line x1="15" y1="14" x2="18" y2="14"/></svg>
}

function BowIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="12" x2="19" y2="12"/><polyline points="14 7 19 12 14 17"/><path d="M4 12l3-2M4 12l3 2"/></svg>
}

function CertIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>
}
function OrgIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 17.5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"/></svg>
}

function FlaskIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6"/><path d="M10 3v6.5L5 18a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-8.5V3"/><path d="M7.5 14h9"/></svg>
}

function GlobeIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a13.5 13.5 0 0 1 0 18a13.5 13.5 0 0 1 0-18z"/></svg>
}

function KeyMenuIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 7-7"/><path d="m17 5 3 3"/><path d="m15 7 3 3"/></svg>
}

function LogoutIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
}

function ChevronDown({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}><polyline points="6 9 12 15 18 9"/></svg>
}

import { PageWrapper, PageHead } from '@/components/layout/PageWrapper'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '@/contexts/LanguageContext'

export default function SuperAdminSettings() {
  const navigate = useNavigate()
  const { t } = useLanguage()

  // One editable permission manager (Role Permissions) + a read-only Role
  // Overview. The retired admin1-perms / admin2-perms / seed cards are gone:
  // Admin 1 & Admin 2 permissions are edited inside Role Permissions, and
  // Super Admin seeding is handled out-of-band (not a frontend tool).
  const panels = [
    { title: t('nav.rolePermissions'), description: t('superAdmin.rolePermissionsDesc'), path: '/super-admin/role-permissions', icon: <ShieldIcon /> },
    { title: t('nav.roleOverview'), description: t('superAdmin.roleOverviewDesc'), path: '/super-admin/roles', icon: <TableIcon /> },
    { title: t('nav.systemRules'), description: t('superAdmin.systemRulesDesc'), path: '/super-admin/system-rules', icon: <RulesIcon /> },
    { title: t('nav.appSettings'), description: t('superAdmin.appSettingsDesc'), path: '/super-admin/app-settings', icon: <SettingsIcon /> },
    { title: t('nav.branding'), description: t('superAdmin.brandingDesc'), path: '/super-admin/branding', icon: <ImageIcon /> },
    { title: 'Demo Data', description: 'Seed or clear tagged mock data for testing and presentations.', path: '/super-admin/demo-data', icon: <FlaskIcon /> },
  ]

  return (
    <PageWrapper>
      <PageHead
        title={t('superAdmin.title')}
        description={t('superAdmin.description')}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {panels.map((panel) => (
          <button
            key={panel.path}
            onClick={() => navigate(panel.path)}
            className="text-left p-5 rounded-[var(--r-lg)] border border-line bg-surface hover:bg-surface-soft hover:-translate-y-0.5 hover:shadow-card hover:border-line-strong transition-all duration-150 active:scale-[0.98]"
          >
            <div className="w-9 h-9 rounded-lg bg-primary-soft text-primary flex items-center justify-center mb-3">
              {panel.icon}
            </div>
            <div className="font-display font-semibold text-sm text-text">{panel.title}</div>
            <div className="text-xs text-text-dim mt-0.5">{panel.description}</div>
          </button>
        ))}
      </div>
    </PageWrapper>
  )
}

function ShieldIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z"/></svg> }
function TableIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9.5" x2="21" y2="9.5"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9.5" y1="9.5" x2="9.5" y2="20"/></svg> }
function SettingsIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> }
function ImageIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg> }
function RulesIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> }
function FlaskIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3h6"/><path d="M10 3v6.5L5 18a2 2 0 0 0 1.7 3h10.6A2 2 0 0 0 19 18l-5-8.5V3"/><path d="M7.5 14h9"/></svg> }

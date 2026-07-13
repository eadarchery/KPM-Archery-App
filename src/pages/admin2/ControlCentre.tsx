import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { StatCard } from '@/components/ui/StatCard'
import { Button } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { useLanguage } from '@/contexts/LanguageContext'
import { compact } from '@/utils/format'
import { cn } from '@/utils/cn'

interface AdminCard {
  titleKey: string
  descKey: string
  icon: React.ReactNode
  path: string
  badge?: number
  variant?: 'default' | 'accent'
}

export default function Admin2ControlCentre() {
  const navigate = useNavigate()
  const { t } = useLanguage()

  const { data: counts } = useQuery({
    queryKey: ['admin2-counts'],
    queryFn: async () => {
      const [pendingUsers, pendingScores, pendingChangeRequests] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        // Admin 2 validates the second stage: scores a coach has already approved
        // (status 'coach_approved'). Scores still at 'pending' are awaiting the
        // coach and are not yet in the Score Validator queue — counting those here
        // made the card disagree with the page it opens.
        supabase.from('score_submissions').select('id', { count: 'exact', head: true }).eq('status', 'coach_approved'),
        supabase.from('profile_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      return {
        pendingUsers: pendingUsers.count ?? 0,
        pendingScores: pendingScores.count ?? 0,
        pendingChangeRequests: pendingChangeRequests.count ?? 0,
      }
    },
  })

  const adminCards: AdminCard[] = [
    { titleKey: 'controlCentre.userManager', descKey: 'controlCentre.userManagerDesc', icon: <PeopleIcon />, path: '/admin2/users', badge: counts?.pendingUsers },
    { titleKey: 'controlCentre.changeRequests', descKey: 'controlCentre.changeRequestsDesc', icon: <EditIcon />, path: '/admin2/change-requests', badge: counts?.pendingChangeRequests },
    { titleKey: 'controlCentre.scoreValidator', descKey: 'controlCentre.scoreValidatorDesc', icon: <CheckIcon />, path: '/admin2/scores', badge: counts?.pendingScores },
    { titleKey: 'controlCentre.unlinkedValidator', descKey: 'controlCentre.unlinkedValidatorDesc', icon: <CheckIcon />, path: '/admin2/unlinked' },
    { titleKey: 'controlCentre.roundManager', descKey: 'controlCentre.roundManagerDesc', icon: <TargetIcon />, path: '/admin2/rounds' },
    { titleKey: 'controlCentre.coachCerts', descKey: 'controlCentre.coachCertsDesc', icon: <CertIcon />, path: '/admin2/certifications' },
    { titleKey: 'controlCentre.notifManager', descKey: 'controlCentre.notifManagerDesc', icon: <BellIcon />, path: '/admin2/notifications' },
    { titleKey: 'controlCentre.articleManager', descKey: 'controlCentre.articleManagerDesc', icon: <ArticleIcon />, path: '/admin2/articles' },
    { titleKey: 'controlCentre.achievementManager', descKey: 'controlCentre.achievementManagerDesc', icon: <BadgeIcon />, path: '/admin2/achievements' },
    { titleKey: 'controlCentre.auditLogs', descKey: 'controlCentre.auditLogsDesc', icon: <LogIcon />, path: '/admin2/audit' },
    { titleKey: 'controlCentre.accountRecovery', descKey: 'controlCentre.accountRecoveryDesc', icon: <KeyIcon />, path: '/admin2/account-recovery' },
    { titleKey: 'controlCentre.roleOverview', descKey: 'controlCentre.roleOverviewDesc', icon: <ShieldIcon />, path: '/admin2/roles' },
  ]

  return (
    <PageWrapper>
      <PageHead
        title={t('controlCentre.title')}
        description={t('controlCentre.description')}
      />

      {/* Quick stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label={t('controlCentre.pendingApprovals')}
          value={compact(counts?.pendingUsers ?? 0)}
          badge={counts?.pendingUsers}
          clickable
          onClick={() => navigate('/admin2/users')}
          icon={<PeopleIcon />}
        />
        <StatCard
          label={t('controlCentre.pendingScores')}
          value={compact(counts?.pendingScores ?? 0)}
          badge={counts?.pendingScores}
          clickable
          onClick={() => navigate('/admin2/scores')}
          icon={<CheckIcon />}
        />
        <StatCard
          label={t('controlCentre.actionsToday')}
          value="—"
          sub={t('controlCentre.auditLog')}
          clickable
          onClick={() => navigate('/admin2/audit')}
          icon={<LogIcon />}
        />
        <StatCard
          label={t('controlCentre.activeArticles')}
          value="—"
          clickable
          onClick={() => navigate('/admin2/articles')}
          icon={<ArticleIcon />}
        />
      </div>

      {/* Admin cards grid */}
      <SectionCard title={t('controlCentre.managementTools')}>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {adminCards.map((card) => (
            <button
              key={card.path}
              onClick={() => navigate(card.path)}
              className={cn(
                'relative text-left p-4 rounded-[var(--r-lg)] border border-line',
                'bg-surface hover:bg-surface-soft transition-all duration-150',
                'hover:-translate-y-0.5 hover:shadow-card hover:border-line-strong',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                'active:scale-[0.98]',
              )}
            >
              {card.badge !== undefined && card.badge > 0 && (
                <span className="absolute top-3 right-3 min-w-[18px] h-[18px] bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {card.badge > 99 ? '99+' : card.badge}
                </span>
              )}
              <div className="w-8 h-8 rounded-lg bg-primary-soft text-primary flex items-center justify-center mb-3">
                {card.icon}
              </div>
              <div className="font-display font-semibold text-sm text-text">{t(card.titleKey)}</div>
              <div className="text-xs text-text-dim mt-0.5">{t(card.descKey)}</div>
            </button>
          ))}
        </div>
      </SectionCard>
    </PageWrapper>
  )
}

function PeopleIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.4"/><path d="M3.5 20a6 6 0 0 1 11 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M16 14.5a5 5 0 0 1 4.5 5"/></svg> }
function CheckIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> }
function EditIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> }
function CertIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg> }
function BellIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> }
function ArticleIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h13a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0 1.5 1.5H6a2 2 0 0 1-2-2V4z"/><line x1="8" y1="8" x2="15" y2="8"/><line x1="8" y1="12" x2="15" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg> }
function BadgeIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V5z"/></svg> }
function LogIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> }
function ShieldIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.4-3 8.3-7 9.5C8 19.3 5 15.4 5 11V6z"/></svg> }
function KeyIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.5 12.5 7-7"/><path d="m17 5 3 3"/><path d="m15 7 3 3"/></svg> }
function TargetIcon() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.6" fill="currentColor"/></svg> }

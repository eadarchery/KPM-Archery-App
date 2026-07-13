import { cn } from '@/utils/cn'
import { useLanguage } from '@/contexts/LanguageContext'
import type { AccountStatus, SubmissionStatus, CertificationStatus, Role } from '@/types'

type BadgeVariant = 'success' | 'warning' | 'danger' | 'primary' | 'neutral'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
  dot?: boolean
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'tag-success',
  warning: 'tag-warning',
  danger:  'tag-danger',
  primary: 'tag-primary',
  neutral: 'tag-neutral',
}

export function Badge({ variant = 'neutral', children, className, dot }: BadgeProps) {
  return (
    <span className={cn('tag', variantClasses[variant], className)}>
      {dot && <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1 -translate-y-px" />}
      {children}
    </span>
  )
}

// ─── CONVENIENCE BADGES ──────────────────────────────────────────────────────

const accountStatusVariant: Record<AccountStatus, BadgeVariant> = {
  approved:  'success',
  pending:   'warning',
  rejected:  'danger',
  suspended: 'danger',
  inactive:  'neutral',
}

export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const { t } = useLanguage()
  return (
    <Badge variant={accountStatusVariant[status]} dot>
      {t(`status.${status}`)}
    </Badge>
  )
}

const submissionVariant: Record<SubmissionStatus, BadgeVariant> = {
  pending:        'warning',
  coach_approved: 'primary',
  admin_approved: 'success',
  rejected:       'danger',
  withdrawn:      'neutral',
}

const submissionLabelKey: Record<SubmissionStatus, string> = {
  pending:        'status.pending',
  coach_approved: 'status.coachApproved',
  admin_approved: 'status.approved',
  rejected:       'status.rejected',
  withdrawn:      'status.withdrawn',
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const { t } = useLanguage()
  return (
    <Badge variant={submissionVariant[status]}>
      {t(submissionLabelKey[status])}
    </Badge>
  )
}

const certVariant: Record<CertificationStatus, BadgeVariant> = {
  approved: 'success',
  pending:  'warning',
  rejected: 'danger',
  withdrawn: 'neutral',
  expired:  'warning',
}

export function CertBadge({ status }: { status: CertificationStatus }) {
  const { t } = useLanguage()
  return <Badge variant={certVariant[status]}>{t(`status.${status}`)}</Badge>
}

const roleVariant: Record<Role, BadgeVariant> = {
  archer:      'primary',
  coach:       'neutral',
  admin1:      'neutral',
  admin2:      'neutral',
  super_admin: 'danger',
}

export function RoleBadge({ role }: { role: Role }) {
  const { t } = useLanguage()
  return <Badge variant={roleVariant[role]}>{t(`roles.${role}`)}</Badge>
}

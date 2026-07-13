/**
 * Frontend-only audit helpers: classify audit actions into risk levels and
 * categories for the Admin 2 / Super Admin Audit Logs viewer.
 *
 * Pure functions of the `action` string (e.g. "user.role_changed",
 * "organization.school.archived"). No React, no Supabase — safe to reuse in
 * services, components and the CSV export.
 *
 * Action naming convention used across this app is dotted + verb-suffixed:
 *   <domain>.<entity>.<verb>   e.g. organization.school.archived
 *   <domain>.<verb>            e.g. user.role_changed, article.deleted
 *
 * Labels are intentionally plain English so they convert cleanly to
 * Bahasa Malaysia / English translation keys later — keep copy translatable.
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type AuditCategory =
  | 'users'
  | 'scores'
  | 'achievements'
  | 'notifications'
  | 'articles'
  | 'organization'
  | 'equipment'
  | 'system_rules'
  | 'role_permissions'
  | 'auth'
  | 'other'

// Mirror of the Badge component's variant union (not exported from Badge.tsx).
type BadgeVariant = 'success' | 'warning' | 'danger' | 'primary' | 'neutral'

// ─── CATEGORY ──────────────────────────────────────────────────────────────

export const AUDIT_CATEGORY_LABELS: Record<AuditCategory, string> = {
  users:            'Users',
  scores:           'Scores',
  achievements:     'Achievements',
  notifications:    'Notifications',
  articles:         'Articles',
  organization:     'Organization',
  equipment:        'Equipment',
  system_rules:     'System Rules',
  role_permissions: 'Role Permissions',
  auth:             'Auth/Security',
  other:            'Other',
}

/** Ordered options for the category filter <Select>, led by an "All" entry. */
export const AUDIT_CATEGORY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All categories' },
  ...(Object.keys(AUDIT_CATEGORY_LABELS) as AuditCategory[])
    .filter(c => c !== 'other')
    .map(c => ({ value: c, label: AUDIT_CATEGORY_LABELS[c] })),
  { value: 'other', label: AUDIT_CATEGORY_LABELS.other },
]

/** Translation keys mirroring AUDIT_CATEGORY_LABELS, for translated UIs. */
export const AUDIT_CATEGORY_LABEL_KEYS: Record<AuditCategory, string> = {
  users:            'auditPage.catUsers',
  scores:           'auditPage.catScores',
  achievements:     'auditPage.catAchievements',
  notifications:    'auditPage.catNotifications',
  articles:         'auditPage.catArticles',
  organization:     'auditPage.catOrganization',
  equipment:        'auditPage.catEquipment',
  system_rules:     'auditPage.catSystemRules',
  role_permissions: 'auditPage.catRolePermissions',
  auth:             'auditPage.catAuth',
  other:            'auditPage.catOther',
}

export function getCategoryLabelKey(action: string): string {
  return AUDIT_CATEGORY_LABEL_KEYS[getActionCategory(action)]
}

/** Filter options carrying translation keys instead of English labels. */
export const AUDIT_CATEGORY_FILTER_OPTION_KEYS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'common.allCategories' },
  ...(Object.keys(AUDIT_CATEGORY_LABEL_KEYS) as AuditCategory[])
    .filter(c => c !== 'other')
    .map(c => ({ value: c, labelKey: AUDIT_CATEGORY_LABEL_KEYS[c] })),
  { value: 'other', labelKey: AUDIT_CATEGORY_LABEL_KEYS.other },
]

/** Map an action string to a coarse category by its prefix. */
export function getActionCategory(action: string): AuditCategory {
  const a = action.toLowerCase()
  const starts = (p: string) => a.startsWith(p)

  if (starts('user.') || starts('coach_archer_link.') || starts('approval.') ||
      starts('archer.') || starts('admin2.') || a.includes('profile_change')) return 'users'
  if (starts('score.') || starts('tournament_score.') || starts('training_score.') ||
      starts('submission.')) return 'scores'
  if (starts('achievement.') || starts('user_achievement.')) return 'achievements'
  if (starts('notification.')) return 'notifications'
  if (starts('article.')) return 'articles'
  if (starts('organization.')) return 'organization'
  if (starts('equipment.')) return 'equipment'
  if (starts('system_rule')) return 'system_rules'
  if (starts('role_permission')) return 'role_permissions'
  if (starts('auth.') || starts('session.') || a.includes('login') || a.includes('password')) return 'auth'
  return 'other'
}

export function getCategoryLabel(action: string): string {
  return AUDIT_CATEGORY_LABELS[getActionCategory(action)]
}

// ─── RISK ──────────────────────────────────────────────────────────────────

// Exact-match overrides take precedence over the verb/domain heuristics below.
const EXACT_RISK: Record<string, RiskLevel> = {
  'user.role_changed':         'critical',
  'user.suspended':            'high',
  'user.reactivated':          'medium',
  'user.rejected':             'medium',
  'user.rejected_by_admin1':   'medium',
  'user.approved':             'low',
  'user.approved_by_admin1':   'low',
  'approval.scope_denied':     'high',   // security signal: out-of-scope attempt
  'score.deleted':             'high',
  'tournament_score.approved': 'high',
  'tournament_score.rejected': 'medium',
  'article.deleted':           'high',
  'notification.deleted':      'high',
}

/** Risk level for an action — exact overrides first, then domain/verb rules. */
export function getActionRisk(action: string): RiskLevel {
  const a = action.toLowerCase()
  if (a in EXACT_RISK) return EXACT_RISK[a]

  // Security-structural domains are always the most sensitive.
  if (a.startsWith('system_rule') || a.startsWith('role_permission') ||
      a.includes('maintenance_mode') || a.includes('role_changed')) return 'critical'

  // Verb-based fallbacks.
  if (a.endsWith('.deleted') || a.endsWith('.suspended')) return 'high'
  if (a.includes('scope_denied')) return 'high'
  if (a.endsWith('.archived') || a.endsWith('.rejected') || a.endsWith('.removed')) return 'medium'

  return 'low'
}

export const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
}

/** Translation keys mirroring RISK_LABELS, for translated UIs. */
export const RISK_LABEL_KEYS: Record<RiskLevel, string> = {
  low: 'auditPage.riskLow', medium: 'auditPage.riskMedium',
  high: 'auditPage.riskHigh', critical: 'auditPage.riskCritical',
}

export const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 }

export function riskBadgeVariant(risk: RiskLevel): BadgeVariant {
  switch (risk) {
    case 'critical': return 'danger'
    case 'high':     return 'danger'
    case 'medium':   return 'warning'
    default:         return 'neutral'
  }
}

/** Low risk is the unremarkable default — only surface a badge for medium+. */
export function shouldShowRisk(risk: RiskLevel): boolean {
  return risk !== 'low'
}

// ─── DISPLAY ───────────────────────────────────────────────────────────────

/** "organization.school.archived" → "Organization · School · Archived". */
export function humanizeAction(action: string): string {
  return action
    .split('.')
    .map(part => part.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))
    .join(' · ')
}

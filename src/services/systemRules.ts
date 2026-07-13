import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import { useAuthStore } from '@/store/authStore'
import { assertCan, canManageSystemRules } from '@/lib/permissions'
import type { Role, SystemRule, SystemRuleValue, SystemRuleValueType } from '@/types'

// ─── CATEGORIES ────────────────────────────────────────────────────────────────
// Display order + labels for the System Rules page tabs. Keys match the DB.

export const SYSTEM_RULE_CATEGORIES: { key: string; label: string; labelKey: string }[] = [
  { key: 'modules',       label: 'Modules',              labelKey: 'sysRuleCat.modules' },
  { key: 'registration',  label: 'Registration',         labelKey: 'sysRuleCat.registration' },
  { key: 'scores',        label: 'Scores',               labelKey: 'sysRuleCat.scores' },
  { key: 'validation',    label: 'Validation',           labelKey: 'sysRuleCat.validation' },
  { key: 'achievements',  label: 'Achievements',         labelKey: 'sysRuleCat.achievements' },
  { key: 'notifications', label: 'Notifications',        labelKey: 'sysRuleCat.notifications' },
  { key: 'articles',      label: 'Articles',             labelKey: 'sysRuleCat.articles' },
  { key: 'equipment',     label: 'Equipment',            labelKey: 'sysRuleCat.equipment' },
  { key: 'leaderboard',   label: 'Leaderboard & Reports', labelKey: 'sysRuleCat.leaderboard' },
  { key: 'system',        label: 'System',               labelKey: 'sysRuleCat.system' },
]

/** Rules whose change should be confirmed (high blast radius). */
export const IMPORTANT_RULE_KEYS = new Set<string>([
  'maintenance_mode',
  'allow_new_registrations',
  'module_scores_enabled',
  'module_articles_enabled',
  'module_notifications_enabled',
  'coach_can_validate_training_scores',
  'tournament_scores_require_admin2_approval',
  'strict_role_permissions_enabled',
])

// ─── DEFAULT CATALOG ─────────────────────────────────────────────────────────────
// Mirror of the seed in supabase/migrations/015_system_rules.sql. Used for
// "restore missing defaults" and "reset to default". Keep the two in sync.

export interface SystemRuleSeed {
  key: string
  label: string
  description: string
  category: string
  value: SystemRuleValue
  value_type: SystemRuleValueType
  is_public: boolean
  editable_by?: string[]
}

export const DEFAULT_SYSTEM_RULES: SystemRuleSeed[] = [
  // Modules
  { key: 'module_scores_enabled',         label: 'Scores module',         description: 'Enable the scoring module across the app.',      category: 'modules', value: true, value_type: 'boolean', is_public: true },
  { key: 'module_achievements_enabled',   label: 'Achievements module',   description: 'Enable the achievements / badges module.',       category: 'modules', value: true, value_type: 'boolean', is_public: true },
  { key: 'module_notifications_enabled',  label: 'Notifications module',  description: 'Enable the notifications module.',               category: 'modules', value: true, value_type: 'boolean', is_public: true },
  { key: 'module_articles_enabled',       label: 'Articles module',       description: 'Enable the articles / learning content module.', category: 'modules', value: true, value_type: 'boolean', is_public: true },
  { key: 'module_equipment_enabled',      label: 'Equipment module',      description: 'Enable archer/coach equipment profiles.',        category: 'modules', value: true, value_type: 'boolean', is_public: true },
  { key: 'module_reports_enabled',        label: 'Reports module',        description: 'Enable reporting dashboards.',                   category: 'modules', value: true, value_type: 'boolean', is_public: true },
  { key: 'module_leaderboard_enabled',    label: 'Leaderboard module',    description: 'Enable the leaderboard module.',                 category: 'modules', value: true, value_type: 'boolean', is_public: true },
  { key: 'module_certifications_enabled', label: 'Certifications module', description: 'Enable coach certifications.',                   category: 'modules', value: true, value_type: 'boolean', is_public: true },

  // Registration
  { key: 'archer_registration_requires_approval', label: 'Archer registration needs approval', description: 'New archer accounts require approval before access.', category: 'registration', value: true,  value_type: 'boolean', is_public: false },
  { key: 'coach_registration_requires_approval',  label: 'Coach registration needs approval',  description: 'New coach accounts require approval before access.',  category: 'registration', value: true,  value_type: 'boolean', is_public: false },
  { key: 'student_requires_school_approval',      label: 'Student needs school approval',      description: 'Students must be approved by their school.',          category: 'registration', value: false, value_type: 'boolean', is_public: false },
  { key: 'coach_requires_admin_approval',         label: 'Coach needs admin approval',         description: 'Coaches must be approved by an admin.',               category: 'registration', value: true,  value_type: 'boolean', is_public: false },
  { key: 'admin1_can_approve_archers',            label: 'Admin 1 can approve archers',        description: 'Allow Admin 1 to approve archer registrations.',      category: 'registration', value: false, value_type: 'boolean', is_public: false },
  { key: 'admin1_can_approve_coaches',            label: 'Admin 1 can approve coaches',        description: 'Allow Admin 1 to approve coach registrations.',       category: 'registration', value: false, value_type: 'boolean', is_public: false },
  { key: 'admin2_can_approve_all_users',          label: 'Admin 2 can approve all users',      description: 'Allow Admin 2 to approve any user registration.',     category: 'registration', value: true,  value_type: 'boolean', is_public: false },

  // Scores
  { key: 'archers_can_submit_training_scores',          label: 'Archers submit training scores',   description: 'Archers may submit their own training scores.',            category: 'scores', value: true, value_type: 'boolean', is_public: true },
  { key: 'archers_can_submit_tournament_scores',        label: 'Archers submit tournament scores', description: 'Archers may submit their own tournament scores.',          category: 'scores', value: true, value_type: 'boolean', is_public: true },
  { key: 'coaches_can_submit_scores_for_archers',       label: 'Coaches submit for archers',       description: 'Coaches may submit scores on behalf of linked archers.',   category: 'scores', value: true, value_type: 'boolean', is_public: false },
  { key: 'allow_score_edit_after_submission',           label: 'Allow score edit after submit',    description: 'Allow editing a score after it has been submitted.',       category: 'scores', value: true, value_type: 'boolean', is_public: false },
  { key: 'score_edit_time_limit_hours',                 label: 'Score edit time limit (hours)',    description: 'Hours during which a submitted score may still be edited.', category: 'scores', value: 24,   value_type: 'number',  is_public: false },
  { key: 'require_score_validation_before_leaderboard', label: 'Validate before leaderboard',      description: 'Scores must be validated before counting on leaderboard.', category: 'scores', value: true, value_type: 'boolean', is_public: false },

  // Validation
  { key: 'coach_can_validate_training_scores',       label: 'Coach validates training scores',     description: 'Coaches may validate training scores.',          category: 'validation', value: true,  value_type: 'boolean', is_public: false },
  { key: 'coach_can_validate_tournament_scores',     label: 'Coach validates tournament scores',   description: 'Coaches may validate tournament scores.',        category: 'validation', value: false, value_type: 'boolean', is_public: false },
  { key: 'admin1_can_validate_training_scores',      label: 'Admin 1 validates training scores',   description: 'Allow Admin 1 to validate training scores.',     category: 'validation', value: false, value_type: 'boolean', is_public: false },
  { key: 'admin2_can_validate_tournament_scores',    label: 'Admin 2 validates tournament scores', description: 'Allow Admin 2 to validate tournament scores.',   category: 'validation', value: true,  value_type: 'boolean', is_public: false },
  { key: 'tournament_scores_require_proof',          label: 'Tournament scores need proof',        description: 'Tournament scores require uploaded proof.',      category: 'validation', value: true,  value_type: 'boolean', is_public: false },
  { key: 'tournament_scores_require_admin2_approval', label: 'Tournament needs Admin 2 approval',  description: 'Tournament scores require final Admin 2 approval.', category: 'validation', value: true, value_type: 'boolean', is_public: false },
  { key: 'rejected_scores_can_be_resubmitted',       label: 'Rejected scores can resubmit',        description: 'Allow resubmission of rejected scores.',         category: 'validation', value: true,  value_type: 'boolean', is_public: false },

  // Achievements
  { key: 'achievements_auto_grant_enabled',           label: 'Auto-grant achievements',  description: 'Automatically grant achievements when earned.', category: 'achievements', value: true, value_type: 'boolean', is_public: false },
  { key: 'achievements_show_locked_badges',           label: 'Show locked badges',       description: 'Show locked / not-yet-earned badges to users.',  category: 'achievements', value: true, value_type: 'boolean', is_public: true },
  { key: 'achievements_show_progress',                label: 'Show achievement progress', description: 'Show progress toward locked achievements.',     category: 'achievements', value: true, value_type: 'boolean', is_public: true },
  { key: 'achievement_badges_public_to_coach',        label: 'Badges visible to coach',  description: "Coaches can see their archers' earned badges.",  category: 'achievements', value: true, value_type: 'boolean', is_public: false },
  { key: 'achievement_badges_public_to_school_admin', label: 'Badges visible to school admin', description: 'School admins can see earned badges.',     category: 'achievements', value: true, value_type: 'boolean', is_public: false },

  // Notifications
  { key: 'notifications_enabled',                 label: 'Notifications enabled',     description: 'Master switch for sending notifications.',              category: 'notifications', value: true,  value_type: 'boolean', is_public: true },
  { key: 'admin2_can_send_global_notifications',  label: 'Admin 2 global notifications', description: 'Allow Admin 2 to send app-wide notifications.',      category: 'notifications', value: true,  value_type: 'boolean', is_public: false },
  { key: 'admin1_can_send_scope_notifications',   label: 'Admin 1 scoped notifications', description: 'Allow Admin 1 to send notifications within its scope.', category: 'notifications', value: true, value_type: 'boolean', is_public: false },
  { key: 'coaches_can_send_archer_notifications', label: 'Coaches notify archers',    description: 'Allow coaches to notify their linked archers.',         category: 'notifications', value: false, value_type: 'boolean', is_public: false },
  { key: 'urgent_notifications_enabled',          label: 'Urgent notifications',      description: 'Allow high-priority / urgent notifications.',           category: 'notifications', value: true,  value_type: 'boolean', is_public: false },

  // Articles
  { key: 'articles_enabled',                       label: 'Articles enabled',           description: 'Master switch for the articles feature.',              category: 'articles', value: true,  value_type: 'boolean', is_public: true },
  { key: 'admin2_can_publish_articles',            label: 'Admin 2 publishes articles', description: 'Allow Admin 2 to publish articles.',                   category: 'articles', value: true,  value_type: 'boolean', is_public: false },
  { key: 'admin1_can_create_articles',             label: 'Admin 1 creates articles',   description: 'Allow Admin 1 to create articles.',                    category: 'articles', value: false, value_type: 'boolean', is_public: false },
  { key: 'coaches_can_submit_article_suggestions', label: 'Coaches suggest articles',   description: 'Allow coaches to submit article suggestions.',         category: 'articles', value: false, value_type: 'boolean', is_public: false },
  { key: 'articles_require_review_before_publish', label: 'Articles need review',       description: 'Articles require review before they can be published.', category: 'articles', value: false, value_type: 'boolean', is_public: false },

  // Equipment
  { key: 'equipment_profiles_enabled',         label: 'Equipment profiles enabled', description: 'Enable equipment setup profiles.',                 category: 'equipment', value: true,  value_type: 'boolean', is_public: true },
  { key: 'archers_can_edit_own_equipment',     label: 'Archers edit own equipment', description: 'Allow archers to edit their own equipment setup.', category: 'equipment', value: true,  value_type: 'boolean', is_public: false },
  { key: 'coaches_can_view_archer_equipment',  label: 'Coaches view equipment',     description: "Allow coaches to view linked archers' equipment.", category: 'equipment', value: true,  value_type: 'boolean', is_public: false },
  { key: 'coaches_can_edit_archer_equipment',  label: 'Coaches edit equipment',     description: "Allow coaches to edit linked archers' equipment.", category: 'equipment', value: false, value_type: 'boolean', is_public: false },
  { key: 'equipment_change_requires_approval', label: 'Equipment change needs approval', description: 'Equipment changes require approval.',          category: 'equipment', value: false, value_type: 'boolean', is_public: false },

  // Leaderboard & Reports
  { key: 'leaderboard_enabled',                     label: 'Leaderboard enabled',           description: 'Master switch for the leaderboard.',               category: 'leaderboard', value: true, value_type: 'boolean', is_public: true },
  { key: 'leaderboard_requires_validated_scores',   label: 'Leaderboard validated only',    description: 'Only validated scores appear on the leaderboard.', category: 'leaderboard', value: true, value_type: 'boolean', is_public: false },
  { key: 'leaderboard_show_school',                 label: 'Leaderboard shows school',      description: 'Show school column on the leaderboard.',           category: 'leaderboard', value: true, value_type: 'boolean', is_public: true },
  { key: 'leaderboard_show_state',                  label: 'Leaderboard shows state',       description: 'Show state column on the leaderboard.',            category: 'leaderboard', value: true, value_type: 'boolean', is_public: true },
  { key: 'leaderboard_show_pld',                    label: 'Leaderboard shows PLD',         description: 'Show PLD column on the leaderboard.',              category: 'leaderboard', value: true, value_type: 'boolean', is_public: true },
  { key: 'admin1_reports_scope_limited',            label: 'Admin 1 reports scope-limited', description: 'Limit Admin 1 reports to its assigned scope.',     category: 'leaderboard', value: true, value_type: 'boolean', is_public: false },
  { key: 'coach_reports_limited_to_linked_archers', label: 'Coach reports linked only',     description: 'Limit coach reports to linked archers only.',      category: 'leaderboard', value: true, value_type: 'boolean', is_public: false },

  // System
  { key: 'maintenance_mode',                label: 'Maintenance mode',        description: 'Put the app in maintenance mode for non-admin users.', category: 'system', value: false, value_type: 'boolean', is_public: true },
  { key: 'allow_new_registrations',         label: 'Allow new registrations', description: 'Allow new users to register.',                         category: 'system', value: true,  value_type: 'boolean', is_public: true },
  { key: 'show_beta_features',              label: 'Show beta features',      description: 'Expose beta / experimental features.',                 category: 'system', value: false, value_type: 'boolean', is_public: true },
  { key: 'enable_audit_log_export',         label: 'Enable audit log export', description: 'Allow exporting audit logs.',                          category: 'system', value: false, value_type: 'boolean', is_public: false },
  { key: 'strict_role_permissions_enabled', label: 'Strict role permissions', description: 'Enforce strict role permission checks everywhere.',    category: 'system', value: false, value_type: 'boolean', is_public: false },
]

const DEFAULTS_BY_KEY = new Map(DEFAULT_SYSTEM_RULES.map((r) => [r.key, r]))

export function getDefaultRule(key: string): SystemRuleSeed | undefined {
  return DEFAULTS_BY_KEY.get(key)
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────────

function currentActor(): { id: string | undefined; role: Role | undefined } {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

/** All mutations are super-admin only; RLS is the real guard, this fails fast. */
function assertCanManage(): void {
  assertCan(canManageSystemRules(currentActor().role), 'manage system rules')
}

// ─── READS ───────────────────────────────────────────────────────────────────────

export async function getSystemRules(): Promise<SystemRule[]> {
  const { data, error } = await supabase
    .from('system_rules')
    .select('*')
    .order('category', { ascending: true })
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as SystemRule[]
}

export async function getSystemRulesByCategory(category: string): Promise<SystemRule[]> {
  const { data, error } = await supabase
    .from('system_rules')
    .select('*')
    .eq('category', category)
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as SystemRule[]
}

/** Public feature flags — resilient: returns [] on any error so callers can fall back safely. */
export async function getPublicSystemRules(): Promise<SystemRule[]> {
  try {
    const { data, error } = await supabase
      .from('system_rules')
      .select('*')
      .eq('is_public', true)
    if (error) return []
    return (data ?? []) as SystemRule[]
  } catch {
    return []
  }
}

/** Read a single rule's value with a safe fallback (one-off check). */
export async function getRuleValue<T = SystemRuleValue>(key: string, fallback: T): Promise<T> {
  try {
    const { data, error } = await supabase
      .from('system_rules')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    if (error || !data || data.value === null || data.value === undefined) return fallback
    return data.value as T
  } catch {
    return fallback
  }
}

// ─── MUTATIONS (super admin only) ──────────────────────────────────────────────────

export type SystemRuleMeta = Partial<{
  label: string
  description: string
  category: string
  value_type: SystemRuleValueType
  is_public: boolean
  editable_by: string[]
}>

/**
 * Update a rule's value (and optionally its metadata).
 * `value` must already be the correct JS type for the rule (boolean / number /
 * string / object) — it is stored as jsonb as-is.
 */
export async function updateSystemRule(
  key: string,
  value: SystemRuleValue,
  meta?: SystemRuleMeta,
): Promise<SystemRule> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing } = await supabase
    .from('system_rules')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  const { data, error } = await supabase
    .from('system_rules')
    .update({ value, updated_by: actorId ?? null, ...meta })
    .eq('key', key)
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'system_rule.updated', 'system_rule', data.id, {
      key,
      old_value: existing?.value ?? null,
      new_value: value,
    })
    if (key === 'maintenance_mode') {
      await writeAuditLog(
        actorId,
        value ? 'system_rule.maintenance_enabled' : 'system_rule.maintenance_disabled',
        'system_rule',
        data.id,
        { key },
      )
    }
  }

  return data as SystemRule
}

export interface SystemRulePayload {
  key: string
  label: string
  description?: string
  category: string
  value: SystemRuleValue
  value_type: SystemRuleValueType
  is_public?: boolean
  editable_by?: string[]
}

export async function createSystemRule(payload: SystemRulePayload): Promise<SystemRule> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const row = {
    key:         payload.key,
    label:       payload.label,
    description: payload.description ?? null,
    category:    payload.category,
    value:       payload.value,
    value_type:  payload.value_type,
    is_public:   payload.is_public ?? false,
    editable_by: payload.editable_by ?? ['super_admin'],
    updated_by:  actorId ?? null,
  }

  const { data, error } = await supabase
    .from('system_rules')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'system_rule.created', 'system_rule', data.id, { key: payload.key })
  }
  return data as SystemRule
}

export async function deleteSystemRule(key: string): Promise<void> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing } = await supabase
    .from('system_rules')
    .select('id')
    .eq('key', key)
    .maybeSingle()

  const { error } = await supabase.from('system_rules').delete().eq('key', key)
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'system_rule.deleted', 'system_rule', existing?.id, { key })
  }
}

/**
 * Insert any default rules that are missing from the DB, without overwriting
 * existing (possibly customised) rules. Returns the keys that were inserted.
 */
export async function restoreMissingDefaultRules(): Promise<{ inserted: string[] }> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing, error } = await supabase.from('system_rules').select('key')
  if (error) throw error

  const existingKeys = new Set((existing ?? []).map((r) => r.key as string))
  const missing = DEFAULT_SYSTEM_RULES.filter((r) => !existingKeys.has(r.key))
  if (missing.length === 0) return { inserted: [] }

  const rows = missing.map((r) => ({
    key:         r.key,
    label:       r.label,
    description: r.description,
    category:    r.category,
    value:       r.value,
    value_type:  r.value_type,
    is_public:   r.is_public,
    editable_by: r.editable_by ?? ['super_admin'],
    updated_by:  actorId ?? null,
  }))

  const { error: insErr } = await supabase.from('system_rules').insert(rows)
  if (insErr) throw insErr

  const inserted = missing.map((m) => m.key)
  if (actorId) {
    await writeAuditLog(actorId, 'system_rule.restored_missing_defaults', 'system_rule', undefined, {
      inserted,
      count: inserted.length,
    })
  }
  return { inserted }
}

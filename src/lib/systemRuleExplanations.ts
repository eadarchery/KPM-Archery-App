/**
 * Frontend-only explanation metadata for system rules.
 *
 * Maps each known rule key to a plain-language explanation + risk level so the
 * System Rules page can show "what does this do / what happens if I change it".
 * No database changes — this enriches the existing rule (key/label/description/
 * category/value_type) at render time. Unknown keys get a safe generic fallback.
 *
 * The summary / whenEnabled / whenDisabled copy lives in the i18n dictionaries
 * under `sysRuleExpl.<ruleKey>.{summary,enabled,disabled}` (English + BM). This
 * file keeps only the structural metadata (affected roles/features + risk).
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

type Translate = (key: string, vars?: Record<string, string | number>) => string

export interface SystemRuleExplanation {
  summary: string
  whenEnabled: string
  whenDisabled: string
  affectedRoles: string[]    // role keys (archer/coach/admin1/admin2/super_admin)
  affectedFeatures: string[] // feature keys resolved via `sysRuleFeature.*`
  riskLevel: RiskLevel
}

interface RuleMeta {
  affectedRoles: string[]
  affectedFeatures: string[]
  riskLevel: RiskLevel
}

export const RISK_META: Record<
  RiskLevel,
  { labelKey: string; badge: 'neutral' | 'primary' | 'warning' | 'danger'; order: number }
> = {
  low:      { labelKey: 'sysRuleRisk.low',      badge: 'neutral', order: 0 },
  medium:   { labelKey: 'sysRuleRisk.medium',   badge: 'primary', order: 1 },
  high:     { labelKey: 'sysRuleRisk.high',     badge: 'warning', order: 2 },
  critical: { labelKey: 'sysRuleRisk.critical', badge: 'danger',  order: 3 },
}

/** A change is "risky" (needs a stronger confirmation) when high or critical. */
export function isRiskyLevel(level: RiskLevel): boolean {
  return level === 'high' || level === 'critical'
}

/** Structural metadata per known rule key. Text lives in i18n `sysRuleExpl.*`. */
export const SYSTEM_RULE_META: Record<string, RuleMeta> = {
  // ─── Modules ──────────────────────────────────────────────────────────────
  module_scores_enabled:        { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['scores', 'dashboard', 'leaderboard'], riskLevel: 'high' },
  module_achievements_enabled:  { affectedRoles: ['archer', 'coach', 'admin2'], affectedFeatures: ['achievements'], riskLevel: 'medium' },
  module_notifications_enabled: { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['notifications'], riskLevel: 'medium' },
  module_articles_enabled:      { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['articles'], riskLevel: 'medium' },
  module_equipment_enabled:     { affectedRoles: ['archer', 'coach'], affectedFeatures: ['equipment'], riskLevel: 'low' },
  module_reports_enabled:       { affectedRoles: ['coach', 'admin1', 'admin2'], affectedFeatures: ['reports'], riskLevel: 'medium' },
  module_leaderboard_enabled:   { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['leaderboard'], riskLevel: 'medium' },
  module_certifications_enabled:{ affectedRoles: ['coach', 'admin2'], affectedFeatures: ['certifications'], riskLevel: 'low' },

  // ─── Registration ─────────────────────────────────────────────────────────
  archer_registration_requires_approval: { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['registration', 'approvals'], riskLevel: 'medium' },
  coach_registration_requires_approval:  { affectedRoles: ['coach', 'admin1', 'admin2'], affectedFeatures: ['registration', 'approvals'], riskLevel: 'medium' },
  student_requires_school_approval:       { affectedRoles: ['archer', 'admin1'], affectedFeatures: ['registration', 'schools'], riskLevel: 'low' },
  coach_requires_admin_approval:          { affectedRoles: ['coach', 'admin1', 'admin2'], affectedFeatures: ['registration', 'approvals'], riskLevel: 'medium' },
  admin1_can_approve_archers:             { affectedRoles: ['admin1', 'archer'], affectedFeatures: ['approvals'], riskLevel: 'medium' },
  admin1_can_approve_coaches:             { affectedRoles: ['admin1', 'coach'], affectedFeatures: ['approvals'], riskLevel: 'medium' },
  admin2_can_approve_all_users:           { affectedRoles: ['admin2'], affectedFeatures: ['approvals', 'users'], riskLevel: 'medium' },

  // ─── Scores ───────────────────────────────────────────────────────────────
  archers_can_submit_training_scores:          { affectedRoles: ['archer', 'coach'], affectedFeatures: ['scores'], riskLevel: 'medium' },
  archers_can_submit_tournament_scores:        { affectedRoles: ['archer', 'coach'], affectedFeatures: ['scores'], riskLevel: 'medium' },
  coaches_can_submit_scores_for_archers:       { affectedRoles: ['coach', 'archer'], affectedFeatures: ['scores'], riskLevel: 'medium' },
  allow_score_edit_after_submission:           { affectedRoles: ['archer', 'coach'], affectedFeatures: ['scores'], riskLevel: 'medium' },
  score_edit_time_limit_hours:                 { affectedRoles: ['archer', 'coach'], affectedFeatures: ['scores'], riskLevel: 'low' },
  require_score_validation_before_leaderboard: { affectedRoles: ['archer', 'coach', 'admin2'], affectedFeatures: ['scores', 'leaderboard', 'validation'], riskLevel: 'high' },

  // ─── Validation ───────────────────────────────────────────────────────────
  coach_can_validate_training_scores:      { affectedRoles: ['coach', 'archer', 'admin1', 'admin2'], affectedFeatures: ['scores', 'validation', 'leaderboard'], riskLevel: 'medium' },
  coach_can_validate_tournament_scores:    { affectedRoles: ['coach', 'admin2', 'archer'], affectedFeatures: ['scores', 'validation', 'leaderboard'], riskLevel: 'high' },
  admin1_can_validate_training_scores:     { affectedRoles: ['admin1', 'archer'], affectedFeatures: ['scores', 'validation'], riskLevel: 'medium' },
  admin2_can_validate_tournament_scores:   { affectedRoles: ['admin2', 'archer'], affectedFeatures: ['scores', 'validation'], riskLevel: 'medium' },
  tournament_scores_require_proof:         { affectedRoles: ['archer', 'coach', 'admin2'], affectedFeatures: ['scores', 'validation'], riskLevel: 'medium' },
  tournament_scores_require_admin2_approval:{ affectedRoles: ['admin2', 'coach', 'archer'], affectedFeatures: ['scores', 'validation', 'leaderboard'], riskLevel: 'high' },
  rejected_scores_can_be_resubmitted:      { affectedRoles: ['archer', 'coach'], affectedFeatures: ['scores'], riskLevel: 'low' },

  // ─── Achievements ─────────────────────────────────────────────────────────
  achievements_auto_grant_enabled:              { affectedRoles: ['archer', 'admin2'], affectedFeatures: ['achievements'], riskLevel: 'medium' },
  achievements_show_locked_badges:              { affectedRoles: ['archer', 'coach'], affectedFeatures: ['achievements'], riskLevel: 'low' },
  achievements_show_progress:                   { affectedRoles: ['archer', 'coach'], affectedFeatures: ['achievements'], riskLevel: 'low' },
  achievement_badges_public_to_coach:           { affectedRoles: ['coach', 'archer'], affectedFeatures: ['achievements'], riskLevel: 'low' },
  achievement_badges_public_to_school_admin:    { affectedRoles: ['admin1', 'admin2'], affectedFeatures: ['achievements'], riskLevel: 'low' },

  // ─── Notifications ────────────────────────────────────────────────────────
  notifications_enabled:                  { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['notifications'], riskLevel: 'medium' },
  admin2_can_send_global_notifications:   { affectedRoles: ['admin2'], affectedFeatures: ['notifications'], riskLevel: 'medium' },
  admin1_can_send_scope_notifications:    { affectedRoles: ['admin1'], affectedFeatures: ['notifications'], riskLevel: 'low' },
  coaches_can_send_archer_notifications:  { affectedRoles: ['coach', 'archer'], affectedFeatures: ['notifications'], riskLevel: 'low' },
  urgent_notifications_enabled:           { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['notifications'], riskLevel: 'low' },

  // ─── Articles ─────────────────────────────────────────────────────────────
  articles_enabled:                       { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['articles'], riskLevel: 'medium' },
  admin2_can_publish_articles:            { affectedRoles: ['admin2'], affectedFeatures: ['articles'], riskLevel: 'medium' },
  admin1_can_create_articles:             { affectedRoles: ['admin1'], affectedFeatures: ['articles'], riskLevel: 'low' },
  coaches_can_submit_article_suggestions: { affectedRoles: ['coach'], affectedFeatures: ['articles'], riskLevel: 'low' },
  articles_require_review_before_publish: { affectedRoles: ['admin1', 'admin2'], affectedFeatures: ['articles'], riskLevel: 'low' },

  // ─── Equipment ────────────────────────────────────────────────────────────
  equipment_profiles_enabled:        { affectedRoles: ['archer', 'coach'], affectedFeatures: ['equipment'], riskLevel: 'low' },
  archers_can_edit_own_equipment:    { affectedRoles: ['archer'], affectedFeatures: ['equipment'], riskLevel: 'low' },
  coaches_can_view_archer_equipment: { affectedRoles: ['coach', 'archer'], affectedFeatures: ['equipment'], riskLevel: 'low' },
  coaches_can_edit_archer_equipment: { affectedRoles: ['coach', 'archer'], affectedFeatures: ['equipment'], riskLevel: 'medium' },
  equipment_change_requires_approval:{ affectedRoles: ['archer', 'coach', 'admin1'], affectedFeatures: ['equipment', 'approvals'], riskLevel: 'low' },

  // ─── Leaderboard & Reports ────────────────────────────────────────────────
  leaderboard_enabled:                       { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['leaderboard'], riskLevel: 'medium' },
  leaderboard_requires_validated_scores:     { affectedRoles: ['archer', 'coach', 'admin2'], affectedFeatures: ['leaderboard', 'scores', 'validation'], riskLevel: 'high' },
  leaderboard_show_school:                   { affectedRoles: ['archer', 'coach'], affectedFeatures: ['leaderboard'], riskLevel: 'low' },
  leaderboard_show_state:                    { affectedRoles: ['archer', 'coach'], affectedFeatures: ['leaderboard'], riskLevel: 'low' },
  leaderboard_show_pld:                      { affectedRoles: ['archer', 'coach'], affectedFeatures: ['leaderboard'], riskLevel: 'low' },
  admin1_reports_scope_limited:              { affectedRoles: ['admin1'], affectedFeatures: ['reports'], riskLevel: 'medium' },
  coach_reports_limited_to_linked_archers:   { affectedRoles: ['coach'], affectedFeatures: ['reports'], riskLevel: 'medium' },

  // ─── System ───────────────────────────────────────────────────────────────
  maintenance_mode:                { affectedRoles: ['archer', 'coach', 'admin1'], affectedFeatures: ['login', 'dashboard', 'appAccess'], riskLevel: 'critical' },
  allow_new_registrations:         { affectedRoles: ['archer', 'coach'], affectedFeatures: ['registration', 'login'], riskLevel: 'critical' },
  show_beta_features:              { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['app'], riskLevel: 'low' },
  enable_audit_log_export:         { affectedRoles: ['admin2', 'super_admin'], affectedFeatures: ['audit'], riskLevel: 'high' },
  strict_role_permissions_enabled: { affectedRoles: ['archer', 'coach', 'admin1', 'admin2'], affectedFeatures: ['permissions', 'appAccess'], riskLevel: 'critical' },
}

/**
 * Explanation for a rule — its known metadata + translated text if available,
 * otherwise a safe generic fallback built from the rule's own label/description.
 */
export function getRuleExplanation(
  t: Translate,
  rule: {
    key: string
    label: string
    description?: string
    category: string
    value_type: string
  },
): SystemRuleExplanation {
  const meta = SYSTEM_RULE_META[rule.key]
  if (meta) {
    return {
      summary:      t(`sysRuleExpl.${rule.key}.summary`),
      whenEnabled:  t(`sysRuleExpl.${rule.key}.enabled`),
      whenDisabled: t(`sysRuleExpl.${rule.key}.disabled`),
      affectedRoles: meta.affectedRoles,
      affectedFeatures: meta.affectedFeatures,
      riskLevel: meta.riskLevel,
    }
  }

  const isBool = rule.value_type === 'boolean'
  return {
    summary: rule.description?.trim() ? rule.description : t('sysRuleExpl.genericSummary'),
    whenEnabled: isBool ? t('sysRuleExpl.genericEnabledBool', { label: rule.label }) : t('sysRuleExpl.genericEnabledValue', { label: rule.label }),
    whenDisabled: isBool ? t('sysRuleExpl.genericDisabledBool', { label: rule.label }) : t('sysRuleExpl.genericDisabledValue'),
    affectedRoles: [],
    affectedFeatures: [],
    riskLevel: 'low',
  }
}

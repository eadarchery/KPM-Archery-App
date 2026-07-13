import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import { useAuthStore } from '@/store/authStore'
import { assertCan, canManageAppSettings } from '@/lib/permissions'
import type { Role, AppConfig, AppConfigValue, AppConfigValueType } from '@/types'

// ─── CATEGORIES ──────────────────────────────────────────────────────────────

export const APP_SETTING_CATEGORIES: { key: string; label: string; labelKey: string }[] = [
  { key: 'app_general',       label: 'General',       labelKey: 'appSettings.catGeneral' },
  { key: 'app_contact',       label: 'Contact',       labelKey: 'appSettings.catContact' },
  { key: 'app_registration',  label: 'Registration',  labelKey: 'appSettings.catRegistration' },
  { key: 'app_display',       label: 'Display',       labelKey: 'appSettings.catDisplay' },
  { key: 'app_notifications', label: 'Notifications', labelKey: 'appSettings.catNotifications' },
  { key: 'app_articles',      label: 'Articles',      labelKey: 'appSettings.catArticles' },
  { key: 'app_reports',       label: 'Reports',       labelKey: 'appSettings.catReports' },
  { key: 'app_advanced',      label: 'Advanced',      labelKey: 'appSettings.catAdvanced' },
]

// ─── DEFAULT CATALOG ─────────────────────────────────────────────────────────
// Mirror of the seed in supabase/migrations/026_app_settings.sql.
// Used for "restore missing defaults" and "reset to default". Keep in sync.

export interface AppConfigSeed {
  key: string
  label: string
  description: string
  category: string
  value: AppConfigValue
  value_type: AppConfigValueType
  is_public: boolean
}

export const DEFAULT_APP_SETTINGS: AppConfigSeed[] = [
  // General
  { key: 'app_display_name',    label: 'App display name',    description: 'Full name shown in headers and page titles.',                                             category: 'app_general',       value: 'EAD Archery Scene Monitor',                                                  value_type: 'string',  is_public: true },
  { key: 'app_short_name',      label: 'App short name',      description: 'Short name used in compact areas and mobile headers.',                                   category: 'app_general',       value: 'EAD ASM',                                                                    value_type: 'string',  is_public: true },
  { key: 'default_country',     label: 'Default country',     description: 'Default country for addresses and phone number formats.',                                category: 'app_general',       value: 'Malaysia',                                                                   value_type: 'string',  is_public: false },
  { key: 'default_timezone',    label: 'Default timezone',    description: 'Default timezone for date/time display. Changing this affects all date formatting.',     category: 'app_general',       value: 'Asia/Kuala_Lumpur',                                                          value_type: 'string',  is_public: false },
  { key: 'default_date_format', label: 'Date format',         description: 'Format for displaying dates (e.g. DD/MM/YYYY or YYYY-MM-DD).',                          category: 'app_general',       value: 'DD/MM/YYYY',                                                                 value_type: 'string',  is_public: true },
  { key: 'default_time_format', label: 'Time format',         description: 'Format for displaying times (e.g. HH:mm or hh:mm a).',                                 category: 'app_general',       value: 'HH:mm',                                                                      value_type: 'string',  is_public: false },
  // Contact
  { key: 'support_email',       label: 'Support email',       description: 'Email shown to users on help and pending-approval screens. Changing this updates the contact shown to new registrants.', category: 'app_contact', value: '', value_type: 'string', is_public: true },
  { key: 'support_phone',       label: 'Support phone',       description: 'Phone number shown on help and contact screens.',                                        category: 'app_contact',       value: '',                                                                           value_type: 'string',  is_public: true },
  { key: 'support_whatsapp',    label: 'Support WhatsApp',    description: 'WhatsApp number for user support. Shown on the pending-approval page.',                  category: 'app_contact',       value: '',                                                                           value_type: 'string',  is_public: true },
  { key: 'help_center_url',     label: 'Help centre URL',     description: 'Link to external help documentation or knowledge base.',                                 category: 'app_contact',       value: '',                                                                           value_type: 'string',  is_public: true },
  // Registration
  { key: 'registration_help_text',        label: 'Registration help text',   description: 'Shown at the top of the registration page. Changing this updates the onboarding message for all new users.',    category: 'app_registration', value: 'Register to join the EAD Archery Scene Monitor. An admin will review and approve your account.',   value_type: 'string', is_public: true },
  { key: 'coach_registration_help_text',  label: 'Coach registration help',  description: 'Extra help text shown during coach registration.',                                                              category: 'app_registration', value: 'Coaches must provide certification details. Accounts are reviewed before access is granted.',          value_type: 'string', is_public: true },
  { key: 'archer_registration_help_text', label: 'Archer registration help', description: 'Extra help text shown during archer registration.',                                                            category: 'app_registration', value: 'Archers must be linked to a school. Your account will be reviewed before access is granted.',          value_type: 'string', is_public: true },
  { key: 'approval_pending_message',      label: 'Approval pending message', description: 'Shown to users whose account is still pending. Changing this updates the holding message for all new registrants.', category: 'app_registration', value: 'Your account is pending review. You will be notified when it is approved.', value_type: 'string', is_public: true },
  // Display
  { key: 'default_page_size',            label: 'Default page size',         description: 'Default number of rows per page in list views. Affects all admin tables.',              category: 'app_display', value: 20,    value_type: 'number',  is_public: false },
  { key: 'default_dashboard_date_range', label: 'Dashboard date range',      description: 'Default date range on dashboards (1d, 1w, 1m, 3m, 6m, 1y, all).',                     category: 'app_display', value: '3m',  value_type: 'string',  is_public: false },
  { key: 'show_footer_text',             label: 'Show footer text',           description: 'Show the footer text at the bottom of the app.',                                       category: 'app_display', value: true,  value_type: 'boolean', is_public: true },
  { key: 'footer_text',                  label: 'Footer text',                description: 'Text shown in the app footer. Visible to all users.',                                  category: 'app_display', value: '© 2025 EAD Archery Scene Monitor. All rights reserved.', value_type: 'string', is_public: true },
  { key: 'show_beta_badge',              label: 'Show beta badge',            description: 'Show a beta indicator badge on experimental features.',                                category: 'app_display', value: false, value_type: 'boolean', is_public: true },
  // Notifications
  { key: 'notification_auto_mark_read',     label: 'Auto-mark notifications read',   description: 'Automatically mark notifications as read when viewed.',                        category: 'app_notifications', value: false,    value_type: 'boolean', is_public: false },
  { key: 'notification_default_priority',   label: 'Default notification priority',  description: 'Default priority for new notifications (low, normal, high, urgent).',         category: 'app_notifications', value: 'normal', value_type: 'string',  is_public: false },
  { key: 'notification_show_expired_days',  label: 'Show expired notifications (days)', description: 'How many days to keep showing expired notifications in the inbox.',         category: 'app_notifications', value: 7,        value_type: 'number',  is_public: false },
  // Articles
  { key: 'articles_default_sort',        label: 'Default article sort',        description: 'Default sort order for articles (newest, oldest, featured). Affects browsing order for all users.', category: 'app_articles', value: 'newest', value_type: 'string',  is_public: false },
  { key: 'articles_show_featured_first', label: 'Featured articles first',     description: 'Featured articles always appear at the top of article lists.',                                       category: 'app_articles', value: true,     value_type: 'boolean', is_public: false },
  { key: 'articles_cards_per_page',      label: 'Article cards per page',      description: 'Number of article cards per page. Changing this affects the browsing experience.',                  category: 'app_articles', value: 12,       value_type: 'number',  is_public: false },
  // Reports
  { key: 'reports_default_date_range',   label: 'Default report date range',   description: 'Default time window on report pages (1d, 1w, 1m, 3m, 6m, 1y, all).',               category: 'app_reports', value: '3m',   value_type: 'string',  is_public: false },
  { key: 'reports_default_grouping',     label: 'Default report grouping',     description: 'Default breakdown grouping for reports (state, pld, school).',                      category: 'app_reports', value: 'state', value_type: 'string',  is_public: false },
  { key: 'reports_show_export_button',   label: 'Show export button on reports', description: 'Show the CSV export button on report pages.',                                     category: 'app_reports', value: true,   value_type: 'boolean', is_public: false },
  // Advanced
  { key: 'session_inactivity_warning_minutes', label: 'Inactivity warning (minutes)', description: 'Show an inactivity warning after this many minutes. Display-only; does not force logout.', category: 'app_advanced', value: 30, value_type: 'number', is_public: false },
  { key: 'max_upload_size_mb',                 label: 'Max upload size (MB)',          description: 'Maximum allowed file upload size in megabytes.',                                            category: 'app_advanced', value: 10, value_type: 'number', is_public: false },
]

const DEFAULTS_BY_KEY = new Map(DEFAULT_APP_SETTINGS.map((r) => [r.key, r]))

export function getDefaultAppSetting(key: string): AppConfigSeed | undefined {
  return DEFAULTS_BY_KEY.get(key)
}

// ─── ACTOR HELPER ─────────────────────────────────────────────────────────────

function currentActor(): { id: string | undefined; role: Role | undefined } {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

function assertCanManage(): void {
  assertCan(canManageAppSettings(currentActor().role), 'manage app settings')
}

// ─── READS ────────────────────────────────────────────────────────────────────

export async function getAppSettings(): Promise<AppConfig[]> {
  const { data, error } = await supabase
    .from('app_config')
    .select('*')
    .order('category', { ascending: true })
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as AppConfig[]
}

export async function getAppSettingsByCategory(category: string): Promise<AppConfig[]> {
  const { data, error } = await supabase
    .from('app_config')
    .select('*')
    .eq('category', category)
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as AppConfig[]
}

/** Public settings — resilient: returns [] on error so callers fall back safely. */
export async function getPublicAppSettings(): Promise<AppConfig[]> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('*')
      .eq('is_public', true)
    if (error) return []
    return (data ?? []) as AppConfig[]
  } catch {
    return []
  }
}

/** Read a single setting's value with a safe fallback (one-off check). */
export async function getAppSettingValue<T = AppConfigValue>(key: string, fallback: T): Promise<T> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', key)
      .maybeSingle()
    if (error || !data || data.value === null || data.value === undefined) return fallback
    return data.value as T
  } catch {
    return fallback
  }
}

// ─── MUTATIONS (super admin only) ─────────────────────────────────────────────

export interface AppConfigMeta {
  label?: string
  description?: string
  category?: string
  value_type?: AppConfigValueType
  is_public?: boolean
}

export async function updateAppSetting(
  key: string,
  value: AppConfigValue,
  meta?: AppConfigMeta,
): Promise<AppConfig> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  const { data, error } = await supabase
    .from('app_config')
    .update({ value, updated_by: actorId ?? null, ...meta })
    .eq('key', key)
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'app_setting.updated', 'app_config', data.id, {
      key,
      old_value: existing?.value ?? null,
      new_value: value,
    })
  }
  return data as AppConfig
}

export interface AppConfigPayload {
  key: string
  label: string
  description?: string
  category: string
  value: AppConfigValue
  value_type: AppConfigValueType
  is_public?: boolean
}

export async function createAppSetting(payload: AppConfigPayload): Promise<AppConfig> {
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
    updated_by:  actorId ?? null,
  }

  const { data, error } = await supabase
    .from('app_config')
    .insert(row)
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'app_setting.created', 'app_config', data.id, { key: payload.key })
  }
  return data as AppConfig
}

export async function deleteAppSetting(key: string): Promise<void> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing } = await supabase
    .from('app_config')
    .select('id')
    .eq('key', key)
    .maybeSingle()

  const { error } = await supabase.from('app_config').delete().eq('key', key)
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'app_setting.deleted', 'app_config', existing?.id, { key })
  }
}

/**
 * Insert any default settings that are missing from the DB without overwriting
 * existing (possibly customised) values. Returns the keys inserted.
 */
export async function restoreMissingDefaultAppSettings(): Promise<{ inserted: string[] }> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing, error } = await supabase.from('app_config').select('key')
  if (error) throw error

  const existingKeys = new Set((existing ?? []).map((r) => r.key as string))
  const missing = DEFAULT_APP_SETTINGS.filter((r) => !existingKeys.has(r.key))
  if (missing.length === 0) return { inserted: [] }

  const rows = missing.map((r) => ({
    key:         r.key,
    label:       r.label,
    description: r.description,
    category:    r.category,
    value:       r.value,
    value_type:  r.value_type,
    is_public:   r.is_public,
    updated_by:  actorId ?? null,
  }))

  const { error: insErr } = await supabase.from('app_config').insert(rows)
  if (insErr) throw insErr

  const inserted = missing.map((m) => m.key)
  if (actorId) {
    await writeAuditLog(actorId, 'app_setting.restored_missing_defaults', 'app_config', undefined, {
      inserted,
      count: inserted.length,
    })
  }
  return { inserted }
}

import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import { useAuthStore } from '@/store/authStore'
import { assertCan, canManageBranding } from '@/lib/permissions'
import { compressImage, compressPresets } from '@/lib/imageCompress'
import type { Role, AppConfig, AppConfigValue } from '@/types'

// ─── ALLOWED UPLOAD TYPES ────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

// ─── BRANDING SETTING KEYS ───────────────────────────────────────────────────

export interface BrandingSeed {
  key: string
  label: string
  description: string
  value: AppConfigValue
  value_type: 'boolean' | 'string' | 'number' | 'json'
  is_public: boolean
}

export const BRANDING_DEFAULTS: BrandingSeed[] = [
  // Identity
  { key: 'brand_name',        label: 'Brand name',        description: 'Primary brand name displayed across public-facing pages.',                          value: 'EAD Archery Scene Monitor',                         value_type: 'string',  is_public: true  },
  { key: 'brand_short_name',  label: 'Brand short name',  description: 'Condensed name for mobile headers and compact UI areas.',                          value: 'EAD ASM',                                           value_type: 'string',  is_public: true  },
  { key: 'brand_tagline',     label: 'Tagline',           description: 'Short tagline shown on the login screen.',                                         value: "Bring archers' next step further.",                  value_type: 'string',  is_public: true  },
  { key: 'brand_footer_text', label: 'Footer text',       description: 'Text displayed in the app footer.',                                                value: '© 2025 EAD Archery Scene Monitor. All rights reserved.', value_type: 'string', is_public: true },
  // Logos
  { key: 'brand_logo_light',  label: 'Logo (light mode)', description: 'Logo on light backgrounds. PNG or WebP. Recommended: 200 × 60 px.',               value: '',                                                  value_type: 'string',  is_public: true  },
  { key: 'brand_logo_dark',   label: 'Logo (dark mode)',  description: 'Logo on dark backgrounds. PNG or WebP. Recommended: 200 × 60 px.',                value: '',                                                  value_type: 'string',  is_public: true  },
  { key: 'brand_icon',        label: 'App icon',          description: 'Square PWA home-screen icon. PNG or WebP. Recommended: 512 × 512 px.',             value: '',                                                  value_type: 'string',  is_public: true  },
  { key: 'brand_favicon',     label: 'Favicon',           description: 'Browser tab icon. Square PNG. Recommended: 64 × 64 px.',                          value: '',                                                  value_type: 'string',  is_public: true  },
  // Login page
  { key: 'brand_login_bg',         label: 'Login background',  description: 'Background image for the login page. PNG or WebP. Recommended: 1920 × 1080 px.', value: '', value_type: 'string', is_public: false },
  { key: 'brand_login_heading',    label: 'Login heading',     description: 'Main heading on the login page.',              value: 'Welcome to EAD Archery Scene Monitor', value_type: 'string', is_public: true  },
  { key: 'brand_login_subheading', label: 'Login subheading',  description: 'Secondary text below the login heading.',     value: 'Sign in to continue to your dashboard.', value_type: 'string', is_public: true },
  // Colors
  { key: 'brand_primary_color',   label: 'Primary color',   description: 'Main accent color for buttons and active states.',          value: '#E85D04', value_type: 'string', is_public: true  },
  { key: 'brand_secondary_color', label: 'Secondary color', description: 'Secondary UI color for hover states.',                      value: '#F48C06', value_type: 'string', is_public: true  },
  { key: 'brand_accent_color',    label: 'Accent color',    description: 'Highlight color for badges and call-to-action elements.',   value: '#FFBA08', value_type: 'string', is_public: true  },
  { key: 'brand_success_color',   label: 'Success color',   description: 'Color for success states and approved statuses.',          value: '#16a34a', value_type: 'string', is_public: true  },
  { key: 'brand_warning_color',   label: 'Warning color',   description: 'Color for warning states and pending indicators.',         value: '#d97706', value_type: 'string', is_public: true  },
  { key: 'brand_danger_color',    label: 'Danger color',    description: 'Color for error states and destructive actions.',          value: '#dc2626', value_type: 'string', is_public: true  },
  // Theme & display
  { key: 'brand_default_theme',    label: 'Default theme',          description: 'System-wide default theme (system, light, dark). Users may override.',   value: 'system', value_type: 'string',  is_public: true  },
  { key: 'brand_show_powered_by',  label: 'Show "Powered by" text', description: 'Show powered-by attribution in the footer.',                           value: false,    value_type: 'boolean', is_public: true  },
  { key: 'brand_powered_by_text',  label: '"Powered by" text',      description: 'Attribution text shown when "Show powered by" is enabled.',             value: 'Powered by EAD ASM', value_type: 'string', is_public: true },
  { key: 'brand_show_footer',      label: 'Show footer',            description: 'Show the footer bar at the bottom of the app.',                         value: true,     value_type: 'boolean', is_public: true  },
  { key: 'brand_show_tagline',     label: 'Show tagline',           description: 'Show the brand tagline on the login page.',                             value: true,     value_type: 'boolean', is_public: true  },
  // Social & contact
  { key: 'brand_website_url',    label: 'Website URL',      description: 'Official website URL shown in the footer.',             value: '', value_type: 'string', is_public: false },
  { key: 'brand_facebook_url',   label: 'Facebook URL',     description: 'Facebook page URL for social media links.',             value: '', value_type: 'string', is_public: false },
  { key: 'brand_instagram_url',  label: 'Instagram URL',    description: 'Instagram profile URL for social media links.',         value: '', value_type: 'string', is_public: false },
  { key: 'brand_tiktok_url',     label: 'TikTok URL',       description: 'TikTok profile URL for social media links.',            value: '', value_type: 'string', is_public: false },
  { key: 'brand_youtube_url',    label: 'YouTube URL',      description: 'YouTube channel URL for social media links.',           value: '', value_type: 'string', is_public: false },
  { key: 'brand_support_email',  label: 'Support email',    description: 'Support contact email shown to users.',                 value: '', value_type: 'string', is_public: false },
  { key: 'brand_support_whatsapp', label: 'Support WhatsApp', description: 'WhatsApp number for support. Include country code.', value: '', value_type: 'string', is_public: false },
]

const DEFAULTS_MAP = new Map(BRANDING_DEFAULTS.map((r) => [r.key, r]))

export function getDefaultBranding(key: string): BrandingSeed | undefined {
  return DEFAULTS_MAP.get(key)
}

// ─── ACTOR HELPER ─────────────────────────────────────────────────────────────

function currentActor(): { id: string | undefined; role: Role | undefined } {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

function assertCanManage(): void {
  assertCan(canManageBranding(currentActor().role), 'manage branding')
}

// ─── READS ────────────────────────────────────────────────────────────────────

/** All branding settings (Super Admin page). Errors surface. */
export async function getBrandingSettings(): Promise<AppConfig[]> {
  const { data, error } = await supabase
    .from('app_config')
    .select('*')
    .eq('category', 'branding')
    .order('label', { ascending: true })
  if (error) throw error
  return (data ?? []) as AppConfig[]
}

/** Public branding settings — resilient, returns [] on error. */
export async function getPublicBrandingSettings(): Promise<AppConfig[]> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('*')
      .eq('category', 'branding')
      .eq('is_public', true)
    if (error) return []
    return (data ?? []) as AppConfig[]
  } catch {
    return []
  }
}

/** Read a single branding value with a safe fallback. */
export async function getBrandingValue<T = AppConfigValue>(key: string, fallback: T): Promise<T> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', key)
      .eq('category', 'branding')
      .maybeSingle()
    if (error || !data || data.value === null || data.value === undefined) return fallback
    return data.value as T
  } catch {
    return fallback
  }
}

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

/** Update a single branding setting. Writes audit log. */
export async function updateBrandingSetting(key: string, value: AppConfigValue): Promise<AppConfig> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', key)
    .eq('category', 'branding')
    .maybeSingle()

  const { data, error } = await supabase
    .from('app_config')
    .update({ value, updated_by: actorId ?? null })
    .eq('key', key)
    .eq('category', 'branding')
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'branding.updated', 'app_config', data.id, {
      key,
      old_value: existing?.value ?? null,
      new_value: value,
    })
  }
  return data as AppConfig
}

/** Batch update multiple branding settings. Only saves entries present in the patch. */
export async function updateBrandingSettings(
  patch: Record<string, AppConfigValue>,
): Promise<void> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const keys = Object.keys(patch)
  if (keys.length === 0) return

  for (const key of keys) {
    const { data: existing } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', key)
      .eq('category', 'branding')
      .maybeSingle()

    const { data, error } = await supabase
      .from('app_config')
      .update({ value: patch[key], updated_by: actorId ?? null })
      .eq('key', key)
      .eq('category', 'branding')
      .select('id')
      .single()
    if (error) throw error

    if (actorId) {
      await writeAuditLog(actorId, 'branding.updated', 'app_config', data.id, {
        key,
        old_value: existing?.value ?? null,
        new_value: patch[key],
      })
    }
  }
}

// ─── ASSET UPLOAD ─────────────────────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase()
}

/**
 * Upload a branding asset to the 'branding' storage bucket.
 * Returns the public URL of the uploaded file.
 * Throws on invalid file type, oversized file, or upload error.
 */
export async function uploadBrandingAsset(
  file: File,
  folder: 'logos' | 'favicons' | 'login' | 'backgrounds',
): Promise<string> {
  assertCanManage()

  if (!ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error('Invalid file type. Only PNG, JPG, and WebP images are allowed.')
  }

  // Auto-compress before the size gate: logos/favicons cap at 1024px (alpha
  // preserved as PNG), login/background photos at 1920px.
  const upload = await compressImage(
    file,
    folder === 'login' || folder === 'backgrounds'
      ? compressPresets.brandingBackground
      : compressPresets.brandingAsset,
  )
  if (upload.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File is too large. Maximum upload size is 5 MB.')
  }

  const ext = upload.name.split('.').pop() ?? 'png'
  const path = `${folder}/${Date.now()}-${sanitizeFilename(upload.name.replace(/\.[^.]+$/, ''))}.${ext}`

  const { error: uploadErr } = await supabase.storage
    .from('branding')
    .upload(path, upload, { upsert: false, contentType: upload.type })

  if (uploadErr) throw new Error(`Upload failed: ${uploadErr.message}`)

  const { data } = supabase.storage.from('branding').getPublicUrl(path)

  const { id: actorId } = currentActor()
  if (actorId) {
    await writeAuditLog(actorId, 'branding.asset_uploaded', 'app_config', undefined, {
      folder,
      path,
      filename: upload.name,
      size_bytes: upload.size,       // what was actually stored (post-compression)
      original_bytes: file.size,
      mime_type: upload.type,
    })
  }

  return data.publicUrl
}

/**
 * Remove a branding asset from storage and clear its setting value.
 * Extracts the storage path from the public URL.
 */
export async function removeBrandingAsset(
  publicUrl: string,
  settingKey: string,
): Promise<void> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const match = publicUrl.match(/\/storage\/v1\/object\/public\/branding\/(.+)$/)
  const storagePath = match ? match[1] : null

  if (storagePath) {
    const { error } = await supabase.storage.from('branding').remove([storagePath])
    if (error) throw new Error(`Could not remove asset: ${error.message}`)
  }

  // Clear the setting value
  const { data } = await supabase
    .from('app_config')
    .update({ value: '', updated_by: actorId ?? null })
    .eq('key', settingKey)
    .eq('category', 'branding')
    .select('id')
    .maybeSingle()

  if (actorId) {
    await writeAuditLog(actorId, 'branding.asset_removed', 'app_config', data?.id, {
      key: settingKey,
      removed_path: storagePath ?? publicUrl,
    })
  }
}

// ─── RESTORE DEFAULTS ─────────────────────────────────────────────────────────

/** Insert any missing branding defaults. Never overwrites customised values. */
export async function restoreDefaultBranding(): Promise<{ inserted: string[] }> {
  assertCanManage()
  const { id: actorId } = currentActor()

  const { data: existing, error } = await supabase
    .from('app_config')
    .select('key')
    .eq('category', 'branding')
  if (error) throw error

  const existingKeys = new Set((existing ?? []).map((r) => r.key as string))
  const missing = BRANDING_DEFAULTS.filter((r) => !existingKeys.has(r.key))
  if (missing.length === 0) return { inserted: [] }

  const rows = missing.map((r) => ({
    key:         r.key,
    label:       r.label,
    description: r.description,
    category:    'branding',
    value:       r.value,
    value_type:  r.value_type,
    is_public:   r.is_public,
    updated_by:  actorId ?? null,
  }))

  const { error: insErr } = await supabase.from('app_config').insert(rows)
  if (insErr) throw insErr

  const inserted = missing.map((m) => m.key)
  if (actorId) {
    await writeAuditLog(actorId, 'branding.reset_to_default', 'app_config', undefined, {
      inserted,
      count: inserted.length,
    })
  }
  return { inserted }
}

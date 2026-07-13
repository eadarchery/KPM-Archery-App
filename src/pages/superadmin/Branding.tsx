import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button, Badge, ConfirmDialog, Input, Textarea,
  StatCard, EmptyState, useToast,
} from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useBranding } from '@/hooks/useBranding'
import { canManageBranding } from '@/lib/permissions'
import {
  updateBrandingSetting,
  updateBrandingSettings,
  uploadBrandingAsset,
  removeBrandingAsset,
  restoreDefaultBranding,
} from '@/services/branding'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { AppConfig, AppConfigValue } from '@/types'

// ─── FORM STATE ──────────────────────────────────────────────────────────────

interface BrandingForm {
  brand_name: string
  brand_short_name: string
  brand_tagline: string
  brand_footer_text: string
  brand_logo_light: string
  brand_logo_dark: string
  brand_icon: string
  brand_favicon: string
  brand_login_bg: string
  brand_login_heading: string
  brand_login_subheading: string
  brand_primary_color: string
  brand_secondary_color: string
  brand_accent_color: string
  brand_success_color: string
  brand_warning_color: string
  brand_danger_color: string
  brand_default_theme: string
  brand_show_powered_by: boolean
  brand_powered_by_text: string
  brand_show_footer: boolean
  brand_show_tagline: boolean
  brand_website_url: string
  brand_facebook_url: string
  brand_instagram_url: string
  brand_tiktok_url: string
  brand_youtube_url: string
  brand_support_email: string
  brand_support_whatsapp: string
}

const DEFAULT_FORM: BrandingForm = {
  brand_name: 'EAD Archery Scene Monitor',
  brand_short_name: 'EAD ASM',
  brand_tagline: "Bring archers' next step further.",
  brand_footer_text: '© 2025 EAD Archery Scene Monitor. All rights reserved.',
  brand_logo_light: '',
  brand_logo_dark: '',
  brand_icon: '',
  brand_favicon: '',
  brand_login_bg: '',
  brand_login_heading: 'Welcome to EAD Archery Scene Monitor',
  brand_login_subheading: 'Sign in to continue to your dashboard.',
  brand_primary_color: '#E85D04',
  brand_secondary_color: '#F48C06',
  brand_accent_color: '#FFBA08',
  brand_success_color: '#16a34a',
  brand_warning_color: '#d97706',
  brand_danger_color: '#dc2626',
  brand_default_theme: 'system',
  brand_show_powered_by: false,
  brand_powered_by_text: 'Powered by EAD ASM',
  brand_show_footer: true,
  brand_show_tagline: true,
  brand_website_url: '',
  brand_facebook_url: '',
  brand_instagram_url: '',
  brand_tiktok_url: '',
  brand_youtube_url: '',
  brand_support_email: '',
  brand_support_whatsapp: '',
}

function settingsToForm(settings: AppConfig[]): BrandingForm {
  const map = new Map(settings.map((s) => [s.key, s.value]))
  const str = (key: keyof BrandingForm): string => {
    const v = map.get(key)
    return v !== undefined && v !== null ? String(v) : DEFAULT_FORM[key] as string
  }
  const bool = (key: keyof BrandingForm): boolean => {
    const v = map.get(key)
    return v !== undefined && v !== null ? Boolean(v) : DEFAULT_FORM[key] as boolean
  }
  return {
    brand_name:              str('brand_name'),
    brand_short_name:        str('brand_short_name'),
    brand_tagline:           str('brand_tagline'),
    brand_footer_text:       str('brand_footer_text'),
    brand_logo_light:        str('brand_logo_light'),
    brand_logo_dark:         str('brand_logo_dark'),
    brand_icon:              str('brand_icon'),
    brand_favicon:           str('brand_favicon'),
    brand_login_bg:          str('brand_login_bg'),
    brand_login_heading:     str('brand_login_heading'),
    brand_login_subheading:  str('brand_login_subheading'),
    brand_primary_color:     str('brand_primary_color'),
    brand_secondary_color:   str('brand_secondary_color'),
    brand_accent_color:      str('brand_accent_color'),
    brand_success_color:     str('brand_success_color'),
    brand_warning_color:     str('brand_warning_color'),
    brand_danger_color:      str('brand_danger_color'),
    brand_default_theme:     str('brand_default_theme'),
    brand_show_powered_by:   bool('brand_show_powered_by'),
    brand_powered_by_text:   str('brand_powered_by_text'),
    brand_show_footer:       bool('brand_show_footer'),
    brand_show_tagline:      bool('brand_show_tagline'),
    brand_website_url:       str('brand_website_url'),
    brand_facebook_url:      str('brand_facebook_url'),
    brand_instagram_url:     str('brand_instagram_url'),
    brand_tiktok_url:        str('brand_tiktok_url'),
    brand_youtube_url:       str('brand_youtube_url'),
    brand_support_email:     str('brand_support_email'),
    brand_support_whatsapp:  str('brand_support_whatsapp'),
  }
}

function formToPatch(
  form: BrandingForm,
  saved: BrandingForm,
): Record<string, AppConfigValue> {
  const patch: Record<string, AppConfigValue> = {}
  const ASSET_KEYS = new Set(['brand_logo_light', 'brand_logo_dark', 'brand_icon', 'brand_favicon', 'brand_login_bg'])
  for (const k of Object.keys(form) as (keyof BrandingForm)[]) {
    if (ASSET_KEYS.has(k)) continue // assets save immediately on upload
    if (form[k] !== saved[k]) {
      patch[k] = form[k] as AppConfigValue
    }
  }
  return patch
}

// ─── SECTIONS ────────────────────────────────────────────────────────────────

type Translate = (key: string, vars?: Record<string, string | number>) => string

const SECTIONS = [
  { key: 'identity', labelKey: 'branding.secIdentity' },
  { key: 'logos',    labelKey: 'branding.secLogos'    },
  { key: 'login',    labelKey: 'branding.secLogin'    },
  { key: 'colors',   labelKey: 'branding.secColors'   },
  { key: 'display',  labelKey: 'branding.secDisplay'  },
  { key: 'social',   labelKey: 'branding.secSocial'   },
  { key: 'preview',  labelKey: 'common.preview'       },
]

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isValidHex(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(v)
}

function isValidUrl(v: string): boolean {
  if (!v) return true
  try { return ['http:', 'https:'].includes(new URL(v).protocol) } catch { return false }
}

function isValidEmail(v: string): boolean {
  if (!v) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

// ─── TOGGLE ──────────────────────────────────────────────────────────────────

function Toggle({
  checked, onChange, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200',
        checked ? 'bg-primary' : 'bg-line-strong',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span className={cn(
        'inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform duration-200',
        checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
      )} />
    </button>
  )
}

// ─── COLOR FIELD ─────────────────────────────────────────────────────────────

function ColorField({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  const { t } = useLanguage()
  const valid = isValidHex(value)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold text-text-dim">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-10 cursor-pointer rounded border border-line bg-surface p-0.5"
          title={t('branding.pickColor')}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          maxLength={7}
          className={cn(
            'field flex-1 font-mono text-sm',
            value && !valid && 'border-danger focus:border-danger',
          )}
        />
        {value && !valid && (
          <span className="text-[11px] text-danger font-medium whitespace-nowrap">{t('branding.invalidHex')}</span>
        )}
      </div>
    </div>
  )
}

// ─── ASSET UPLOAD CARD ───────────────────────────────────────────────────────

interface AssetUploadCardProps {
  label: string
  value: string
  helperText: string
  folder: 'logos' | 'favicons' | 'login' | 'backgrounds'
  accept?: string
  aspectRatio?: string
  settingKey: string
  busy: boolean
  onUploaded: (url: string) => void
  onRemove: () => void
}

function AssetUploadCard({
  label, value, helperText,
  folder, accept = 'image/png,image/jpeg,image/webp',
  aspectRatio = '16/9', settingKey, busy,
  onUploaded, onRemove,
}: AssetUploadCardProps) {
  const { t } = useLanguage()
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { ok, err } = useToast()

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadBrandingAsset(file, folder)
      await updateBrandingSetting(settingKey, url)
      onUploaded(url)
      ok(t('branding.assetUploaded', { label }))
    } catch (error) {
      err(t('common.actionFailed'), error instanceof Error ? error.message : undefined)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleRemove() {
    if (!value) return
    setUploading(true)
    try {
      await removeBrandingAsset(value, settingKey)
      onRemove()
      ok(t('branding.assetRemoved', { label }))
    } catch (error) {
      err(t('common.actionFailed'), error instanceof Error ? error.message : undefined)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-[var(--r)] border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="text-[12px] font-semibold text-text-dim">{label}</div>

      {value ? (
        <div
          className="relative w-full overflow-hidden rounded bg-base border border-line"
          style={{ aspectRatio }}
        >
          <img src={value} alt={label} className="h-full w-full object-contain" />
        </div>
      ) : (
        <div
          className="flex items-center justify-center rounded border-2 border-dashed border-line bg-base"
          style={{ aspectRatio, minHeight: '80px' }}
        >
          <span className="text-xs text-text-faint">{t('branding.noImageUploaded')}</span>
        </div>
      )}

      <p className="text-[11px] text-text-faint leading-relaxed">{helperText}</p>

      <div className="flex gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={handleFile}
        />
        <Button
          variant="ghost"
          size="sm"
          loading={uploading}
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {value ? t('branding.replace') : t('branding.upload')}
        </Button>
        {value && (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || uploading}
            onClick={handleRemove}
            className="text-danger hover:text-danger"
          >
            {t('common.remove')}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── SECTION: IDENTITY ────────────────────────────────────────────────────────

function IdentitySection({
  form, onChange,
}: { form: BrandingForm; onChange: (patch: Partial<BrandingForm>) => void }) {
  const { t } = useLanguage()
  return (
    <SectionCard title={t('branding.secIdentity')}>
      <div className="space-y-4">
        <p className="text-sm text-text-dim">{t('branding.identityDesc')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={t('branding.appName')}
            value={form.brand_name}
            onChange={(e) => onChange({ brand_name: e.target.value })}
            placeholder="EAD Archery Scene Monitor"
            hint={t('branding.appNameHint')}
          />
          <Input
            label={t('branding.shortName')}
            value={form.brand_short_name}
            onChange={(e) => onChange({ brand_short_name: e.target.value })}
            placeholder="EAD ASM"
            hint={t('branding.shortNameHint')}
          />
        </div>
        <Input
          label={t('branding.tagline')}
          value={form.brand_tagline}
          onChange={(e) => onChange({ brand_tagline: e.target.value })}
          placeholder="Bring archers' next step further."
          hint={t('branding.taglineHint')}
        />
        <Textarea
          label={t('branding.footerText')}
          value={form.brand_footer_text}
          onChange={(e) => onChange({ brand_footer_text: e.target.value })}
          minRows={2}
          placeholder="© 2025 EAD Archery Scene Monitor. All rights reserved."
          hint={t('branding.footerTextHint')}
        />
      </div>
    </SectionCard>
  )
}

// ─── SECTION: LOGOS ───────────────────────────────────────────────────────────

function LogosSection({
  form, busy, onChange,
}: { form: BrandingForm; busy: boolean; onChange: (patch: Partial<BrandingForm>) => void }) {
  const { t } = useLanguage()
  return (
    <SectionCard title={t('branding.secLogos')}>
      <div className="space-y-4">
        <p className="text-sm text-text-dim">
          {t('branding.logosDesc')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <AssetUploadCard
            label={t('branding.lightLogo')}
            value={form.brand_logo_light}
            helperText={t('branding.logoHelper')}
            folder="logos"
            settingKey="brand_logo_light"
            busy={busy}
            aspectRatio="10/3"
            onUploaded={(url) => onChange({ brand_logo_light: url })}
            onRemove={() => onChange({ brand_logo_light: '' })}
          />
          <AssetUploadCard
            label={t('branding.darkLogo')}
            value={form.brand_logo_dark}
            helperText={t('branding.logoHelper')}
            folder="logos"
            settingKey="brand_logo_dark"
            busy={busy}
            aspectRatio="10/3"
            onUploaded={(url) => onChange({ brand_logo_dark: url })}
            onRemove={() => onChange({ brand_logo_dark: '' })}
          />
          <AssetUploadCard
            label={t('branding.appIcon')}
            value={form.brand_icon}
            helperText={t('branding.appIconHelper')}
            folder="logos"
            settingKey="brand_icon"
            busy={busy}
            aspectRatio="1/1"
            onUploaded={(url) => onChange({ brand_icon: url })}
            onRemove={() => onChange({ brand_icon: '' })}
          />
          <AssetUploadCard
            label={t('branding.favicon')}
            value={form.brand_favicon}
            helperText={t('branding.faviconHelper')}
            folder="favicons"
            accept="image/png"
            settingKey="brand_favicon"
            busy={busy}
            aspectRatio="1/1"
            onUploaded={(url) => onChange({ brand_favicon: url })}
            onRemove={() => onChange({ brand_favicon: '' })}
          />
        </div>
      </div>
    </SectionCard>
  )
}

// ─── SECTION: LOGIN PAGE ─────────────────────────────────────────────────────

function LoginSection({
  form, busy, onChange,
}: { form: BrandingForm; busy: boolean; onChange: (patch: Partial<BrandingForm>) => void }) {
  const { t } = useLanguage()
  return (
    <SectionCard title={t('branding.secLogin')}>
      <div className="space-y-4">
        <p className="text-sm text-text-dim">
          {t('branding.loginDesc')}
        </p>
        <Input
          label={t('branding.loginHeading')}
          value={form.brand_login_heading}
          onChange={(e) => onChange({ brand_login_heading: e.target.value })}
          placeholder="Welcome to EAD Archery Scene Monitor"
        />
        <Input
          label={t('branding.loginSubheading')}
          value={form.brand_login_subheading}
          onChange={(e) => onChange({ brand_login_subheading: e.target.value })}
          placeholder="Sign in to continue to your dashboard."
        />
        <AssetUploadCard
          label={t('branding.loginBg')}
          value={form.brand_login_bg}
          helperText={t('branding.loginBgHelper')}
          folder="login"
          settingKey="brand_login_bg"
          busy={busy}
          aspectRatio="16/9"
          onUploaded={(url) => onChange({ brand_login_bg: url })}
          onRemove={() => onChange({ brand_login_bg: '' })}
        />
      </div>
    </SectionCard>
  )
}

// ─── SECTION: COLORS ─────────────────────────────────────────────────────────

function ColorsSection({
  form, onChange,
}: { form: BrandingForm; onChange: (patch: Partial<BrandingForm>) => void }) {
  const { t } = useLanguage()
  const colors: Array<{ key: keyof BrandingForm; label: string }> = [
    { key: 'brand_primary_color',   label: t('branding.primaryColor')   },
    { key: 'brand_secondary_color', label: t('branding.secondaryColor') },
    { key: 'brand_accent_color',    label: t('branding.accentColor')    },
    { key: 'brand_success_color',   label: t('branding.successColor')   },
    { key: 'brand_warning_color',   label: t('branding.warningColor')   },
    { key: 'brand_danger_color',    label: t('branding.dangerColor')    },
  ]

  return (
    <SectionCard title={t('branding.secColors')}>
      <div className="space-y-4">
        <p className="text-sm text-text-dim">
          {t('branding.colorsDesc')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {colors.map(({ key, label }) => (
            <ColorField
              key={key}
              label={label}
              value={form[key] as string}
              onChange={(v) => onChange({ [key]: v } as Partial<BrandingForm>)}
            />
          ))}
        </div>
      </div>
    </SectionCard>
  )
}

// ─── SECTION: DISPLAY ────────────────────────────────────────────────────────

function DisplaySection({
  form, onChange,
}: { form: BrandingForm; onChange: (patch: Partial<BrandingForm>) => void }) {
  const { t } = useLanguage()
  return (
    <SectionCard title={t('branding.secDisplay')}>
      <div className="space-y-4">
        <p className="text-sm text-text-dim">
          {t('branding.displayDesc')}
        </p>

        <div>
          <label className="text-[12px] font-semibold text-text-dim block mb-1.5">{t('branding.defaultTheme')}</label>
          <select
            className="field text-sm"
            value={form.brand_default_theme}
            onChange={(e) => onChange({ brand_default_theme: e.target.value })}
          >
            <option value="system">{t('branding.themeSystem')}</option>
            <option value="light">{t('branding.themeLight')}</option>
            <option value="dark">{t('branding.themeDark')}</option>
          </select>
          <p className="text-[11px] text-text-faint mt-1">
            {t('branding.defaultThemeHint')}
          </p>
        </div>

        <div className="flex flex-col gap-4 pt-1">
          <label className="flex items-start gap-3 cursor-pointer">
            <Toggle
              checked={form.brand_show_footer}
              onChange={(v) => onChange({ brand_show_footer: v })}
            />
            <div>
              <span className="text-sm font-medium text-text">{t('branding.showFooter')}</span>
              <p className="text-[11px] text-text-faint mt-0.5">{t('branding.showFooterHint')}</p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <Toggle
              checked={form.brand_show_tagline}
              onChange={(v) => onChange({ brand_show_tagline: v })}
            />
            <div>
              <span className="text-sm font-medium text-text">{t('branding.showTagline')}</span>
              <p className="text-[11px] text-text-faint mt-0.5">{t('branding.showTaglineHint')}</p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer">
            <Toggle
              checked={form.brand_show_powered_by}
              onChange={(v) => onChange({ brand_show_powered_by: v })}
            />
            <div>
              <span className="text-sm font-medium text-text">{t('branding.showPoweredBy')}</span>
              <p className="text-[11px] text-text-faint mt-0.5">{t('branding.showPoweredByHint')}</p>
            </div>
          </label>

          {form.brand_show_powered_by && (
            <Input
              label={t('branding.poweredByText')}
              value={form.brand_powered_by_text}
              onChange={(e) => onChange({ brand_powered_by_text: e.target.value })}
              placeholder="Powered by EAD ASM"
            />
          )}
        </div>
      </div>
    </SectionCard>
  )
}

// ─── SECTION: SOCIAL & CONTACT ────────────────────────────────────────────────

function SocialSection({
  form, onChange,
}: { form: BrandingForm; onChange: (patch: Partial<BrandingForm>) => void }) {
  const { t } = useLanguage()
  const urlFields: Array<{ key: keyof BrandingForm; label: string; placeholder: string }> = [
    { key: 'brand_website_url',   label: t('branding.websiteUrl'),   placeholder: 'https://example.com'       },
    { key: 'brand_facebook_url',  label: t('branding.facebookUrl'),  placeholder: 'https://facebook.com/...'  },
    { key: 'brand_instagram_url', label: t('branding.instagramUrl'), placeholder: 'https://instagram.com/...' },
    { key: 'brand_tiktok_url',    label: t('branding.tiktokUrl'),    placeholder: 'https://tiktok.com/...'    },
    { key: 'brand_youtube_url',   label: t('branding.youtubeUrl'),   placeholder: 'https://youtube.com/...'   },
  ]

  return (
    <SectionCard title={t('branding.secSocial')}>
      <div className="space-y-4">
        <p className="text-sm text-text-dim">
          {t('branding.socialDesc')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {urlFields.map(({ key, label, placeholder }) => {
            const val = form[key] as string
            return (
              <Input
                key={key}
                label={label}
                value={val}
                onChange={(e) => onChange({ [key]: e.target.value } as Partial<BrandingForm>)}
                placeholder={placeholder}
                error={val && !isValidUrl(val) ? t('branding.invalidUrl') : undefined}
              />
            )
          })}
          <Input
            label={t('branding.supportEmail')}
            value={form.brand_support_email}
            onChange={(e) => onChange({ brand_support_email: e.target.value })}
            placeholder="support@example.com"
            error={form.brand_support_email && !isValidEmail(form.brand_support_email) ? t('branding.invalidEmail') : undefined}
          />
          <Input
            label={t('branding.supportWhatsapp')}
            value={form.brand_support_whatsapp}
            onChange={(e) => onChange({ brand_support_whatsapp: e.target.value })}
            placeholder="+60123456789"
            hint={t('branding.includeCountryCode')}
          />
        </div>
      </div>
    </SectionCard>
  )
}

// ─── SECTION: PREVIEW ────────────────────────────────────────────────────────

function PreviewSection({ form }: { form: BrandingForm }) {
  const { t } = useLanguage()
  const hasPrimary = isValidHex(form.brand_primary_color)
  const primaryBg = hasPrimary ? form.brand_primary_color : '#E85D04'

  return (
    <div className="space-y-4">
      {/* Header preview */}
      <SectionCard title={t('branding.headerPreview')}>
        <div className="rounded-[var(--r)] border border-line overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b border-line bg-surface">
            {form.brand_logo_light ? (
              <img
                src={form.brand_logo_light}
                alt="logo preview"
                className="h-8 max-w-[120px] object-contain"
              />
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className="h-8 w-8 rounded flex items-center justify-center text-white text-xs font-bold"
                  style={{ background: primaryBg }}
                >
                  {(form.brand_short_name || 'A')[0]}
                </div>
                <span className="font-display font-semibold text-sm text-text">
                  {form.brand_short_name || 'App'}
                </span>
              </div>
            )}
          </div>
          <div className="px-4 py-2 bg-base flex items-center gap-3 text-xs text-text-faint">
            <span className="text-text">{t('nav.dashboard')}</span>
            <span>{t('common.scores')}</span>
            <span>{t('nav.profile')}</span>
          </div>
        </div>
      </SectionCard>

      {/* Login page preview */}
      <SectionCard title={t('branding.loginPreview')}>
        <div
          className="rounded-[var(--r)] overflow-hidden border border-line relative"
          style={{ minHeight: '220px' }}
        >
          {form.brand_login_bg && (
            <img
              src={form.brand_login_bg}
              alt="login background"
              className="absolute inset-0 w-full h-full object-cover opacity-20"
            />
          )}
          <div className="relative flex flex-col items-center justify-center p-8 text-center gap-2">
            {form.brand_logo_light && (
              <img
                src={form.brand_logo_light}
                alt="logo"
                className="h-10 max-w-[160px] object-contain mb-2"
              />
            )}
            <h2 className="font-display font-bold text-lg text-text leading-tight">
              {form.brand_login_heading || t('branding.welcome')}
            </h2>
            {form.brand_show_tagline && form.brand_tagline && (
              <p className="text-sm text-text-dim italic">{form.brand_tagline}</p>
            )}
            <p className="text-sm text-text-dim mt-1">
              {form.brand_login_subheading}
            </p>
            <div
              className="mt-3 px-6 py-2 rounded-full text-sm font-semibold text-white"
              style={{ background: primaryBg }}
            >
              {t('branding.signIn')}
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Color palette */}
      <SectionCard title={t('branding.colorPalette')}>
        <div className="flex flex-wrap gap-4">
          {([
            ['brand_primary_color',   t('branding.primary')],
            ['brand_secondary_color', t('branding.secondary')],
            ['brand_accent_color',    t('branding.accent')],
            ['brand_success_color',   t('branding.success')],
            ['brand_warning_color',   t('branding.warning')],
            ['brand_danger_color',    t('branding.danger')],
          ] as [keyof BrandingForm, string][]).map(([key, label]) => {
            const value = form[key] as string
            const valid = isValidHex(value)
            return (
              <div key={key} className="flex flex-col items-center gap-1.5">
                <div
                  className="h-10 w-10 rounded-full border border-line shadow-sm"
                  style={{ background: valid ? value : '#e5e7eb' }}
                  title={value}
                />
                <span className="text-[10px] font-medium text-text-faint">{label}</span>
                <span className="text-[10px] font-mono text-text-dim">{value || '—'}</span>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* Footer preview */}
      <SectionCard title={t('branding.footerPreview')}>
        {form.brand_show_footer ? (
          <div className="rounded-[var(--r)] border border-line bg-base px-4 py-3">
            <p className="text-xs text-text-faint text-center">
              {form.brand_footer_text || '—'}
            </p>
            {form.brand_show_powered_by && form.brand_powered_by_text && (
              <p className="text-[10px] text-text-faint text-center mt-0.5">
                {form.brand_powered_by_text}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-text-faint">{t('branding.footerHidden')}</p>
        )}
      </SectionCard>
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function SuperAdminBranding() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const role = profile?.role

  const qc = useQueryClient()
  const { ok, err } = useToast()
  const { data: settings = [], isLoading, error } = useBranding()

  const [form, setForm] = useState<BrandingForm>(DEFAULT_FORM)
  const [savedForm, setSavedForm] = useState<BrandingForm>(DEFAULT_FORM)
  const [activeSection, setActiveSection] = useState<string>('identity')
  const [resetOpen, setResetOpen] = useState(false)

  // Sync form from loaded settings
  useEffect(() => {
    if (settings.length > 0) {
      const f = settingsToForm(settings)
      setForm(f)
      setSavedForm(f)
    }
  }, [settings])

  const onChange = useCallback((patch: Partial<BrandingForm>) => {
    setForm((prev) => ({ ...prev, ...patch }))
  }, [])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['branding'] })

  const isDirty = useMemo(
    () => (Object.keys(form) as (keyof BrandingForm)[]).some((k) => form[k] !== savedForm[k]),
    [form, savedForm],
  )

  const saveMut = useMutation({
    mutationFn: () => updateBrandingSettings(formToPatch(form, savedForm)),
    onSuccess: () => {
      invalidate()
      setSavedForm(form)
      ok(t('branding.brandingSaved'))
    },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })

  const resetMut = useMutation({
    mutationFn: () => restoreDefaultBranding(),
    onSuccess: (res) => {
      invalidate()
      setResetOpen(false)
      ok(res.inserted.length
        ? t('branding.restoredCount', { count: res.inserted.length })
        : t('branding.allDefaultsPresent'))
    },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })

  const busy = saveMut.isPending || resetMut.isPending

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const get = (key: string) => settings.find((s) => s.key === key)?.value
    const last = settings.reduce<AppConfig | null>(
      (acc, s) => (!acc || s.updated_at > acc.updated_at ? s : acc), null,
    )
    return {
      name:       String(get('brand_name') ?? t('branding.notSet')),
      theme:      String(get('brand_default_theme') ?? 'system'),
      hasLogo:    Boolean(get('brand_logo_light') || get('brand_logo_dark')),
      hasFavicon: Boolean(get('brand_favicon')),
      hasLoginBg: Boolean(get('brand_login_bg')),
      last,
    }
  }, [settings])

  // ── Access guard ──────────────────────────────────────────────────────────
  if (!canManageBranding(role)) {
    return <AccessDenied message={t('branding.accessDenied')} />
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const isAssetSection = activeSection === 'logos' || activeSection === 'login'

  return (
    <PageWrapper>
      <PageHead
        title={t('branding.title')}
        description={t('branding.description')}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setResetOpen(true)}
              disabled={busy}
            >
              {t('sysRules.restoreDefaults')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saveMut.isPending}
              disabled={!isDirty || busy}
              onClick={() => saveMut.mutate()}
            >
              {isDirty ? t('common.saveChanges') : t('branding.saved')}
            </Button>
          </div>
        }
      />

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard
          label={t('branding.appName')}
          value={<span className="text-sm font-semibold leading-tight block truncate">{stats.name}</span>}
        />
        <StatCard
          label={t('branding.theme')}
          value={<span className="text-sm font-semibold capitalize">{stats.theme}</span>}
        />
        <StatCard
          label={t('branding.logo')}
          value={
            <Badge variant={stats.hasLogo ? 'success' : 'neutral'}>
              {stats.hasLogo ? t('branding.uploaded') : t('common.none')}
            </Badge>
          }
        />
        <StatCard
          label={t('branding.favicon')}
          value={
            <Badge variant={stats.hasFavicon ? 'success' : 'neutral'}>
              {stats.hasFavicon ? t('branding.uploaded') : t('common.none')}
            </Badge>
          }
        />
        <StatCard
          label={t('branding.loginBgShort')}
          value={
            <Badge variant={stats.hasLoginBg ? 'success' : 'neutral'}>
              {stats.hasLoginBg ? t('branding.uploaded') : t('common.none')}
            </Badge>
          }
        />
        <StatCard
          label={t('sysRules.lastUpdated')}
          value={
            <span className="text-sm leading-tight block truncate">
              {stats.last?.label ?? '—'}
            </span>
          }
          sub={stats.last ? formatDate(stats.last.updated_at) : undefined}
        />
      </div>

      {/* ── Unsaved changes banner ── */}
      {isDirty && !isAssetSection && (
        <div className="mb-4 flex items-center gap-3 rounded-[var(--r)] border border-line bg-section px-4 py-2.5">
          <span className="text-sm text-text-dim flex-1">{t('branding.unsavedChanges')}</span>
          <button
            type="button"
            className="text-xs font-semibold text-text-dim hover:text-text"
            onClick={() => setForm(savedForm)}
          >
            {t('branding.discard')}
          </button>
          <Button
            variant="primary"
            size="sm"
            loading={saveMut.isPending}
            onClick={() => saveMut.mutate()}
          >
            {t('branding.saveNow')}
          </Button>
        </div>
      )}

      {/* ── Section tabs ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-5 -mx-1 px-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActiveSection(s.key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border',
              activeSection === s.key
                ? 'bg-primary text-primary-on border-primary'
                : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
            )}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      {/* ── Section content ── */}
      {isLoading ? (
        <div className="py-20 text-center text-text-faint text-sm">{t('branding.loading')}</div>
      ) : error ? (
        <SectionCard>
          <EmptyState
            title={t('branding.loadError')}
            description={t('branding.loadErrorHint')}
          />
        </SectionCard>
      ) : (
        <div className="pb-4">
          {activeSection === 'identity' && <IdentitySection form={form} onChange={onChange} />}
          {activeSection === 'logos'    && <LogosSection    form={form} busy={busy} onChange={onChange} />}
          {activeSection === 'login'    && <LoginSection    form={form} busy={busy} onChange={onChange} />}
          {activeSection === 'colors'   && <ColorsSection   form={form} onChange={onChange} />}
          {activeSection === 'display'  && <DisplaySection  form={form} onChange={onChange} />}
          {activeSection === 'social'   && <SocialSection   form={form} onChange={onChange} />}
          {activeSection === 'preview'  && <PreviewSection  form={form} />}

          {/* Save/Discard row below non-asset sections */}
          {isDirty && !isAssetSection && activeSection !== 'preview' && (
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setForm(savedForm)} disabled={busy}>
                {t('branding.discardChanges')}
              </Button>
              <Button variant="primary" loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
                {t('common.saveChanges')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ── Restore defaults confirm ── */}
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => resetMut.mutate()}
        title={t('branding.restoreMissingTitle')}
        message={t('branding.restoreMissingMessage')}
        confirmLabel={t('sysRules.restoreDefaults')}
        loading={resetMut.isPending}
      />
    </PageWrapper>
  )
}

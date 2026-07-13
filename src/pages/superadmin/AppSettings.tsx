import { useState, useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button, Badge, Modal, ConfirmDialog, Input, Textarea, Select,
  StatCard, EmptyState, useToast,
} from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useAppSettings } from '@/hooks/useAppSettings'
import { canManageAppSettings } from '@/lib/permissions'
import {
  APP_SETTING_CATEGORIES, DEFAULT_APP_SETTINGS, getDefaultAppSetting,
  updateAppSetting, createAppSetting, deleteAppSetting, restoreMissingDefaultAppSettings,
  type AppConfigMeta, type AppConfigPayload,
} from '@/services/appSettings'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { AppConfig, AppConfigValue, AppConfigValueType } from '@/types'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const VALUE_TYPES: AppConfigValueType[] = ['string', 'number', 'boolean', 'json']

type Translate = (key: string, vars?: Record<string, string | number>) => string

const catLabel = (t: Translate, key: string) => {
  const cat = APP_SETTING_CATEGORIES.find((c) => c.key === key)
  return cat ? t(cat.labelKey) : key
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function valueToDisplay(t: Translate, s: Pick<AppConfig, 'value' | 'value_type'>): string {
  if (s.value_type === 'boolean') return s.value ? t('sysRules.on') : t('sysRules.off')
  if (s.value_type === 'json')    return JSON.stringify(s.value)
  const str = String(s.value ?? '')
  return str.length > 80 ? str.slice(0, 77) + '…' : str
}

function sameValue(a: AppConfigValue, b: AppConfigValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function coerceValue(
  t: Translate,
  type: AppConfigValueType,
  boolDraft: boolean,
  textDraft: string,
): { ok: true; value: AppConfigValue } | { ok: false; error: string } {
  if (type === 'boolean') return { ok: true, value: boolDraft }
  if (type === 'number') {
    const n = Number(textDraft)
    if (textDraft.trim() === '' || Number.isNaN(n)) return { ok: false, error: t('sysRules.enterValidNumber') }
    return { ok: true, value: n }
  }
  if (type === 'json') {
    try { return { ok: true, value: JSON.parse(textDraft) as AppConfigValue } }
    catch { return { ok: false, error: t('appSettings.invalidJson') } }
  }
  return { ok: true, value: textDraft }
}

function isLongText(setting: AppConfig): boolean {
  return setting.value_type === 'string' && String(setting.value ?? '').length > 60
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

// ─── SETTING CARD ─────────────────────────────────────────────────────────────

function SettingCard({
  setting, busy, onToggle, onEdit,
}: {
  setting: AppConfig
  busy: boolean
  onToggle: (next: boolean) => void
  onEdit: () => void
}) {
  const { t } = useLanguage()
  const def = getDefaultAppSetting(setting.key)
  const isCustom = !def
  const isModified = def && !sameValue(def.value, setting.value)

  return (
    <div className="rounded-[var(--r)] border border-line bg-surface p-4 flex flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-semibold text-sm text-text">{setting.label}</h3>
            {isCustom && (
              <Badge variant="primary" className="text-[9px]">{t('appSettings.custom')}</Badge>
            )}
            {isModified && (
              <Badge variant="warning" className="text-[9px]">{t('appSettings.modified')}</Badge>
            )}
          </div>
          <code className="text-[11px] text-text-faint break-all">{setting.key}</code>
        </div>

        {setting.value_type === 'boolean' ? (
          <Toggle
            checked={setting.value === true}
            disabled={busy}
            onChange={onToggle}
          />
        ) : (
          <span className="text-sm font-semibold text-text text-right max-w-[140px] truncate" title={String(setting.value ?? '')}>
            {valueToDisplay(t, setting)}
          </span>
        )}
      </div>

      {setting.description && (
        <p className="text-xs text-text-dim leading-relaxed">{setting.description}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="neutral" className="text-[9px]">{catLabel(t, setting.category)}</Badge>
        <Badge variant="neutral" className="text-[9px]">{setting.value_type}</Badge>
        <Badge variant={setting.is_public ? 'primary' : 'neutral'} className="text-[9px]">
          {setting.is_public ? t('appSettings.public') : t('appSettings.private')}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-line">
        <span className="text-[10.5px] text-text-faint">
          {t('statesPage.updatedOn')} {formatDate(setting.updated_at)}
        </span>
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
        >
          {t('common.edit')}
        </button>
      </div>
    </div>
  )
}

// ─── EDIT MODAL ──────────────────────────────────────────────────────────────

function EditSettingModal({
  setting, saving, onClose, onSave, onDelete,
}: {
  setting: AppConfig
  saving: boolean
  onClose: () => void
  onSave: (value: AppConfigValue, meta: AppConfigMeta) => void
  onDelete?: () => void
}) {
  const { t } = useLanguage()
  const [label, setLabel] = useState(setting.label)
  const [description, setDescription] = useState(setting.description ?? '')
  const [category, setCategory] = useState(setting.category)
  const [valueType, setValueType] = useState<AppConfigValueType>(setting.value_type)
  const [isPublic, setIsPublic] = useState(setting.is_public)
  const [boolDraft, setBoolDraft] = useState(setting.value === true)
  const [textDraft, setTextDraft] = useState(
    setting.value_type === 'json'
      ? JSON.stringify(setting.value, null, 2)
      : String(setting.value ?? ''),
  )
  const [error, setError] = useState('')

  const isCustom = !getDefaultAppSetting(setting.key)
  const useLongText = valueType === 'string' && (textDraft.length > 60 || isLongText(setting))

  function submit() {
    setError('')
    if (!label.trim()) { setError(t('sysRules.labelRequired')); return }
    const coerced = coerceValue(t, valueType, boolDraft, textDraft)
    if (!coerced.ok) { setError(coerced.error); return }
    onSave(coerced.value, {
      label: label.trim(),
      description: description.trim() || undefined,
      category,
      value_type: valueType,
      is_public: isPublic,
    })
  }

  return (
    <Modal open onClose={onClose} title={t('appSettings.editSetting')} width="min(560px,100%)">
      <div className="space-y-4">
        <div>
          <label className="text-[12px] font-semibold text-text-dim block mb-1">{t('sysRules.key')}</label>
          <code className="text-xs text-text-faint break-all">{setting.key}</code>
          <p className="text-[11px] text-text-faint mt-0.5">{t('sysRules.keysCannotChange')}</p>
        </div>

        <Input label={t('sysRules.label')} value={label} onChange={(e) => setLabel(e.target.value)} />

        <Textarea
          label={t('common.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          minRows={2}
          placeholder={t('appSettings.descPlaceholder')}
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('adminArticles.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={APP_SETTING_CATEGORIES.map((c) => ({ value: c.key, label: t(c.labelKey) }))}
          />
          <Select
            label={t('appSettings.dataType')}
            value={valueType}
            onChange={(e) => {
              setValueType(e.target.value as AppConfigValueType)
              setTextDraft('')
              setBoolDraft(false)
            }}
            options={VALUE_TYPES.map((vt) => ({ value: vt, label: vt }))}
          />
        </div>

        {/* Value editor */}
        <div>
          <label className="text-[12px] font-semibold text-text-dim block mb-1.5">{t('sysRules.value')}</label>
          {valueType === 'boolean' ? (
            <div className="flex items-center gap-2">
              <Toggle checked={boolDraft} onChange={setBoolDraft} />
              <span className="text-sm text-text-dim">{boolDraft ? t('sysRules.onTrue') : t('sysRules.offFalse')}</span>
            </div>
          ) : valueType === 'number' ? (
            <Input type="number" value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />
          ) : valueType === 'json' ? (
            <Textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              minRows={4}
              className="font-mono text-xs"
              placeholder='{ "example": true }'
            />
          ) : useLongText ? (
            <Textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              minRows={2}
            />
          ) : (
            <Input value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />
          )}
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={isPublic} onChange={setIsPublic} />
          <span className="text-sm text-text-dim">
            {t('appSettings.publicSetting')} <span className="text-text-faint">{t('appSettings.readableByApproved')}</span>
          </span>
        </label>

        {error && <p className="text-xs text-danger font-medium">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {isCustom && onDelete ? (
            <Button variant="danger" size="sm" onClick={onDelete} disabled={saving}>
              {t('appSettings.deleteSetting')}
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button variant="primary" loading={saving} onClick={submit}>{t('common.saveChanges')}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── CREATE MODAL ─────────────────────────────────────────────────────────────

function CreateSettingModal({
  existingKeys, saving, onClose, onCreate,
}: {
  existingKeys: Set<string>
  saving: boolean
  onClose: () => void
  onCreate: (payload: AppConfigPayload) => void
}) {
  const { t } = useLanguage()
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(APP_SETTING_CATEGORIES[0].key)
  const [valueType, setValueType] = useState<AppConfigValueType>('string')
  const [isPublic, setIsPublic] = useState(false)
  const [boolDraft, setBoolDraft] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [error, setError] = useState('')

  function submit() {
    setError('')
    const k = key.trim().toLowerCase()
    if (!k) { setError(t('sysRules.keyRequired')); return }
    if (!/^[a-z][a-z0-9_]*$/.test(k)) {
      setError(t('appSettings.keyFormat'))
      return
    }
    if (existingKeys.has(k)) { setError(t('appSettings.keyExists')); return }
    if (!label.trim()) { setError(t('sysRules.labelRequired')); return }
    const coerced = coerceValue(t, valueType, boolDraft, textDraft)
    if (!coerced.ok) { setError(coerced.error); return }

    onCreate({
      key: k,
      label: label.trim(),
      description: description.trim() || undefined,
      category,
      value: coerced.value,
      value_type: valueType,
      is_public: isPublic,
    })
  }

  const useLongText = valueType === 'string' && textDraft.length > 60

  return (
    <Modal open onClose={onClose} title={t('appSettings.createCustomSetting')} width="min(560px,100%)">
      <div className="space-y-4">
        <Input
          label={t('sysRules.key')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. my_custom_setting"
          hint={t('appSettings.keyHint')}
        />
        <Input
          label={t('sysRules.label')}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('sysRules.humanReadableName')}
        />
        <Textarea
          label={t('common.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          minRows={2}
          placeholder={t('appSettings.createDescPlaceholder')}
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('adminArticles.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={APP_SETTING_CATEGORIES.map((c) => ({ value: c.key, label: t(c.labelKey) }))}
          />
          <Select
            label={t('appSettings.dataType')}
            value={valueType}
            onChange={(e) => {
              setValueType(e.target.value as AppConfigValueType)
              setTextDraft('')
              setBoolDraft(false)
            }}
            options={VALUE_TYPES.map((vt) => ({ value: vt, label: vt }))}
          />
        </div>

        <div>
          <label className="text-[12px] font-semibold text-text-dim block mb-1.5">{t('sysRules.value')}</label>
          {valueType === 'boolean' ? (
            <div className="flex items-center gap-2">
              <Toggle checked={boolDraft} onChange={setBoolDraft} />
              <span className="text-sm text-text-dim">{boolDraft ? t('sysRules.onTrue') : t('sysRules.offFalse')}</span>
            </div>
          ) : valueType === 'number' ? (
            <Input type="number" value={textDraft} onChange={(e) => setTextDraft(e.target.value)} placeholder="0" />
          ) : valueType === 'json' ? (
            <Textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              minRows={4}
              className="font-mono text-xs"
              placeholder='{ "example": true }'
            />
          ) : useLongText ? (
            <Textarea value={textDraft} onChange={(e) => setTextDraft(e.target.value)} minRows={2} />
          ) : (
            <Input value={textDraft} onChange={(e) => setTextDraft(e.target.value)} placeholder="value" />
          )}
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={isPublic} onChange={setIsPublic} />
          <span className="text-sm text-text-dim">
            {t('appSettings.publicSetting')} <span className="text-text-faint">{t('appSettings.readableByApproved')}</span>
          </span>
        </label>

        {error && <p className="text-xs text-danger font-medium">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{t('appSettings.createSetting')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function SuperAdminAppSettings() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const role = profile?.role

  const qc = useQueryClient()
  const { ok, err } = useToast()
  const { data: settings = [], isLoading, error } = useAppSettings()

  const [activeCat, setActiveCat] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [visFilter, setVisFilter] = useState<string>('all')

  const [editSetting, setEditSetting] = useState<AppConfig | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [deleteKey, setDeleteKey] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['app-config'] })

  const updateMut = useMutation({
    mutationFn: (v: { key: string; value: AppConfigValue; meta?: AppConfigMeta }) =>
      updateAppSetting(v.key, v.value, v.meta),
    onSuccess: () => { invalidate(); ok(t('appSettings.settingUpdated')) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const createMut = useMutation({
    mutationFn: (p: AppConfigPayload) => createAppSetting(p),
    onSuccess: () => { invalidate(); ok(t('appSettings.settingCreated')); setCreateOpen(false) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const deleteMut = useMutation({
    mutationFn: (key: string) => deleteAppSetting(key),
    onSuccess: () => { invalidate(); ok(t('appSettings.settingDeleted')); setDeleteKey(null); setEditSetting(null) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const restoreMut = useMutation({
    mutationFn: () => restoreMissingDefaultAppSettings(),
    onSuccess: (res) => {
      invalidate()
      setRestoreOpen(false)
      ok(res.inserted.length
        ? t('appSettings.restoredCount', { count: res.inserted.length })
        : t('appSettings.allDefaultsPresent'))
    },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })

  const busy = updateMut.isPending || createMut.isPending || deleteMut.isPending

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const appSettings = settings.filter((s) => s.category !== 'branding')
    const publicCount = appSettings.filter((s) => s.is_public).length
    const last = appSettings.reduce<AppConfig | null>(
      (acc, s) => (!acc || s.updated_at > acc.updated_at ? s : acc), null,
    )
    const catCounts: Record<string, number> = {}
    for (const s of appSettings) {
      catCounts[s.category] = (catCounts[s.category] ?? 0) + 1
    }
    return {
      total:    appSettings.length,
      publicCount,
      private:  appSettings.length - publicCount,
      general:  catCounts['app_general'] ?? 0,
      display:  catCounts['app_display'] ?? 0,
      last,
    }
  }, [settings])

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return settings.filter((s) => {
      if (s.category === 'branding') return false // managed by /super-admin/branding
      if (activeCat !== 'all' && s.category !== activeCat) return false
      if (typeFilter !== 'all' && s.value_type !== typeFilter) return false
      if (visFilter === 'public' && !s.is_public) return false
      if (visFilter === 'private' && s.is_public) return false
      if (q && !(
        s.key.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q)
      )) return false
      return true
    })
  }, [settings, activeCat, typeFilter, visFilter, search])

  const existingKeys = useMemo(() => new Set(settings.map((s) => s.key)), [settings])

  // ── Access guard ────────────────────────────────────────────────────────────
  if (!canManageAppSettings(role)) {
    return <AccessDenied message={t('appSettings.accessDenied')} />
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <PageWrapper>
      <PageHead
        title={t('appSettings.title')}
        description={t('appSettings.description')}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRestoreOpen(true)}>
              {t('sysRules.restoreDefaults')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              {t('appSettings.newSetting')}
            </Button>
          </div>
        }
      />

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard label={t('appSettings.totalSettings')}  value={stats.total} />
        <StatCard label={t('appSettings.publicSettings')} value={stats.publicCount} />
        <StatCard label={t('appSettings.private')}         value={stats.private} />
        <StatCard label={t('appSettings.catGeneral')}         value={stats.general} />
        <StatCard label={t('appSettings.catDisplay')}         value={stats.display} />
        <StatCard
          label={t('sysRules.lastUpdated')}
          value={<span className="text-sm leading-tight block truncate">{stats.last?.label ?? '—'}</span>}
          sub={stats.last ? formatDate(stats.last.updated_at) : undefined}
        />
      </div>

      {/* ── Category tabs ── */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {[{ key: 'all', labelKey: 'common.all' }, ...APP_SETTING_CATEGORIES.map(c => ({ key: c.key, labelKey: c.labelKey }))].map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActiveCat(c.key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border',
              activeCat === c.key
                ? 'bg-primary text-primary-on border-primary'
                : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
            )}
          >
            {t(c.labelKey)}
          </button>
        ))}
      </div>

      {/* ── Search + filters ── */}
      <div className="flex flex-wrap gap-2 mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('sysRules.searchPlaceholder')}
          className="field flex-1 min-w-[180px] text-sm"
        />
        <select className="field text-sm py-2" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">{t('appSettings.allDataTypes')}</option>
          {VALUE_TYPES.map((vt) => <option key={vt} value={vt}>{vt}</option>)}
        </select>
        <select className="field text-sm py-2" value={visFilter} onChange={(e) => setVisFilter(e.target.value)}>
          <option value="all">{t('sysRules.publicAndPrivate')}</option>
          <option value="public">{t('sysRules.publicOnly')}</option>
          <option value="private">{t('sysRules.privateOnly')}</option>
        </select>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <div className="py-20 text-center text-text-faint text-sm">{t('appSettings.loading')}</div>
      ) : error ? (
        <SectionCard>
          <EmptyState
            title={t('appSettings.loadError')}
            description={t('appSettings.loadErrorHint')}
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title={t('appSettings.noMatch')}
            description={
              settings.length === 0
                ? t('appSettings.noneFound')
                : t('sysRules.noMatchFilters')
            }
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
          {filtered.map((s) => (
            <SettingCard
              key={s.id}
              setting={s}
              busy={busy}
              onToggle={(next) => updateMut.mutate({ key: s.key, value: next })}
              onEdit={() => setEditSetting(s)}
            />
          ))}
        </div>
      )}

      {/* ── Edit modal ── */}
      {editSetting && (
        <EditSettingModal
          setting={editSetting}
          saving={updateMut.isPending || deleteMut.isPending}
          onClose={() => setEditSetting(null)}
          onSave={(value, meta) =>
            updateMut.mutate(
              { key: editSetting.key, value, meta },
              { onSuccess: () => setEditSetting(null) },
            )
          }
          onDelete={!getDefaultAppSetting(editSetting.key) ? () => setDeleteKey(editSetting.key) : undefined}
        />
      )}

      {/* ── Create modal ── */}
      {createOpen && (
        <CreateSettingModal
          existingKeys={existingKeys}
          saving={createMut.isPending}
          onClose={() => setCreateOpen(false)}
          onCreate={(p) => createMut.mutate(p)}
        />
      )}

      {/* ── Restore defaults confirm ── */}
      <ConfirmDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onConfirm={() => restoreMut.mutate()}
        title={t('appSettings.restoreMissingTitle')}
        message={t('appSettings.restoreMissingMessage')}
        confirmLabel={t('sysRules.restoreDefaults')}
        loading={restoreMut.isPending}
      />

      {/* ── Delete custom setting confirm ── */}
      <ConfirmDialog
        open={!!deleteKey}
        onClose={() => setDeleteKey(null)}
        onConfirm={() => deleteKey && deleteMut.mutate(deleteKey)}
        title={t('appSettings.deleteSetting')}
        message={t('appSettings.deleteMessage')}
        confirmLabel={t('common.delete')}
        destructive
        loading={deleteMut.isPending}
      />
    </PageWrapper>
  )
}

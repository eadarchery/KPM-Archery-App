import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button, Badge, Modal, ConfirmDialog, Input, Textarea, Select,
  StatCard, EmptyState, useToast, HelpTip,
} from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useLanguage } from '@/contexts/LanguageContext'
import { useAuth } from '@/hooks/useAuth'
import { useRolePermissions } from '@/hooks/useRolePermissions'
import { canManageRolePermissions } from '@/lib/permissions'
import {
  ROLE_PERMISSION_CATEGORIES, ASSIGNABLE_ROLES, DANGEROUS_PERMISSION_KEYS,
  updateRolePermission, createRolePermission, bulkUpdateRolePermissions,
  resetRolePermissionsToDefault, restoreMissingDefaultRolePermissions,
  type RolePermissionPayload,
} from '@/services/rolePermissions'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { Role, RolePermission } from '@/types'

// ─── HELPERS ────────────────────────────────────────────────────────────────────

type Translate = (key: string, vars?: Record<string, string | number>) => string

const catLabel = (t: Translate, key: string) => {
  const cat = ROLE_PERMISSION_CATEGORIES.find((c) => c.key === key)
  return cat ? t(cat.labelKey) : key
}

// Keys of permission → i18n key for the "impact" note shown on sensitive toggles.
const IMPACT_NOTE_KEYS: Record<string, string> = {
  manage_system_rules: 'rolePermissions.impactSystemRules',
  manage_role_permissions: 'rolePermissions.impactRolePerms',
  manage_super_admin_users: 'rolePermissions.impactSuperAdmin',
  delete_users: 'rolePermissions.impactDeleteUsers',
  delete_school: 'rolePermissions.impactDeleteSchool',
  delete_pld: 'rolePermissions.impactDeletePld',
  delete_state: 'rolePermissions.impactDeleteState',
  enable_maintenance_mode: 'rolePermissions.impactEnableMaint',
  disable_maintenance_mode: 'rolePermissions.impactDisableMaint',
  view_audit_logs: 'rolePermissions.impactViewAudit',
  export_audit_logs: 'rolePermissions.impactExportAudit',
}

// ─── TOGGLE SWITCH ──────────────────────────────────────────────────────────────

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
      <span
        className={cn(
          'inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

// ─── PERMISSION CARD ──────────────────────────────────────────────────────────────

function PermissionCard({
  perm, busy, onToggle,
}: {
  perm: RolePermission
  busy: boolean
  onToggle: (next: boolean) => void
}) {
  const { t } = useLanguage()
  const dangerous = DANGEROUS_PERMISSION_KEYS.has(perm.permission_key)
  return (
    <div className="rounded-[var(--r)] border border-line bg-surface p-4 flex flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-semibold text-sm text-text">{perm.label}</h3>
            {dangerous && <Badge variant="warning" className="text-[9px]">{t('rolePermissions.sensitive')}</Badge>}
            {perm.locked && <Badge variant="neutral" className="text-[9px]">🔒 {t('rolePermissions.locked')}</Badge>}
          </div>
          <code className="text-[11px] text-text-faint break-all">{perm.permission_key}</code>
        </div>
        <Toggle checked={perm.enabled} disabled={busy || perm.locked} onChange={onToggle} />
      </div>

      {perm.description && (
        <p className="text-xs text-text-dim leading-relaxed">{perm.description}</p>
      )}

      {perm.locked && perm.locked_reason && (
        <p className="text-[11px] text-text-faint italic">{perm.locked_reason}</p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-line">
        <Badge variant="neutral" className="text-[9px]">{catLabel(t, perm.category)}</Badge>
        <span className="text-[10.5px] text-text-faint">{t('statesPage.updatedOn')} {formatDate(perm.updated_at)}</span>
      </div>
    </div>
  )
}

// ─── DANGEROUS-CHANGE CONFIRM ─────────────────────────────────────────────────────

function DangerConfirm({
  perm, next, saving, onClose, onConfirm,
}: {
  perm: RolePermission
  next: boolean
  saving: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useLanguage()
  return (
    <Modal open onClose={onClose} title={t('rolePermissions.confirmSensitive')} width="min(440px,100%)">
      <p className="text-sm text-text-dim leading-relaxed">
        {t('rolePermissions.sensitiveIntro')}
      </p>
      <div className="mt-4 rounded-[var(--r)] border border-line bg-section p-3 space-y-2 text-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="primary">{t(`roles.${perm.role}`)}</Badge>
          <span className="font-semibold text-text">{perm.label}</span>
        </div>
        <code className="text-[11px] text-text-faint break-all">{perm.permission_key}</code>
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="neutral">{perm.enabled ? t('common.enabled') : t('common.disabled')}</Badge>
          <span className="text-text-faint">→</span>
          <Badge variant={next ? 'success' : 'danger'}>{next ? t('common.enabled') : t('common.disabled')}</Badge>
        </div>
      </div>
      {IMPACT_NOTE_KEYS[perm.permission_key] && (
        <div className="mt-3 rounded-[var(--r)] border border-warning/40 bg-warning-soft/30 p-3 text-xs text-text-dim leading-relaxed">
          <span className="font-semibold text-warning">{t('rolePermissions.impact')}: </span>
          {t(IMPACT_NOTE_KEYS[perm.permission_key])}
        </div>
      )}
      <div className="flex gap-2 justify-end mt-5">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" loading={saving} onClick={onConfirm}>{t('sysRules.applyChange')}</Button>
      </div>
    </Modal>
  )
}

// ─── CREATE MODAL ─────────────────────────────────────────────────────────────────

function CreatePermissionModal({
  defaultRole, existingKeys, saving, onClose, onCreate,
}: {
  defaultRole: Role
  existingKeys: Set<string>
  saving: boolean
  onClose: () => void
  onCreate: (payload: RolePermissionPayload) => void
}) {
  const { t } = useLanguage()
  const [role, setRole] = useState<Role>(defaultRole)
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(ROLE_PERMISSION_CATEGORIES[0].key)
  const [enabled, setEnabled] = useState(false)
  const [locked, setLocked] = useState(false)
  const [lockedReason, setLockedReason] = useState('')
  const [error, setError] = useState('')

  function submit() {
    setError('')
    const k = key.trim().toLowerCase()
    if (!k) { setError(t('rolePermissions.keyRequired')); return }
    if (!/^[a-z][a-z0-9_]*$/.test(k)) {
      setError(t('sysRules.keyFormat'))
      return
    }
    if (existingKeys.has(`${role}:${k}`)) { setError(t('rolePermissions.permExists')); return }
    if (!label.trim()) { setError(t('sysRules.labelRequired')); return }
    if (locked && !lockedReason.trim()) { setError(t('rolePermissions.lockedReasonRequired')); return }

    onCreate({
      role,
      permission_key: k,
      label: label.trim(),
      description: description.trim() || undefined,
      category,
      enabled,
      locked,
      locked_reason: locked ? lockedReason.trim() : undefined,
    })
  }

  return (
    <Modal open onClose={onClose} title={t('rolePermissions.createCustom')} width="min(560px,100%)">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('common.role')}
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={ASSIGNABLE_ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))}
          />
          <Select
            label={t('adminArticles.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={ROLE_PERMISSION_CATEGORIES.map((c) => ({ value: c.key, label: t(c.labelKey) }))}
          />
        </div>
        <Input
          label={t('rolePermissions.permissionKey')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. export_custom_report"
          hint={t('sysRules.keyHint')}
        />
        <Input label={t('sysRules.label')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('sysRules.humanReadableName')} />
        <Textarea label={t('common.description')} value={description} onChange={(e) => setDescription(e.target.value)} minRows={2} />

        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={enabled} onChange={setEnabled} />
          <span className="text-sm text-text-dim">{t('rolePermissions.enabledByDefault')}</span>
        </label>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={locked} onChange={setLocked} />
          <span className="text-sm text-text-dim">{t('rolePermissions.lockedCannotToggle')}</span>
        </label>

        {locked && (
          <Input
            label={t('rolePermissions.lockedReason')}
            value={lockedReason}
            onChange={(e) => setLockedReason(e.target.value)}
            placeholder={t('rolePermissions.whyLocked')}
          />
        )}

        {error && <p className="text-xs text-danger font-medium">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{t('rolePermissions.createPermission')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── PAGE ───────────────────────────────────────────────────────────────────────

export default function SuperAdminRolePermissions() {
  const { profile } = useAuth()
  const role = profile?.role
  const { t } = useLanguage()

  const qc = useQueryClient()
  const { ok, err } = useToast()
  const { data: perms = [], isLoading, error } = useRolePermissions()

  // Allow deep-linking a specific role tab, e.g. /super-admin/role-permissions?role=admin1.
  // Redundant per-role permission pages (admin1-perms, admin2-perms) redirect here.
  const [searchParams] = useSearchParams()
  const roleParam = searchParams.get('role')
  const initialRole: Role =
    roleParam && (ASSIGNABLE_ROLES as string[]).includes(roleParam) ? (roleParam as Role) : 'admin2'

  const [activeRole, setActiveRole] = useState<Role>(initialRole)
  const [activeCat, setActiveCat] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [lockedFilter, setLockedFilter] = useState<string>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [confirmChange, setConfirmChange] = useState<{ perm: RolePermission; next: boolean } | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['role-permissions'] })

  const updateMut = useMutation({
    mutationFn: (v: { role: Role; key: string; enabled: boolean }) =>
      updateRolePermission(v.role, v.key, v.enabled),
    onSuccess: () => { invalidate(); ok(t('rolePermissions.permUpdated')) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const createMut = useMutation({
    mutationFn: (p: RolePermissionPayload) => createRolePermission(p),
    onSuccess: () => { invalidate(); ok(t('rolePermissions.permCreated')); setCreateOpen(false) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const bulkMut = useMutation({
    mutationFn: (v: { role: Role; category: string; enabled: boolean }) =>
      bulkUpdateRolePermissions(v.role, v.category, v.enabled),
    onSuccess: () => { invalidate(); ok(t('rolePermissions.categoryUpdated')) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const resetMut = useMutation({
    mutationFn: (r: Role) => resetRolePermissionsToDefault(r),
    onSuccess: () => { invalidate(); setResetOpen(false); ok(t('rolePermissions.roleReset')) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const restoreMut = useMutation({
    mutationFn: () => restoreMissingDefaultRolePermissions(),
    onSuccess: (res) => {
      invalidate(); setRestoreOpen(false)
      ok(res.inserted ? t('rolePermissions.restoredCount', { count: res.inserted }) : t('sysRules.allDefaultsPresent'))
    },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })

  const busy = updateMut.isPending || createMut.isPending || bulkMut.isPending

  const stats = useMemo(() => {
    const enabled = perms.filter((p) => p.enabled).length
    const locked = perms.filter((p) => p.locked).length
    const last = perms.reduce<RolePermission | null>(
      (acc, p) => (!acc || p.updated_at > acc.updated_at ? p : acc), null,
    )
    return {
      total: perms.length,
      enabled,
      disabled: perms.length - enabled,
      locked,
      roles: new Set(perms.map((p) => p.role)).size,
      last,
    }
  }, [perms])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return perms.filter((p) => {
      if (p.role !== activeRole) return false
      if (activeCat !== 'all' && p.category !== activeCat) return false
      if (statusFilter === 'enabled' && !p.enabled) return false
      if (statusFilter === 'disabled' && p.enabled) return false
      if (lockedFilter === 'locked' && !p.locked) return false
      if (lockedFilter === 'unlocked' && p.locked) return false
      if (q && !(
        p.permission_key.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        (p.description ?? '').toLowerCase().includes(q)
      )) return false
      return true
    })
  }, [perms, activeRole, activeCat, statusFilter, lockedFilter, search])

  const existingKeys = useMemo(
    () => new Set(perms.map((p) => `${p.role}:${p.permission_key}`)),
    [perms],
  )

  function handleToggle(perm: RolePermission, next: boolean) {
    if (perm.locked) return
    if (DANGEROUS_PERMISSION_KEYS.has(perm.permission_key)) setConfirmChange({ perm, next })
    else updateMut.mutate({ role: perm.role, key: perm.permission_key, enabled: next })
  }

  // ─── Access control (defense-in-depth; route already restricts to super_admin) ───
  if (!canManageRolePermissions(role)) {
    return <AccessDenied message={t('rolePermissions.accessDenied')} />
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('rolePermissions.title')}
        description={t('rolePermissions.description')}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRestoreOpen(true)}>
              {t('rolePermissions.restoreDefaults')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              {t('rolePermissions.newPermission')}
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard label={t('common.total')} value={stats.total} />
        <StatCard label={t('common.enabled')} value={stats.enabled} />
        <StatCard label={t('common.disabled')} value={stats.disabled} />
        <StatCard label={t('common.locked')} value={stats.locked} />
        <StatCard label={t('rolePermissions.rolesConfigured')} value={stats.roles} />
        <StatCard
          label={t('common.lastUpdated')}
          value={<span className="text-sm leading-tight block truncate">{stats.last?.label ?? '—'}</span>}
          sub={stats.last ? `${t('roles.' + stats.last.role)} · ${formatDate(stats.last.updated_at)}` : undefined}
        />
      </div>

      {/* Role tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {ASSIGNABLE_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setActiveRole(r)}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border',
              activeRole === r
                ? 'bg-primary text-primary-on border-primary'
                : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
            )}
          >
            {t('roles.' + r)}
          </button>
        ))}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {[{ key: 'all', labelKey: 'common.all' }, ...ROLE_PERMISSION_CATEGORIES.map(c => ({ key: c.key, labelKey: c.labelKey }))].map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setActiveCat(c.key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-colors border',
              activeCat === c.key
                ? 'bg-text text-bg border-text'
                : 'bg-section text-text-dim border-line hover:border-primary hover:text-text',
            )}
          >
            {t(c.labelKey)}
          </button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('rolePermissions.searchPlaceholder')}
          className="field flex-1 min-w-[180px] text-sm"
        />
        <select className="field text-sm py-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t('rolePermissions.statesAll')}</option>
          <option value="enabled">{t('common.enabled')}</option>
          <option value="disabled">{t('common.disabled')}</option>
        </select>
        <select className="field text-sm py-2" value={lockedFilter} onChange={(e) => setLockedFilter(e.target.value)}>
          <option value="all">{t('rolePermissions.lockedUnlocked')}</option>
          <option value="locked">{t('rolePermissions.lockedOnly')}</option>
          <option value="unlocked">{t('rolePermissions.unlockedOnly')}</option>
        </select>
      </div>

      {/* Bulk action bar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <span className="text-xs text-text-faint mr-1">
          {t('roles.' + activeRole)} · {t('rolePermissions.shown', { count: filtered.length })}
        </span>
        {activeCat !== 'all' && (
          <>
            <Button
              variant="ghost" size="sm" disabled={busy}
              onClick={() => bulkMut.mutate({ role: activeRole, category: activeCat, enabled: true })}
            >
              {t('rolePermissions.enableAllIn', { category: catLabel(t, activeCat) })}
            </Button>
            <Button
              variant="ghost" size="sm" disabled={busy}
              onClick={() => bulkMut.mutate({ role: activeRole, category: activeCat, enabled: false })}
            >
              {t('rolePermissions.disableAll')}
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setResetOpen(true)}>
          {t('rolePermissions.resetToDefault', { role: t('roles.' + activeRole) })}
        </Button>
        <HelpTip
          title={t('helpTips.rolePerms.title')}
          what={t('helpTips.rolePerms.what')}
          who={t('helpTips.rolePerms.who')}
          reversible={t('helpTips.rolePerms.reversible')}
          warning={t('helpTips.rolePerms.warning')}
        />
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-20 text-center text-text-faint text-sm">{t('common.loading')}</div>
      ) : error ? (
        <SectionCard>
          <EmptyState
            title={t('rolePermissions.loadError')}
            description={t('rolePermissions.loadErrorHint')}
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title={t('rolePermissions.noMatch')}
            description={
              perms.length === 0
                ? t('rolePermissions.emptyNone')
                : t('rolePermissions.emptyFiltered')
            }
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
          {filtered.map((perm) => (
            <PermissionCard
              key={perm.id}
              perm={perm}
              busy={busy}
              onToggle={(next) => handleToggle(perm, next)}
            />
          ))}
        </div>
      )}

      {/* Create modal */}
      {createOpen && (
        <CreatePermissionModal
          defaultRole={activeRole}
          existingKeys={existingKeys}
          saving={createMut.isPending}
          onClose={() => setCreateOpen(false)}
          onCreate={(p) => createMut.mutate(p)}
        />
      )}

      {/* Dangerous-change confirm */}
      {confirmChange && (
        <DangerConfirm
          perm={confirmChange.perm}
          next={confirmChange.next}
          saving={updateMut.isPending}
          onClose={() => setConfirmChange(null)}
          onConfirm={() =>
            updateMut.mutate(
              { role: confirmChange.perm.role, key: confirmChange.perm.permission_key, enabled: confirmChange.next },
              { onSuccess: () => setConfirmChange(null) },
            )
          }
        />
      )}

      {/* Reset role confirm */}
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={() => resetMut.mutate(activeRole)}
        title={t('rolePermissions.resetToDefault', { role: t('roles.' + activeRole) })}
        message={t('rolePermissions.resetMessage', { role: t('roles.' + activeRole) })}
        confirmLabel={t('rolePermissions.resetRole')}
        destructive
        loading={resetMut.isPending}
      />

      {/* Restore missing defaults confirm */}
      <ConfirmDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onConfirm={() => restoreMut.mutate()}
        title={t('rolePermissions.restoreMissingTitle')}
        message={t('rolePermissions.restoreMissingMessage')}
        confirmLabel={t('rolePermissions.restoreDefaults')}
        loading={restoreMut.isPending}
      />
    </PageWrapper>
  )
}

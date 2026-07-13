import { useState, useMemo, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import {
  Button, Badge, Modal, ConfirmDialog, Input, Textarea, Select,
  StatCard, EmptyState, useToast, HelpTip,
} from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useSystemRules } from '@/hooks/useSystemRules'
import { canManageSystemRules } from '@/lib/permissions'
import {
  getRuleExplanation, RISK_META, isRiskyLevel,
  type RiskLevel, type SystemRuleExplanation,
} from '@/lib/systemRuleExplanations'
import {
  SYSTEM_RULE_CATEGORIES, getDefaultRule,
  updateSystemRule, createSystemRule, deleteSystemRule, restoreMissingDefaultRules,
  type SystemRuleMeta, type SystemRulePayload,
} from '@/services/systemRules'
import { formatDate } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type { Role, SystemRule, SystemRuleValue, SystemRuleValueType } from '@/types'

// ─── CONSTANTS / HELPERS ────────────────────────────────────────────────────────

const ALL_ROLES: Role[] = ['archer', 'coach', 'admin1', 'admin2', 'super_admin']
const VALUE_TYPES: SystemRuleValueType[] = ['boolean', 'string', 'number', 'json']

type Translate = (key: string, vars?: Record<string, string | number>) => string

function RiskBadge({ level, className }: { level: RiskLevel; className?: string }) {
  const { t } = useLanguage()
  const m = RISK_META[level]
  return <Badge variant={m.badge} className={className}>{t(m.labelKey)}</Badge>
}

function AffectedChips({ exp }: { exp: SystemRuleExplanation }) {
  const { t } = useLanguage()
  const items = [
    ...exp.affectedRoles.map((r) => t(`roles.${r}`)),
    ...exp.affectedFeatures.map((f) => t(`sysRuleFeature.${f}`)),
  ]
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className="text-[10px] px-1.5 py-0.5 rounded bg-section text-text-dim">
          {it}
        </span>
      ))}
    </div>
  )
}

/** Directional impact text for a pending value change. */
function whatHappensText(valueType: string, exp: SystemRuleExplanation, newValue: SystemRuleValue): string {
  if (valueType === 'boolean') return newValue ? exp.whenEnabled : exp.whenDisabled
  return exp.summary
}

function valueToText(t: Translate, rule: Pick<SystemRule, 'value' | 'value_type'>): string {
  if (rule.value_type === 'boolean') return rule.value ? t('sysRules.on') : t('sysRules.off')
  if (rule.value_type === 'json') return JSON.stringify(rule.value)
  return String(rule.value ?? '')
}

function isBoolEnabled(rule: SystemRule): boolean {
  return rule.value_type === 'boolean' && rule.value === true
}

function sameValue(a: SystemRuleValue, b: SystemRuleValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function coerceValue(
  t: Translate,
  type: SystemRuleValueType,
  boolDraft: boolean,
  textDraft: string,
): { ok: true; value: SystemRuleValue } | { ok: false; error: string } {
  if (type === 'boolean') return { ok: true, value: boolDraft }
  if (type === 'number') {
    const n = Number(textDraft)
    if (textDraft.trim() === '' || Number.isNaN(n)) return { ok: false, error: t('sysRules.enterValidNumber') }
    return { ok: true, value: n }
  }
  if (type === 'json') {
    try {
      return { ok: true, value: JSON.parse(textDraft) as SystemRuleValue }
    } catch {
      return { ok: false, error: t('sysRules.invalidJson') }
    }
  }
  return { ok: true, value: textDraft }
}

const catLabel = (t: Translate, key: string) => {
  const cat = SYSTEM_RULE_CATEGORIES.find((c) => c.key === key)
  return cat ? t(cat.labelKey) : key
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

// ─── HELP POPOVER (hover on desktop, tap on mobile) ───────────────────────────────

function HelpPopover({ rule, exp }: { rule: SystemRule; exp: SystemRuleExplanation }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div
      className="relative inline-flex"
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label={t('sysRules.whatDoesThisDo')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-4 h-4 rounded-full border border-line text-text-faint hover:text-primary hover:border-primary inline-flex items-center justify-center text-[10px] font-bold leading-none"
      >
        ?
      </button>
      {open && (
        <div
          role="dialog"
          className="absolute z-50 left-0 top-full mt-1.5 w-[min(280px,80vw)] rounded-[var(--r)] border border-line bg-surface shadow-card-lg p-3 text-left space-y-2 animate-menu-in"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-display font-semibold text-xs text-text">{rule.label}</span>
            <RiskBadge level={exp.riskLevel} className="text-[9px]" />
          </div>
          <p className="text-[11px] text-text-dim leading-relaxed">{exp.summary}</p>
          <p className="text-[11px] text-text-dim leading-relaxed">
            <span className="font-semibold text-success">{t('sysRules.whenOn')}: </span>{exp.whenEnabled}
          </p>
          <p className="text-[11px] text-text-dim leading-relaxed">
            <span className="font-semibold text-text-dim">{t('sysRules.whenOff')}: </span>{exp.whenDisabled}
          </p>
          {(exp.affectedRoles.length > 0 || exp.affectedFeatures.length > 0) && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-text-faint uppercase tracking-wide">{t('sysRules.affected')}</p>
              <AffectedChips exp={exp} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── RULE CARD ──────────────────────────────────────────────────────────────────

function RuleCard({
  rule, busy, onToggle, onEdit, onReset,
}: {
  rule: SystemRule
  busy: boolean
  onToggle: (next: boolean) => void
  onEdit: () => void
  onReset: () => void
}) {
  const { t } = useLanguage()
  const def = getDefaultRule(rule.key)
  const canReset = !!def && !sameValue(def.value, rule.value)
  const exp = getRuleExplanation(t, rule)

  return (
    <div className="rounded-[var(--r)] border border-line bg-surface p-4 flex flex-col gap-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display font-semibold text-sm text-text">{rule.label}</h3>
            <HelpPopover rule={rule} exp={exp} />
            <RiskBadge level={exp.riskLevel} className="text-[9px]" />
          </div>
          <code className="text-[11px] text-text-faint break-all">{rule.key}</code>
        </div>

        {/* Inline control for booleans */}
        {rule.value_type === 'boolean' ? (
          <Toggle checked={rule.value === true} disabled={busy} onChange={onToggle} />
        ) : (
          <span className="text-sm font-semibold text-text whitespace-nowrap">
            {valueToText(t, rule)}
          </span>
        )}
      </div>

      {rule.description && (
        <p className="text-xs text-text-dim leading-relaxed">{rule.description}</p>
      )}

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="neutral" className="text-[9px]">{catLabel(t, rule.category)}</Badge>
        <Badge variant="neutral" className="text-[9px]">{rule.value_type}</Badge>
        <Badge variant={rule.is_public ? 'primary' : 'neutral'} className="text-[9px]">
          {rule.is_public ? t('sysRules.publicFlag') : t('sysRules.restricted')}
        </Badge>
      </div>

      {(rule.editable_by ?? []).length > 0 && (
        <div className="flex items-center gap-1 flex-wrap text-[10px] text-text-faint">
          <span>{t('sysRules.editableBy')}:</span>
          {(rule.editable_by ?? []).map((r) => (
            <span key={r} className="px-1.5 py-0.5 rounded bg-section text-text-dim">
              {t(`roles.${r}`)}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-1 mt-auto border-t border-line">
        <span className="text-[10.5px] text-text-faint">
          {t('statesPage.updatedOn')} {formatDate(rule.updated_at)}
        </span>
        <div className="flex items-center gap-1.5">
          {canReset && (
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className="text-[11px] font-semibold text-text-dim hover:text-primary disabled:opacity-50"
            >
              {t('common.reset')}
            </button>
          )}
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
    </div>
  )
}

// ─── RISK-AWARE CHANGE CONFIRM ────────────────────────────────────────────────────

function RiskConfirm({
  rule, newValue, saving, onClose, onConfirm,
}: {
  rule: SystemRule
  newValue: SystemRuleValue
  saving: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const { t } = useLanguage()
  const exp = getRuleExplanation(t, rule)
  const isCritical = exp.riskLevel === 'critical'
  const [ack, setAck] = useState(false)
  const happens = whatHappensText(rule.value_type, exp, newValue)

  return (
    <Modal
      open
      onClose={onClose}
      title={isCritical ? t('sysRules.confirmCritical') : t('sysRules.confirmChange')}
      width="min(460px,100%)"
    >
      <p className="text-sm text-text-dim leading-relaxed">
        {t('sysRules.reviewImpact')}
      </p>

      <div className="mt-4 rounded-[var(--r)] border border-line bg-section p-3 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="font-semibold text-text">{rule.label}</span>
          <RiskBadge level={exp.riskLevel} />
        </div>
        <code className="text-[11px] text-text-faint break-all">{rule.key}</code>
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="neutral">{valueToText(t, { value: rule.value, value_type: rule.value_type })}</Badge>
          <span className="text-text-faint">→</span>
          <Badge variant="primary">{valueToText(t, { value: newValue, value_type: rule.value_type })}</Badge>
        </div>
      </div>

      <div className="mt-3 rounded-[var(--r)] border border-warning/40 bg-warning-soft/30 p-3 text-xs text-text-dim leading-relaxed space-y-2">
        <p><span className="font-semibold text-warning">{t('sysRules.whatWillHappen')}: </span>{happens}</p>
        {(exp.affectedRoles.length > 0 || exp.affectedFeatures.length > 0) && (
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="font-semibold text-text">{t('sysRules.affected')}:</span>
            <AffectedChips exp={exp} />
          </div>
        )}
      </div>

      {isCritical && (
        <label className="mt-3 flex items-start gap-2 rounded-[var(--r)] border border-danger/40 bg-danger-soft/20 p-2.5 cursor-pointer">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
          <span className="text-xs text-text-dim leading-relaxed">{t('sysRules.iUnderstand')}</span>
        </label>
      )}

      <div className="flex gap-2 justify-end mt-5">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="primary" loading={saving} disabled={isCritical && !ack} onClick={onConfirm}>
          {t('sysRules.applyChange')}
        </Button>
      </div>
    </Modal>
  )
}

// ─── EDIT MODAL ───────────────────────────────────────────────────────────────────

function EditRuleModal({
  rule, saving, onClose, onSave, onDelete,
}: {
  rule: SystemRule
  saving: boolean
  onClose: () => void
  onSave: (value: SystemRuleValue, meta: SystemRuleMeta) => void
  onDelete?: () => void
}) {
  const { t } = useLanguage()
  const [label, setLabel] = useState(rule.label)
  const [description, setDescription] = useState(rule.description ?? '')
  const [category, setCategory] = useState(rule.category)
  const [valueType, setValueType] = useState<SystemRuleValueType>(rule.value_type)
  const [isPublic, setIsPublic] = useState(rule.is_public)
  const [editableBy, setEditableBy] = useState<string[]>(rule.editable_by ?? ['super_admin'])
  const [boolDraft, setBoolDraft] = useState(rule.value === true)
  const [textDraft, setTextDraft] = useState(
    rule.value_type === 'json' ? JSON.stringify(rule.value, null, 2) : String(rule.value ?? ''),
  )
  const [error, setError] = useState('')
  const [ack, setAck] = useState(false)
  const [showImpact, setShowImpact] = useState(false)

  const exp = getRuleExplanation(t, rule)
  const requiresAck = exp.riskLevel === 'critical'
  const isCustom = !getDefaultRule(rule.key)

  const draftCoerced = coerceValue(t, valueType, boolDraft, textDraft)
  const draftValue = draftCoerced.ok ? draftCoerced.value : rule.value
  const draftChanged = !sameValue(draftValue, rule.value)

  function toggleRole(r: string) {
    setEditableBy((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
  }

  function submit() {
    setError('')
    if (!label.trim()) { setError(t('sysRules.labelRequired')); return }
    const coerced = coerceValue(t, valueType, boolDraft, textDraft)
    if (!coerced.ok) { setError(coerced.error); return }
    if (requiresAck && !ack) { setError(t('sysRules.confirmImpact')); return }
    onSave(coerced.value, {
      label: label.trim(),
      description: description.trim() || undefined,
      category,
      value_type: valueType,
      is_public: isPublic,
      editable_by: editableBy.length ? editableBy : ['super_admin'],
    })
  }

  return (
    <Modal open onClose={onClose} title={t('sysRules.editRule')} width="min(560px,100%)">
      <div className="space-y-4">
        <div>
          <label className="text-[12px] font-semibold text-text-dim block mb-1">{t('sysRules.key')}</label>
          <code className="text-xs text-text-faint break-all">{rule.key}</code>
          <p className="text-[11px] text-text-faint mt-0.5">{t('sysRules.keysCannotChange')}</p>
        </div>

        <Input label={t('sysRules.label')} value={label} onChange={(e) => setLabel(e.target.value)} />
        <Textarea
          label={t('common.description')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          minRows={2}
        />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('adminArticles.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={SYSTEM_RULE_CATEGORIES.map((c) => ({ value: c.key, label: t(c.labelKey) }))}
          />
          <Select
            label={t('sysRules.valueType')}
            value={valueType}
            onChange={(e) => setValueType(e.target.value as SystemRuleValueType)}
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
            />
          ) : (
            <Input value={textDraft} onChange={(e) => setTextDraft(e.target.value)} />
          )}
        </div>

        {/* Is public */}
        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={isPublic} onChange={setIsPublic} />
          <span className="text-sm text-text-dim">
            {t('sysRules.publicFeatureFlag')} <span className="text-text-faint">{t('sysRules.readableByAll')}</span>
          </span>
        </label>

        {/* Editable by */}
        <div>
          <label className="text-[12px] font-semibold text-text-dim block mb-1.5">{t('sysRules.editableBy')}</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggleRole(r)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors',
                  editableBy.includes(r)
                    ? 'bg-primary text-primary-on border-primary'
                    : 'bg-section text-text-dim border-line hover:border-primary',
                )}
              >
                {t(`roles.${r}`)}
              </button>
            ))}
          </div>
        </div>

        {/* What happens if I change this? */}
        <div className="rounded-[var(--r)] border border-line bg-section/40 p-3">
          <button
            type="button"
            onClick={() => setShowImpact((s) => !s)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="text-[12px] font-semibold text-text-dim">{t('sysRules.whatHappensIfChange')}</span>
            <span className="text-[11px] text-text-faint">{showImpact ? t('sysRules.hide') : t('sysRules.show')}</span>
          </button>
          {showImpact && (
            <div className="mt-2.5 space-y-2 text-[11px] text-text-dim leading-relaxed">
              <div className="flex items-center gap-2">
                <Badge variant="neutral">{valueToText(t, { value: rule.value, value_type: rule.value_type })}</Badge>
                <span className="text-text-faint">→</span>
                <Badge variant={draftChanged ? 'primary' : 'neutral'}>
                  {draftCoerced.ok ? valueToText(t, { value: draftValue, value_type: valueType }) : t('sysRules.invalid')}
                </Badge>
              </div>
              <p><span className="font-semibold text-text">{t('sysRules.expectedImpact')}: </span>{whatHappensText(valueType, exp, draftValue)}</p>
              {(exp.affectedRoles.length > 0 || exp.affectedFeatures.length > 0) && (
                <div className="flex items-start gap-1.5 flex-wrap">
                  <span className="font-semibold text-text">{t('sysRules.affected')}:</span>
                  <AffectedChips exp={exp} />
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-text">{t('sysRules.risk')}:</span>
                <RiskBadge level={exp.riskLevel} className="text-[9px]" />
              </div>
              <p>
                <span className="font-semibold text-text">{t('sysRules.confirmationRequired')}: </span>
                {isRiskyLevel(exp.riskLevel) ? t('common.yes') : t('common.no')}
              </p>
            </div>
          )}
        </div>

        {requiresAck && (
          <label className="flex items-start gap-2 rounded-[var(--r)] border border-danger/40 bg-danger-soft/20 p-2.5 cursor-pointer">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
            <span className="text-xs text-text-dim leading-relaxed">
              {t('sysRules.criticalAck')}
            </span>
          </label>
        )}

        {error && <p className="text-xs text-danger font-medium">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-1">
          {isCustom && onDelete ? (
            <Button variant="danger" size="sm" onClick={onDelete} disabled={saving}>{t('sysRules.deleteRule')}</Button>
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

// ─── CREATE MODAL ─────────────────────────────────────────────────────────────────

function CreateRuleModal({
  existingKeys, saving, onClose, onCreate,
}: {
  existingKeys: Set<string>
  saving: boolean
  onClose: () => void
  onCreate: (payload: SystemRulePayload) => void
}) {
  const { t } = useLanguage()
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState(SYSTEM_RULE_CATEGORIES[0].key)
  const [valueType, setValueType] = useState<SystemRuleValueType>('boolean')
  const [isPublic, setIsPublic] = useState(false)
  const [editableBy, setEditableBy] = useState<string[]>(['super_admin'])
  const [boolDraft, setBoolDraft] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [error, setError] = useState('')

  function toggleRole(r: string) {
    setEditableBy((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
  }

  function submit() {
    setError('')
    const k = key.trim().toLowerCase()
    if (!k) { setError(t('sysRules.keyRequired')); return }
    if (!/^[a-z][a-z0-9_]*$/.test(k)) {
      setError(t('sysRules.keyFormat'))
      return
    }
    if (existingKeys.has(k)) { setError(t('sysRules.keyExists')); return }
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
      editable_by: editableBy.length ? editableBy : ['super_admin'],
    })
  }

  return (
    <Modal open onClose={onClose} title={t('sysRules.createCustomRule')} width="min(560px,100%)">
      <div className="space-y-4">
        <Input
          label={t('sysRules.key')}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. allow_offline_sync"
          hint={t('sysRules.keyHint')}
        />
        <Input label={t('sysRules.label')} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('sysRules.humanReadableName')} />
        <Textarea label={t('common.description')} value={description} onChange={(e) => setDescription(e.target.value)} minRows={2} />

        <div className="grid grid-cols-2 gap-3">
          <Select
            label={t('adminArticles.category')}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={SYSTEM_RULE_CATEGORIES.map((c) => ({ value: c.key, label: t(c.labelKey) }))}
          />
          <Select
            label={t('sysRules.valueType')}
            value={valueType}
            onChange={(e) => setValueType(e.target.value as SystemRuleValueType)}
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
          ) : (
            <Input value={textDraft} onChange={(e) => setTextDraft(e.target.value)} placeholder="value" />
          )}
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer">
          <Toggle checked={isPublic} onChange={setIsPublic} />
          <span className="text-sm text-text-dim">
            {t('sysRules.publicFeatureFlag')} <span className="text-text-faint">{t('sysRules.readableByAll')}</span>
          </span>
        </label>

        <div>
          <label className="text-[12px] font-semibold text-text-dim block mb-1.5">{t('sysRules.editableBy')}</label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => toggleRole(r)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors',
                  editableBy.includes(r)
                    ? 'bg-primary text-primary-on border-primary'
                    : 'bg-section text-text-dim border-line hover:border-primary',
                )}
              >
                {t(`roles.${r}`)}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-danger font-medium">{error}</p>}

        <div className="flex gap-2 justify-end pt-1">
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{t('sysRules.createRule')}</Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── PAGE ───────────────────────────────────────────────────────────────────────

export default function SuperAdminSystemRules() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const role = profile?.role

  const qc = useQueryClient()
  const { ok, err } = useToast()
  const { data: rules = [], isLoading, error } = useSystemRules()

  const [activeCat, setActiveCat] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [visFilter, setVisFilter] = useState<string>('all')

  const [editRule, setEditRule] = useState<SystemRule | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [confirmChange, setConfirmChange] = useState<{ rule: SystemRule; value: SystemRuleValue } | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const [deleteKey, setDeleteKey] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['system-rules'] })

  const updateMut = useMutation({
    mutationFn: (v: { key: string; value: SystemRuleValue; meta?: SystemRuleMeta }) =>
      updateSystemRule(v.key, v.value, v.meta),
    onSuccess: () => { invalidate(); ok(t('sysRules.ruleUpdated')) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const createMut = useMutation({
    mutationFn: (p: SystemRulePayload) => createSystemRule(p),
    onSuccess: () => { invalidate(); ok(t('sysRules.ruleCreated')); setCreateOpen(false) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const deleteMut = useMutation({
    mutationFn: (key: string) => deleteSystemRule(key),
    onSuccess: () => { invalidate(); ok(t('sysRules.ruleDeleted')); setDeleteKey(null); setEditRule(null) },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })
  const restoreMut = useMutation({
    mutationFn: () => restoreMissingDefaultRules(),
    onSuccess: (res) => {
      invalidate()
      setRestoreOpen(false)
      ok(res.inserted.length ? t('sysRules.restoredCount', { count: res.inserted.length }) : t('sysRules.allDefaultsPresent'))
    },
    onError: (e: unknown) => err(t('common.actionFailed'), e instanceof Error ? e.message : undefined),
  })

  const busy = updateMut.isPending || createMut.isPending || deleteMut.isPending

  const stats = useMemo(() => {
    const enabled = rules.filter(isBoolEnabled).length
    const disabled = rules.filter((r) => r.value_type === 'boolean' && r.value === false).length
    const publicCount = rules.filter((r) => r.is_public).length
    const restricted = rules.length - publicCount
    const last = rules.reduce<SystemRule | null>(
      (acc, r) => (!acc || r.updated_at > acc.updated_at ? r : acc), null,
    )
    return { total: rules.length, enabled, disabled, publicCount, restricted, last }
  }, [rules])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rules.filter((r) => {
      if (activeCat !== 'all' && r.category !== activeCat) return false
      if (typeFilter !== 'all' && r.value_type !== typeFilter) return false
      if (statusFilter === 'enabled' && !(r.value_type === 'boolean' && r.value === true)) return false
      if (statusFilter === 'disabled' && !(r.value_type === 'boolean' && r.value === false)) return false
      if (visFilter === 'public' && !r.is_public) return false
      if (visFilter === 'private' && r.is_public) return false
      if (q && !(
        r.key.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      )) return false
      return true
    })
  }, [rules, activeCat, typeFilter, statusFilter, visFilter, search])

  const existingKeys = useMemo(() => new Set(rules.map((r) => r.key)), [rules])

  function handleToggle(rule: SystemRule, next: boolean) {
    if (isRiskyLevel(getRuleExplanation(t, rule).riskLevel)) setConfirmChange({ rule, value: next })
    else updateMut.mutate({ key: rule.key, value: next })
  }

  function handleReset(rule: SystemRule) {
    const def = getDefaultRule(rule.key)
    if (!def) return
    if (isRiskyLevel(getRuleExplanation(t, rule).riskLevel)) setConfirmChange({ rule, value: def.value })
    else updateMut.mutate({ key: rule.key, value: def.value })
  }

  // ─── Access control (defense-in-depth; route already restricts to super_admin) ───
  if (!canManageSystemRules(role)) {
    return <AccessDenied message={t('sysRules.accessDenied')} />
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('sysRules.title')}
        description={t('sysRules.description')}
        action={
          <div className="flex items-center gap-2">
            <HelpTip
              title={t('helpTips.systemRules.title')}
              what={t('helpTips.systemRules.what')}
              who={t('helpTips.systemRules.who')}
              reversible={t('helpTips.systemRules.reversible')}
              warning={t('helpTips.systemRules.warning')}
              align="right"
            />
            <Button variant="ghost" size="sm" onClick={() => setRestoreOpen(true)}>
              {t('sysRules.restoreDefaults')}
            </Button>
            <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
              {t('sysRules.newRule')}
            </Button>
          </div>
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        <StatCard label={t('sysRules.totalRules')} value={stats.total} />
        <StatCard label={t('sysRules.enabled')} value={stats.enabled} />
        <StatCard label={t('sysRules.disabled')} value={stats.disabled} />
        <StatCard label={t('sysRules.publicFlags')} value={stats.publicCount} />
        <StatCard label={t('sysRules.restricted')} value={stats.restricted} />
        <StatCard
          label={t('sysRules.lastUpdated')}
          value={<span className="text-sm leading-tight block truncate">{stats.last?.label ?? '—'}</span>}
          sub={stats.last ? formatDate(stats.last.updated_at) : undefined}
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 -mx-1 px-1">
        {[{ key: 'all', labelKey: 'common.all' }, ...SYSTEM_RULE_CATEGORIES.map(c => ({ key: c.key, labelKey: c.labelKey }))].map((c) => (
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

      {/* Search + filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('sysRules.searchPlaceholder')}
          className="field flex-1 min-w-[180px] text-sm"
        />
        <select className="field text-sm py-2" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="all">{t('common.allTypes')}</option>
          {VALUE_TYPES.map((vt) => <option key={vt} value={vt}>{vt}</option>)}
        </select>
        <select className="field text-sm py-2" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">{t('sysRules.allStates')}</option>
          <option value="enabled">{t('sysRules.enabled')}</option>
          <option value="disabled">{t('sysRules.disabled')}</option>
        </select>
        <select className="field text-sm py-2" value={visFilter} onChange={(e) => setVisFilter(e.target.value)}>
          <option value="all">{t('sysRules.publicAndPrivate')}</option>
          <option value="public">{t('sysRules.publicOnly')}</option>
          <option value="private">{t('sysRules.privateOnly')}</option>
        </select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="py-20 text-center text-text-faint text-sm">{t('sysRules.loading')}</div>
      ) : error ? (
        <SectionCard>
          <EmptyState
            title={t('sysRules.loadError')}
            description={t('sysRules.loadErrorHint')}
          />
        </SectionCard>
      ) : filtered.length === 0 ? (
        <SectionCard>
          <EmptyState
            title={t('sysRules.noMatch')}
            description={
              rules.length === 0
                ? t('sysRules.noneFound')
                : t('sysRules.noMatchFilters')
            }
          />
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pb-4">
          {filtered.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              busy={busy}
              onToggle={(next) => handleToggle(rule, next)}
              onEdit={() => setEditRule(rule)}
              onReset={() => handleReset(rule)}
            />
          ))}
        </div>
      )}

      {/* Edit modal */}
      {editRule && (
        <EditRuleModal
          rule={editRule}
          saving={updateMut.isPending || deleteMut.isPending}
          onClose={() => setEditRule(null)}
          onSave={(value, meta) =>
            updateMut.mutate(
              { key: editRule.key, value, meta },
              { onSuccess: () => setEditRule(null) },
            )
          }
          onDelete={!getDefaultRule(editRule.key) ? () => setDeleteKey(editRule.key) : undefined}
        />
      )}

      {/* Create modal */}
      {createOpen && (
        <CreateRuleModal
          existingKeys={existingKeys}
          saving={createMut.isPending}
          onClose={() => setCreateOpen(false)}
          onCreate={(p) => createMut.mutate(p)}
        />
      )}

      {/* Risk-aware change confirm */}
      {confirmChange && (
        <RiskConfirm
          rule={confirmChange.rule}
          newValue={confirmChange.value}
          saving={updateMut.isPending}
          onClose={() => setConfirmChange(null)}
          onConfirm={() =>
            updateMut.mutate(
              { key: confirmChange.rule.key, value: confirmChange.value },
              { onSuccess: () => setConfirmChange(null) },
            )
          }
        />
      )}

      {/* Restore defaults confirm */}
      <ConfirmDialog
        open={restoreOpen}
        onClose={() => setRestoreOpen(false)}
        onConfirm={() => restoreMut.mutate()}
        title={t('sysRules.restoreMissingTitle')}
        message={t('sysRules.restoreMissingMessage')}
        confirmLabel={t('sysRules.restoreDefaults')}
        loading={restoreMut.isPending}
      />

      {/* Delete custom rule confirm */}
      <ConfirmDialog
        open={!!deleteKey}
        onClose={() => setDeleteKey(null)}
        onConfirm={() => deleteKey && deleteMut.mutate(deleteKey)}
        title={t('sysRules.deleteRule')}
        message={t('sysRules.deleteMessage')}
        confirmLabel={t('common.delete')}
        destructive
        loading={deleteMut.isPending}
      />
    </PageWrapper>
  )
}

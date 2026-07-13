import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Input, Select, Badge, EmptyState, useToast, Modal, Avatar, HelpTip } from '@/components/ui'
import { Textarea } from '@/components/ui/Input'
import { formatDate } from '@/utils/dates'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { useRuleValue } from '@/hooks/useSystemRules'
import { useHasPermission } from '@/hooks/useRolePermissions'
import {
  getArcherEquipment,
  getMyEquipment,
  saveMyEquipment,
  getCoachLinkedArchers,
  coachUpdateEquipment,
  type LinkedArcher,
  type EquipmentPayload,
} from '@/services/equipment'
import type { EquipmentSetup } from '@/types'

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const BOW_CATEGORIES = [
  { value: '',            labelKey: 'equipment.selectCategory' },
  { value: 'recurve',     labelKey: 'bows.recurve' },
  { value: 'compound',    labelKey: 'bows.compound' },
  { value: 'barebow',     labelKey: 'bows.barebow' },
  { value: 'longbow',     labelKey: 'bows.longbow' },
  { value: 'traditional', labelKey: 'bows.traditional' },
]

const BOW_CATEGORY_KEY: Record<string, string> = {
  recurve: 'bows.recurve', compound: 'bows.compound', barebow: 'bows.barebow',
  longbow: 'bows.longbow', traditional: 'bows.traditional',
}

// ─── FORM STATE ───────────────────────────────────────────────────────────────

interface EquipmentForm {
  bow_category: string; bow_brand: string; bow_model: string
  riser_brand: string; riser_model: string; riser_length: string
  limb_brand: string; limb_model: string; limb_length: string; limb_poundage: string
  draw_weight: string; draw_length: string
  string_brand: string; string_material: string
  arrow_brand: string; arrow_model: string; arrow_spine: string; arrow_length: string
  point_weight: string; nock: string; vane: string
  sight_brand: string; sight_model: string
  stabilizer_brand: string; stabilizer_model: string
  clicker: string; plunger: string; arrow_rest: string; scope: string
  peep: string; release: string; finger_tab: string; sling: string
  notes: string
}

const DEFAULT_FORM: EquipmentForm = {
  bow_category: '', bow_brand: '', bow_model: '',
  riser_brand: '', riser_model: '', riser_length: '',
  limb_brand: '', limb_model: '', limb_length: '', limb_poundage: '',
  draw_weight: '', draw_length: '',
  string_brand: '', string_material: '',
  arrow_brand: '', arrow_model: '', arrow_spine: '', arrow_length: '',
  point_weight: '', nock: '', vane: '',
  sight_brand: '', sight_model: '',
  stabilizer_brand: '', stabilizer_model: '',
  clicker: '', plunger: '', arrow_rest: '', scope: '',
  peep: '', release: '', finger_tab: '', sling: '',
  notes: '',
}

function toForm(eq: EquipmentSetup): EquipmentForm {
  const n = (v: number | null | undefined) => (v != null ? String(v) : '')
  const s = (v: string | null | undefined) => v ?? ''
  return {
    bow_category: s(eq.bow_category), bow_brand: s(eq.bow_brand), bow_model: s(eq.bow_model),
    riser_brand: s(eq.riser_brand), riser_model: s(eq.riser_model), riser_length: s(eq.riser_length),
    limb_brand: s(eq.limb_brand), limb_model: s(eq.limb_model), limb_length: s(eq.limb_length),
    limb_poundage: n(eq.limb_poundage), draw_weight: n(eq.draw_weight), draw_length: n(eq.draw_length),
    string_brand: s(eq.string_brand), string_material: s(eq.string_material),
    arrow_brand: s(eq.arrow_brand), arrow_model: s(eq.arrow_model),
    arrow_spine: n(eq.arrow_spine), arrow_length: n(eq.arrow_length),
    point_weight: n(eq.point_weight), nock: s(eq.nock), vane: s(eq.vane),
    sight_brand: s(eq.sight_brand), sight_model: s(eq.sight_model),
    stabilizer_brand: s(eq.stabilizer_brand), stabilizer_model: s(eq.stabilizer_model),
    clicker: s(eq.clicker), plunger: s(eq.plunger), arrow_rest: s(eq.arrow_rest),
    scope: s(eq.scope), peep: s(eq.peep), release: s(eq.release),
    finger_tab: s(eq.finger_tab), sling: s(eq.sling), notes: s(eq.notes),
  }
}

function toPayload(form: EquipmentForm): EquipmentPayload {
  const num = (v: string) => (v.trim() === '' ? null : parseFloat(v))
  const int = (v: string) => (v.trim() === '' ? null : parseInt(v, 10))
  const str = (v: string) => (v.trim() === '' ? null : v.trim())
  return {
    bow_category: str(form.bow_category), bow_brand: str(form.bow_brand), bow_model: str(form.bow_model),
    riser_brand: str(form.riser_brand), riser_model: str(form.riser_model), riser_length: str(form.riser_length),
    limb_brand: str(form.limb_brand), limb_model: str(form.limb_model), limb_length: str(form.limb_length),
    limb_poundage: num(form.limb_poundage), draw_weight: num(form.draw_weight), draw_length: num(form.draw_length),
    string_brand: str(form.string_brand), string_material: str(form.string_material),
    arrow_brand: str(form.arrow_brand), arrow_model: str(form.arrow_model),
    arrow_spine: int(form.arrow_spine), arrow_length: num(form.arrow_length),
    point_weight: num(form.point_weight), nock: str(form.nock), vane: str(form.vane),
    sight_brand: str(form.sight_brand), sight_model: str(form.sight_model),
    stabilizer: null, stabilizer_brand: str(form.stabilizer_brand), stabilizer_model: str(form.stabilizer_model),
    clicker: str(form.clicker), plunger: str(form.plunger), arrow_rest: str(form.arrow_rest),
    scope: str(form.scope), peep: str(form.peep), release: str(form.release),
    finger_tab: str(form.finger_tab), sling: str(form.sling), notes: str(form.notes),
  } as EquipmentPayload
}

type Translate = (key: string, vars?: Record<string, string | number>) => string

/** One-line summary of a setup for the cards. */
function summarize(eq: EquipmentSetup | null | undefined, t: Translate): string {
  if (!eq) return t('equipment.noProfileYet')
  const bits = [
    eq.bow_category ? (BOW_CATEGORY_KEY[eq.bow_category] ? t(BOW_CATEGORY_KEY[eq.bow_category]) : eq.bow_category) : null,
    [eq.bow_brand, eq.bow_model].filter(Boolean).join(' ') || null,
    eq.draw_weight != null ? `${eq.draw_weight} lbs` : null,
  ].filter(Boolean)
  return bits.length ? bits.join(' · ') : t('coachEquip.profileStarted')
}

// ─── SHARED FORM FIELDS (used by both popups) ────────────────────────────────

function EquipmentFields({ form, set, edit }: {
  form: EquipmentForm
  set: (k: keyof EquipmentForm) => (v: string) => void
  edit: boolean
}) {
  const { t } = useLanguage()
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-2">{t('equipment.bow')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select label={t('common.bowCategory')} options={BOW_CATEGORIES.map(o => ({ value: o.value, label: t(o.labelKey) }))} value={form.bow_category} onChange={e => set('bow_category')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.brand')} value={form.bow_brand} onChange={e => set('bow_brand')(e.target.value)} disabled={!edit} placeholder="e.g. Hoyt" />
          <Input label={t('equipment.model')} value={form.bow_model} onChange={e => set('bow_model')(e.target.value)} disabled={!edit} placeholder="e.g. Formula XI" />
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-2">{t('coachEquip.riserLimbs')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input label={`${t('equipment.riser')} — ${t('equipment.brand')}`} value={form.riser_brand} onChange={e => set('riser_brand')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.riser')} — ${t('equipment.model')}`} value={form.riser_model} onChange={e => set('riser_model')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.riser')} — ${t('equipment.length')}`} value={form.riser_length} onChange={e => set('riser_length')(e.target.value)} disabled={!edit} placeholder={'25"'} />
          <Input label={`${t('equipment.limbs')} — ${t('equipment.brand')}`} value={form.limb_brand} onChange={e => set('limb_brand')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.limbs')} — ${t('equipment.model')}`} value={form.limb_model} onChange={e => set('limb_model')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.poundage')} type="number" step="0.5" value={form.limb_poundage} onChange={e => set('limb_poundage')(e.target.value)} disabled={!edit} />
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-2">{t('coachEquip.drawString')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Input label={t('equipment.drawLengthIn')} type="number" step="0.25" value={form.draw_length} onChange={e => set('draw_length')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.drawWeightLbs')} type="number" step="0.5" value={form.draw_weight} onChange={e => set('draw_weight')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.string')} — ${t('equipment.brand')}`} value={form.string_brand} onChange={e => set('string_brand')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.string')} — ${t('equipment.material')}`} value={form.string_material} onChange={e => set('string_material')(e.target.value)} disabled={!edit} />
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-2">{t('equipment.arrows')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input label={t('equipment.brand')} value={form.arrow_brand} onChange={e => set('arrow_brand')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.model')} value={form.arrow_model} onChange={e => set('arrow_model')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.spine')} type="number" step="1" value={form.arrow_spine} onChange={e => set('arrow_spine')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.lengthCm')} type="number" step="0.1" value={form.arrow_length} onChange={e => set('arrow_length')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.pointWeight')} type="number" step="1" value={form.point_weight} onChange={e => set('point_weight')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.nock')} value={form.nock} onChange={e => set('nock')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.vane')} value={form.vane} onChange={e => set('vane')(e.target.value)} disabled={!edit} />
        </div>
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[.06em] text-text-faint mb-2">{t('coachEquip.sightStabAcc')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Input label={`${t('equipment.sight')} — ${t('equipment.brand')}`} value={form.sight_brand} onChange={e => set('sight_brand')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.sight')} — ${t('equipment.model')}`} value={form.sight_model} onChange={e => set('sight_model')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.stabilizer')} — ${t('equipment.brand')}`} value={form.stabilizer_brand} onChange={e => set('stabilizer_brand')(e.target.value)} disabled={!edit} />
          <Input label={`${t('equipment.stabilizer')} — ${t('equipment.model')}`} value={form.stabilizer_model} onChange={e => set('stabilizer_model')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.arrowRest')} value={form.arrow_rest} onChange={e => set('arrow_rest')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.plunger')} value={form.plunger} onChange={e => set('plunger')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.clicker')} value={form.clicker} onChange={e => set('clicker')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.scope')} value={form.scope} onChange={e => set('scope')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.peep')} value={form.peep} onChange={e => set('peep')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.release')} value={form.release} onChange={e => set('release')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.fingerTab')} value={form.finger_tab} onChange={e => set('finger_tab')(e.target.value)} disabled={!edit} />
          <Input label={t('equipment.sling')} value={form.sling} onChange={e => set('sling')(e.target.value)} disabled={!edit} />
        </div>
      </div>
      <Textarea label={t('common.notes')} value={form.notes} onChange={e => set('notes')(e.target.value)} disabled={!edit} minRows={3} />
    </div>
  )
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

type PopupTarget = { kind: 'self' } | { kind: 'archer'; archer: LinkedArcher } | null

export default function CoachEquipment() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const queryClient = useQueryClient()
  const coachId = profile?.id ?? ''
  const role = profile?.role

  const enabled    = useRuleValue('equipment_profiles_enabled', true)
  const canView    = useRuleValue('coaches_can_view_archer_equipment', true)
  const canEdit    = useRuleValue('coaches_can_edit_archer_equipment', false)
  const hasAccess  = useHasPermission(role, 'access_coach_equipment', true)
  const hasView    = useHasPermission(role, 'view_linked_archer_equipment', true)
  const hasEditPerm = useHasPermission(role, 'edit_linked_archer_equipment', false)

  const archerReadOnly = !canEdit || !hasEditPerm

  const [search, setSearch] = useState('')
  const [popup, setPopup] = useState<PopupTarget>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<EquipmentForm>(DEFAULT_FORM)
  const [dirty, setDirty] = useState(false)

  // ── The coach's OWN equipment ──
  const { data: myEquipment } = useQuery({
    queryKey: ['my-equipment', coachId],
    queryFn: () => getMyEquipment(coachId),
    enabled: !!coachId && enabled === true,
  })

  // ── Linked archers ──
  const { data: archers = [], isLoading: loadingArchers } = useQuery({
    queryKey: ['coach-linked-archers', coachId],
    queryFn: () => getCoachLinkedArchers(coachId),
    enabled: !!coachId && enabled === true && hasAccess && hasView,
  })

  const filteredArchers = useMemo(() => {
    if (!search.trim()) return archers
    const q = search.toLowerCase()
    return archers.filter(a =>
      a.name.toLowerCase().includes(q) ||
      (a.archer_id ?? '').toLowerCase().includes(q) ||
      (a.school?.name ?? '').toLowerCase().includes(q),
    )
  }, [archers, search])

  // ── Equipment for the open popup ──
  const popupArcherId = popup?.kind === 'archer' ? popup.archer.id : null
  const { data: archerEquipment, isLoading: loadingEquipment } = useQuery({
    queryKey: ['archer-equipment', popupArcherId],
    queryFn: () => getArcherEquipment(popupArcherId!),
    enabled: !!popupArcherId,
  })

  const popupEquipment = popup?.kind === 'self' ? myEquipment : archerEquipment
  const popupEditable = popup?.kind === 'self' ? true : !archerReadOnly

  // Sync form when the popup target / data changes
  useEffect(() => {
    if (!popup) return
    setForm(popupEquipment ? toForm(popupEquipment) : DEFAULT_FORM)
    setEditing(false)
    setDirty(false)
  }, [popup, popupEquipment])

  const set = (key: keyof EquipmentForm) => (value: string) => {
    setForm(f => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: async () => {
      if (popup?.kind === 'self') return saveMyEquipment(coachId, toPayload(form))
      if (popup?.kind === 'archer') return coachUpdateEquipment(popup.archer.id, toPayload(form))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-equipment', coachId] })
      if (popupArcherId) queryClient.invalidateQueries({ queryKey: ['archer-equipment', popupArcherId] })
      ok(t('equipment.saved'))
      setEditing(false)
      setDirty(false)
    },
    onError: (e: Error) => err(e.message),
  })

  function closePopup() {
    if (saving) return
    setPopup(null)
    setEditing(false)
    setDirty(false)
  }

  // ── Gates ──
  if (!enabled) {
    return <FeatureUnavailable title={t('equipment.disabled')} message={t('equipment.disabledHint')} />
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('nav.equipment')}
        description={t('coachEquip.description')}
      />

      {/* ── MY EQUIPMENT ── */}
      <SectionCard title={t('coachEquip.myEquipment')} className="mb-6">
        <button
          onClick={() => setPopup({ kind: 'self' })}
          className="w-full text-left flex items-center gap-3 p-4 rounded-[var(--r-md)] border border-line bg-surface hover:border-primary hover:bg-surface-soft transition-all"
        >
          <Avatar name={profile?.name ?? 'Me'} size="md" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm text-text">{profile?.name}</p>
            <p className="text-xs text-text-dim mt-0.5 truncate">{summarize(myEquipment, t)}</p>
          </div>
          <span className="text-xs font-semibold text-primary shrink-0">
            {myEquipment ? `${t('coachEquip.viewEdit')} →` : `${t('coachEquip.setUp')} →`}
          </span>
        </button>
      </SectionCard>

      {/* ── ARCHERS' EQUIPMENT (card grid) ── */}
      {hasAccess && hasView && canView ? (
        <SectionCard
          title={`${t('coachEquip.archersEquipment')} (${archers.length})`}
          action={
            <Input
              placeholder={t('coachEquip.searchArchers')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              wrapperClassName="w-[220px]"
            />
          }
        >
          {loadingArchers ? (
            <p className="text-sm text-text-dim py-6 text-center">{t('common.loading')}</p>
          ) : archers.length === 0 ? (
            <EmptyState
              title={t('coachEquip.noLinked')}
              description={t('coachEquip.noLinkedHint')}
            />
          ) : filteredArchers.length === 0 ? (
            <p className="text-sm text-text-dim py-4 text-center">{t('common.noResultsFilters')}</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredArchers.map(a => (
                <button
                  key={a.id}
                  onClick={() => setPopup({ kind: 'archer', archer: a })}
                  className="text-left p-4 rounded-[var(--r-md)] border border-line bg-surface hover:border-primary hover:bg-surface-soft hover:-translate-y-0.5 hover:shadow-card transition-all"
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={a.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm text-text truncate">{a.name}</p>
                      <p className="text-[11px] font-mono text-text-faint truncate">{a.archer_id ?? '—'}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-3">
                    {a.bow_category && (
                      <Badge variant="neutral">{BOW_CATEGORY_KEY[a.bow_category] ? t(BOW_CATEGORY_KEY[a.bow_category]) : a.bow_category}</Badge>
                    )}
                    {a.school?.name && <Badge variant="neutral">{a.school.name}</Badge>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>
      ) : (
        <SectionCard>
          <EmptyState title={t('coachEquip.hidden')} description={t('coachEquip.hiddenHint')} />
        </SectionCard>
      )}

      {/* ── EQUIPMENT POPUP (self or archer) ── */}
      <Modal
        open={!!popup}
        onClose={closePopup}
        title={
          popup?.kind === 'self'
            ? t('coachEquip.myEquipment')
            : popup?.kind === 'archer'
              ? `${popup.archer.name} — ${t('nav.equipment').toLowerCase()}`
              : ''
        }
        width="min(720px,100%)"
      >
        {popup && (
          <div className="space-y-4">
            {popup.kind === 'archer' && (
              <div className="flex items-center gap-2 flex-wrap text-xs text-text-dim">
                {popup.archer.archer_id && <span className="font-mono">#{popup.archer.archer_id}</span>}
                {popup.archer.school?.name && <Badge variant="neutral">{popup.archer.school.name}</Badge>}
                <HelpTip
                  title={t('helpTips.coachEquipment.title')}
                  what={t('helpTips.coachEquipment.what')}
                  who={t('helpTips.coachEquipment.who')}
                  reversible={t('helpTips.coachEquipment.reversible')}
                />
                {archerReadOnly && (
                  <span className="ml-auto text-[11px] font-semibold uppercase tracking-wide text-text-faint px-2 py-0.5 bg-section rounded">
                    {t('equipment.readOnly')}
                  </span>
                )}
              </div>
            )}

            {/* Last-updated stamp: who touched this record and when (updated_by
                is stamped on every save; audit log has the full trail). */}
            {popupEquipment?.updated_at && (
              <p className="text-[11px] text-text-faint">
                {t('equipment.lastUpdatedLine', {
                  when: formatDate(popupEquipment.updated_at),
                  by: popupEquipment.updated_by === coachId
                    ? (profile?.name ?? t('roles.coach'))
                    : popup.kind === 'archer' && popupEquipment.updated_by === popup.archer.id
                      ? popup.archer.name
                      : popupEquipment.updated_by
                        ? t('equipment.updatedByAdmin')
                        : '—',
                })}
              </p>
            )}

            {popup.kind === 'archer' && loadingEquipment ? (
              <p className="text-sm text-text-dim py-8 text-center">{t('common.loading')}</p>
            ) : !popupEquipment && !editing ? (
              <EmptyState
                title={t('equipment.noProfileYet')}
                description={
                  popupEditable
                    ? t('coachEquip.startBelow')
                    : t('coachEquip.archerNotSetUp')
                }
                action={popupEditable
                  ? <Button size="sm" onClick={() => setEditing(true)}>{t('coachEquip.startProfile')}</Button>
                  : undefined}
              />
            ) : (
              <>
                <EquipmentFields form={form} set={set} edit={popupEditable && editing} />
                <div className="flex justify-end gap-2 pt-3 border-t border-line">
                  {popupEditable && !editing && (
                    <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{t('common.edit')}</Button>
                  )}
                  {editing && (
                    <>
                      <Button variant="ghost" size="sm" disabled={saving}
                        onClick={() => { setForm(popupEquipment ? toForm(popupEquipment) : DEFAULT_FORM); setEditing(false); setDirty(false) }}>
                        {t('common.cancel')}
                      </Button>
                      <Button size="sm" loading={saving} disabled={!dirty} onClick={() => save()}>{t('common.save')}</Button>
                    </>
                  )}
                  {!editing && <Button variant="secondary" size="sm" onClick={closePopup}>{t('common.close')}</Button>}
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </PageWrapper>
  )
}

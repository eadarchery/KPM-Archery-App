import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Input, Select, useToast } from '@/components/ui'
import { Textarea } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { FeatureUnavailable } from '@/components/common/FeatureUnavailable'
import { useAuth } from '@/hooks/useAuth'
import { useRuleValue } from '@/hooks/useSystemRules'
import { useHasPermission } from '@/hooks/useRolePermissions'
import { getMyEquipment, saveMyEquipment, type EquipmentPayload } from '@/services/equipment'
import { useLanguage } from '@/contexts/LanguageContext'
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

// ─── FORM STATE ───────────────────────────────────────────────────────────────

interface EquipmentForm {
  bow_category: string
  bow_brand: string
  bow_model: string
  riser_brand: string
  riser_model: string
  riser_length: string
  limb_brand: string
  limb_model: string
  limb_length: string
  limb_poundage: string
  draw_weight: string
  draw_length: string
  string_brand: string
  string_material: string
  arrow_brand: string
  arrow_model: string
  arrow_spine: string
  arrow_length: string
  point_weight: string
  nock: string
  vane: string
  sight_brand: string
  sight_model: string
  stabilizer_brand: string
  stabilizer_model: string
  clicker: string
  plunger: string
  arrow_rest: string
  scope: string
  peep: string
  release: string
  finger_tab: string
  sling: string
  notes: string
}

const DEFAULT_FORM: EquipmentForm = {
  bow_category: '', bow_brand: '', bow_model: '',
  riser_brand: '', riser_model: '', riser_length: '',
  limb_brand: '', limb_model: '', limb_length: '', limb_poundage: '',
  draw_weight: '', draw_length: '',
  string_brand: '', string_material: '',
  arrow_brand: '', arrow_model: '', arrow_spine: '', arrow_length: '', point_weight: '', nock: '', vane: '',
  sight_brand: '', sight_model: '',
  stabilizer_brand: '', stabilizer_model: '',
  clicker: '', plunger: '', arrow_rest: '', scope: '', peep: '', release: '', finger_tab: '', sling: '',
  notes: '',
}

function toForm(eq: EquipmentSetup): EquipmentForm {
  const n = (v: number | null | undefined) => (v != null ? String(v) : '')
  const s = (v: string | null | undefined) => v ?? ''
  return {
    bow_category: s(eq.bow_category), bow_brand: s(eq.bow_brand), bow_model: s(eq.bow_model),
    riser_brand: s(eq.riser_brand), riser_model: s(eq.riser_model), riser_length: s(eq.riser_length),
    limb_brand: s(eq.limb_brand), limb_model: s(eq.limb_model), limb_length: s(eq.limb_length),
    limb_poundage: n(eq.limb_poundage),
    draw_weight: n(eq.draw_weight), draw_length: n(eq.draw_length),
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
    bow_category: str(form.bow_category),
    bow_brand: str(form.bow_brand), bow_model: str(form.bow_model),
    riser_brand: str(form.riser_brand), riser_model: str(form.riser_model), riser_length: str(form.riser_length),
    limb_brand: str(form.limb_brand), limb_model: str(form.limb_model), limb_length: str(form.limb_length),
    limb_poundage: num(form.limb_poundage),
    draw_weight: num(form.draw_weight), draw_length: num(form.draw_length),
    string_brand: str(form.string_brand), string_material: str(form.string_material),
    arrow_brand: str(form.arrow_brand), arrow_model: str(form.arrow_model),
    arrow_spine: int(form.arrow_spine), arrow_length: num(form.arrow_length),
    point_weight: num(form.point_weight), nock: str(form.nock), vane: str(form.vane),
    sight_brand: str(form.sight_brand), sight_model: str(form.sight_model),
    stabilizer: null, stabilizer_brand: str(form.stabilizer_brand), stabilizer_model: str(form.stabilizer_model),
    clicker: str(form.clicker), plunger: str(form.plunger), arrow_rest: str(form.arrow_rest),
    scope: str(form.scope), peep: str(form.peep), release: str(form.release),
    finger_tab: str(form.finger_tab), sling: str(form.sling),
    notes: str(form.notes),
  }
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function ArcherEquipment() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const queryClient = useQueryClient()
  const profileId = profile?.id ?? ''
  const role = profile?.role

  const enabled    = useRuleValue('equipment_profiles_enabled', true)
  const archerEdit = useRuleValue('archers_can_edit_own_equipment', true)
  const hasAccess  = useHasPermission(role, 'access_archer_equipment', true)
  const hasEdit    = useHasPermission(role, 'edit_own_equipment', true)
  const isReadOnly = !archerEdit || !hasEdit

  const [form, setForm] = useState<EquipmentForm>(DEFAULT_FORM)
  const [dirty, setDirty] = useState(false)

  const { data: equipment, isLoading } = useQuery({
    queryKey: ['my-equipment', profileId],
    queryFn: () => getMyEquipment(profileId),
    enabled: !!profileId && enabled === true && hasAccess,
  })

  useEffect(() => {
    if (equipment) {
      setForm(toForm(equipment))
      setDirty(false)
    }
  }, [equipment])

  const set = (key: keyof EquipmentForm) => (value: string) => {
    setForm(f => ({ ...f, [key]: value }))
    setDirty(true)
  }

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => saveMyEquipment(profileId, toPayload(form)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-equipment', profileId] })
      ok(t('equipment.saved'))
      setDirty(false)
    },
    onError: (e: Error) => err(e.message),
  })

  const handleReset = () => {
    setForm(equipment ? toForm(equipment) : DEFAULT_FORM)
    setDirty(false)
  }

  if (!enabled) {
    return (
      <FeatureUnavailable
        title={t('equipment.disabled')}
        message={t('equipment.disabledHint')}
      />
    )
  }

  if (!hasAccess) {
    return (
      <FeatureUnavailable
        title={t('equipment.restricted')}
        message={t('equipment.restrictedHint')}
      />
    )
  }

  const actions = !isReadOnly ? (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={handleReset} disabled={!dirty || saving}>
        {t('common.reset')}
      </Button>
      <Button size="sm" onClick={() => save()} loading={saving} disabled={!dirty}>
        {t('common.save')}
      </Button>
    </div>
  ) : (
    <span className="text-[12px] font-semibold uppercase tracking-wide text-text-faint px-2.5 py-1 bg-section rounded-md">
      {t('equipment.readOnly')}
    </span>
  )

  return (
    <PageWrapper>
      <PageHead
        title={t('equipment.title')}
        description={t('equipment.description')}
        action={actions}
      />

      {isLoading && (
        <div className="card p-8 text-center text-text-dim text-sm">{t('common.loading')}</div>
      )}

      {!isLoading && (
        <div className="flex flex-col gap-4">

          {/* BOW */}
          <SectionCard title={t('equipment.bow')}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Select
                label={t('common.bowCategory')}
                options={BOW_CATEGORIES.map(o => ({ value: o.value, label: t(o.labelKey) }))}
                value={form.bow_category}
                onChange={e => set('bow_category')(e.target.value)}
                disabled={isReadOnly}
              />
              <Input label={t('equipment.brand')} value={form.bow_brand} onChange={e => set('bow_brand')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Hoyt" />
              <Input label={t('equipment.model')} value={form.bow_model} onChange={e => set('bow_model')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Formula XI" />
            </div>
          </SectionCard>

          {/* RISER */}
          <SectionCard title={t('equipment.riser')}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Input label={t('equipment.brand')} value={form.riser_brand} onChange={e => set('riser_brand')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Win&Win" />
              <Input label={t('equipment.model')} value={form.riser_model} onChange={e => set('riser_model')(e.target.value)} disabled={isReadOnly} placeholder="e.g. WIAWIS ATF" />
              <Input label={t('equipment.length')} value={form.riser_length} onChange={e => set('riser_length')(e.target.value)} disabled={isReadOnly} placeholder={'e.g. 25"'} />
            </div>
          </SectionCard>

          {/* LIMBS */}
          <SectionCard title={t('equipment.limbs')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <Input label={t('equipment.brand')} value={form.limb_brand} onChange={e => set('limb_brand')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Uukha" />
              <Input label={t('equipment.model')} value={form.limb_model} onChange={e => set('limb_model')(e.target.value)} disabled={isReadOnly} placeholder="e.g. VX+" />
              <Input label={t('equipment.length')} value={form.limb_length} onChange={e => set('limb_length')(e.target.value)} disabled={isReadOnly} placeholder='e.g. Long' />
              <Input label={t('equipment.poundage')} type="number" step="0.5" min="0" max="80" value={form.limb_poundage} onChange={e => set('limb_poundage')(e.target.value)} disabled={isReadOnly} placeholder="e.g. 38" />
            </div>
          </SectionCard>

          {/* DRAW */}
          <SectionCard title={t('equipment.draw')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label={t('equipment.drawLengthIn')} type="number" step="0.25" min="20" max="36" value={form.draw_length} onChange={e => set('draw_length')(e.target.value)} disabled={isReadOnly} placeholder='e.g. 28.5' />
              <Input label={t('equipment.drawWeightLbs')} type="number" step="0.5" min="0" max="80" value={form.draw_weight} onChange={e => set('draw_weight')(e.target.value)} disabled={isReadOnly} placeholder="e.g. 36" />
            </div>
          </SectionCard>

          {/* STRING */}
          <SectionCard title={t('equipment.string')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label={t('equipment.brand')} value={form.string_brand} onChange={e => set('string_brand')(e.target.value)} disabled={isReadOnly} placeholder="e.g. BCY" />
              <Input label={t('equipment.material')} value={form.string_material} onChange={e => set('string_material')(e.target.value)} disabled={isReadOnly} placeholder="e.g. 8125G" />
            </div>
          </SectionCard>

          {/* ARROWS */}
          <SectionCard title={t('equipment.arrows')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <Input label={t('equipment.brand')} value={form.arrow_brand} onChange={e => set('arrow_brand')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Easton" />
              <Input label={t('equipment.model')} value={form.arrow_model} onChange={e => set('arrow_model')(e.target.value)} disabled={isReadOnly} placeholder="e.g. ACE" />
              <Input label={t('equipment.spine')} type="number" step="1" min="0" value={form.arrow_spine} onChange={e => set('arrow_spine')(e.target.value)} disabled={isReadOnly} placeholder="e.g. 570" />
              <Input label={t('equipment.lengthCm')} type="number" step="0.1" min="50" max="90" value={form.arrow_length} onChange={e => set('arrow_length')(e.target.value)} disabled={isReadOnly} placeholder="e.g. 71.5" />
              <Input label={t('equipment.pointWeight')} type="number" step="1" min="0" value={form.point_weight} onChange={e => set('point_weight')(e.target.value)} disabled={isReadOnly} placeholder="e.g. 100" />
              <Input label={t('equipment.nock')} value={form.nock} onChange={e => set('nock')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Pin nock" />
              <Input label={t('equipment.vane')} value={form.vane} onChange={e => set('vane')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Beiter" />
            </div>
          </SectionCard>

          {/* SIGHT */}
          <SectionCard title={t('equipment.sight')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label={t('equipment.brand')} value={form.sight_brand} onChange={e => set('sight_brand')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Shibuya" />
              <Input label={t('equipment.model')} value={form.sight_model} onChange={e => set('sight_model')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Ultima RC" />
            </div>
          </SectionCard>

          {/* STABILIZER */}
          <SectionCard title={t('equipment.stabilizer')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label={t('equipment.brand')} value={form.stabilizer_brand} onChange={e => set('stabilizer_brand')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Bee Stinger" />
              <Input label={t('equipment.model')} value={form.stabilizer_model} onChange={e => set('stabilizer_model')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Sport Hunter" />
            </div>
          </SectionCard>

          {/* ACCESSORIES */}
          <SectionCard title={t('equipment.accessories')}>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <Input label={t('equipment.arrowRest')} value={form.arrow_rest} onChange={e => set('arrow_rest')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Magnetic" />
              <Input label={t('equipment.plunger')} value={form.plunger} onChange={e => set('plunger')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Shibuya DX" />
              <Input label={t('equipment.clicker')} value={form.clicker} onChange={e => set('clicker')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Magnetic" />
              <Input label={t('equipment.scope')} value={form.scope} onChange={e => set('scope')(e.target.value)} disabled={isReadOnly} placeholder="e.g. 6× lens" />
              <Input label={t('equipment.peep')} value={form.peep} onChange={e => set('peep')(e.target.value)} disabled={isReadOnly} placeholder={'e.g. 1/4" peep'} />
              <Input label={t('equipment.release')} value={form.release} onChange={e => set('release')(e.target.value)} disabled={isReadOnly} placeholder="e.g. T-Handle" />
              <Input label={t('equipment.fingerTab')} value={form.finger_tab} onChange={e => set('finger_tab')(e.target.value)} disabled={isReadOnly} placeholder="e.g. AAE Max" />
              <Input label={t('equipment.sling')} value={form.sling} onChange={e => set('sling')(e.target.value)} disabled={isReadOnly} placeholder="e.g. Wrist sling" />
            </div>
          </SectionCard>

          {/* NOTES */}
          <SectionCard title={t('common.notes')}>
            <Textarea
              value={form.notes}
              onChange={e => set('notes')(e.target.value)}
              disabled={isReadOnly}
              minRows={4}
              placeholder={t('equipment.notesPlaceholder')}
            />
          </SectionCard>

          {/* Bottom save bar (visible on mobile above BottomTabBar) */}
          {!isReadOnly && (
            <div className="flex justify-end gap-2 pt-2 pb-4">
              <Button variant="ghost" onClick={handleReset} disabled={!dirty || saving}>
                {t('common.reset')}
              </Button>
              <Button onClick={() => save()} loading={saving} disabled={!dirty}>
                {t('equipment.saveEquipment')}
              </Button>
            </div>
          )}

          {!equipment && !isLoading && (
            <EmptyState
              title={t('equipment.noProfileYet')}
              description={t('equipment.noProfileYetHint')}
            />
          )}
        </div>
      )}
    </PageWrapper>
  )
}

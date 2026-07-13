import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, StatCard, Modal, ConfirmDialog, Input, Select, EmptyState, useToast } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import { writeAuditLog } from '@/services/auditLog'
import { canAccessAdmin2 } from '@/lib/permissions'
import { FACE_OPTIONS, getFace, DEFAULT_FACE_SLUG } from '@/components/forms/targetFaces'
import { cn } from '@/utils/cn'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface RoundRow {
  id: string
  name: string
  total_arrows: number
  max_score: number
  distance_m: number | null
  arrows_per_end: number | null
  ends: number | null
  target_face: string | null
  category: string | null
  bow_categories: string[] | null
  active: boolean
  created_at: string
}

interface RoundForm {
  name: string
  category: string
  distance_m: string
  ends: string
  arrows_per_end: string
  max_score: string
  target_face: string
  bow_categories: string[]
  active: boolean
}

// scoring.rounds.category values (migration 024). Labels resolved via i18n.
const ROUND_CATEGORIES = ['training', 'practice', 'tournament', 'selection'] as const
// bow_category enum values (migration 001). Which disciplines a round is for.
const BOW_CATS = ['recurve', 'compound', 'barebow', 'traditional', 'longbow'] as const

const DEFAULT_FORM: RoundForm = {
  name: '', category: 'training', distance_m: '', ends: '6', arrows_per_end: '6',
  max_score: '', target_face: DEFAULT_FACE_SLUG, bow_categories: [], active: true,
}

// ─── PAGE ────────────────────────────────────────────────────────────────────

export default function RoundsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()

  if (!canAccessAdmin2(profile?.role)) return <AccessDenied />

  const { data: rounds = [], isLoading } = useQuery<RoundRow[]>({
    queryKey: ['rounds-management'],
    queryFn: async () => {
      const { data, error } = await supabase.from('rounds').select('*').order('name')
      if (error) throw error
      return (data ?? []) as RoundRow[]
    },
  })

  const [search, setSearch] = useState('')
  const [fActive, setFActive] = useState('all')
  const [modal, setModal] = useState<{ open: boolean; item: RoundRow | null }>({ open: false, item: null })
  const [form, setForm] = useState<RoundForm>(DEFAULT_FORM)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof RoundForm, string>>>({})
  const [confirm, setConfirm] = useState<{ open: boolean; item: RoundRow | null; action: 'archive' | 'reactivate' }>({ open: false, item: null, action: 'archive' })

  const total = rounds.length
  const active = rounds.filter(r => r.active).length

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return rounds.filter(r => {
      if (fActive === 'active' && !r.active) return false
      if (fActive === 'inactive' && r.active) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [rounds, search, fActive])

  const totalArrowsPreview = (parseInt(form.ends, 10) || 0) * (parseInt(form.arrows_per_end, 10) || 0)

  // ── mutations ──
  const saveMut = useMutation({
    mutationFn: async () => {
      const ends = parseInt(form.ends, 10)
      const ape  = parseInt(form.arrows_per_end, 10)
      const payload = {
        name:           form.name.trim(),
        category:       form.category,
        distance_m:     form.distance_m ? parseInt(form.distance_m, 10) : null,
        ends,
        arrows_per_end: ape,
        total_arrows:   ends * ape,
        max_score:      parseInt(form.max_score, 10),
        target_face:    form.target_face,
        bow_categories: form.bow_categories.length ? form.bow_categories : null,
        active:         form.active,
      }
      if (modal.item) {
        const { error } = await supabase.from('rounds').update(payload).eq('id', modal.item.id)
        if (error) throw error
        writeAuditLog(profile!.id, 'round.updated', 'round', modal.item.id, { name: payload.name }).catch(console.warn)
      } else {
        const { data, error } = await supabase.from('rounds').insert(payload).select('id').single()
        if (error) throw error
        writeAuditLog(profile!.id, 'round.created', 'round', data.id, { name: payload.name }).catch(console.warn)
      }
    },
    onSuccess: () => {
      ok(modal.item ? t('roundsPage.updated') : t('roundsPage.created'))
      qc.invalidateQueries({ queryKey: ['rounds-management'] })
      qc.invalidateQueries({ queryKey: ['rounds'] })
      qc.invalidateQueries({ queryKey: ['rounds-active'] })
      setModal({ open: false, item: null })
    },
    onError: (e: Error) => err(e.message),
  })

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!confirm.item) return
      const nextActive = confirm.action === 'reactivate'
      const { error } = await supabase.from('rounds').update({ active: nextActive }).eq('id', confirm.item.id)
      if (error) throw error
      writeAuditLog(profile!.id, nextActive ? 'round.reactivated' : 'round.archived', 'round', confirm.item.id, { name: confirm.item.name }).catch(console.warn)
    },
    onSuccess: () => {
      ok(confirm.action === 'archive' ? t('roundsPage.archived') : t('roundsPage.reactivated'))
      qc.invalidateQueries({ queryKey: ['rounds-management'] })
      qc.invalidateQueries({ queryKey: ['rounds'] })
      qc.invalidateQueries({ queryKey: ['rounds-active'] })
      setConfirm(c => ({ ...c, open: false }))
    },
    onError: (e: Error) => err(e.message),
  })

  // ── modal helpers ──
  function openCreate() {
    setForm(DEFAULT_FORM); setFormErrors({}); setModal({ open: true, item: null })
  }
  function openEdit(item: RoundRow) {
    setForm({
      name:           item.name,
      category:       item.category ?? 'training',
      distance_m:     item.distance_m != null ? String(item.distance_m) : '',
      ends:           item.ends != null ? String(item.ends) : '',
      arrows_per_end: item.arrows_per_end != null ? String(item.arrows_per_end) : '',
      max_score:      String(item.max_score),
      target_face:    item.target_face ?? DEFAULT_FACE_SLUG,
      bow_categories: item.bow_categories ?? [],
      active:         item.active,
    })
    setFormErrors({}); setModal({ open: true, item })
  }

  /** Prefill the create form from an existing round — change one field, save. */
  function openDuplicate(item: RoundRow) {
    setForm({
      name:           `${item.name} ${t('roundsPage.copySuffix')}`,
      category:       item.category ?? 'training',
      distance_m:     item.distance_m != null ? String(item.distance_m) : '',
      ends:           item.ends != null ? String(item.ends) : '',
      arrows_per_end: item.arrows_per_end != null ? String(item.arrows_per_end) : '',
      max_score:      String(item.max_score),
      target_face:    item.target_face ?? DEFAULT_FACE_SLUG,
      bow_categories: item.bow_categories ?? [],
      active:         true,
    })
    setFormErrors({}); setModal({ open: true, item: null })
  }
  function setField<K extends keyof RoundForm>(k: K, v: RoundForm[K]) { setForm(f => ({ ...f, [k]: v })) }

  function validate(): boolean {
    const e: Partial<Record<keyof RoundForm, string>> = {}
    if (!form.name.trim()) e.name = t('roundsPage.nameRequired')
    if (!form.ends || parseInt(form.ends, 10) < 1) e.ends = t('roundsPage.endsMin')
    if (!form.arrows_per_end || parseInt(form.arrows_per_end, 10) < 1) e.arrows_per_end = t('roundsPage.arrowsMin')
    if (!form.max_score || parseInt(form.max_score, 10) < 1) e.max_score = t('roundsPage.maxScoreRequired')
    if (form.distance_m && parseInt(form.distance_m, 10) < 1) e.distance_m = t('roundsPage.invalidDistance')
    setFormErrors(e)
    return Object.keys(e).length === 0
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('roundsPage.title')}
        description={t('roundsPage.description')}
        action={<Button onClick={openCreate}>+ {t('roundsPage.createRound')}</Button>}
      />

      <div className="grid grid-cols-3 gap-3 mb-5">
        <StatCard label={t('roundsPage.totalRounds')} value={total} accent />
        <StatCard label={t('status.active')}       value={active} />
        <StatCard label={t('status.inactive')}     value={total - active} />
      </div>

      <SectionCard className="mb-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder={t('roundsPage.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            wrapperClassName="flex-1 min-w-[200px]"
          />
          <Select
            options={[
              { value: 'all', label: t('common.allStatuses') },
              { value: 'active', label: t('status.active') },
              { value: 'inactive', label: t('status.inactive') },
            ]}
            value={fActive}
            onChange={e => setFActive(e.target.value)}
            wrapperClassName="w-[160px]"
          />
        </div>
      </SectionCard>

      <SectionCard>
        {isLoading ? (
          <p className="text-sm text-text-dim py-4 text-center">{t('roundsPage.loading')}</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search || fActive !== 'all' ? t('roundsPage.noMatch') : t('roundsPage.noRoundsYet')}
            action={!search && fActive === 'all' ? <Button onClick={openCreate}>{t('roundsPage.createRound')}</Button> : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map(r => (
              <div key={r.id} className={cn('border border-line rounded-[var(--r-md)] p-4 flex flex-wrap items-start justify-between gap-3', !r.active && 'opacity-70')}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{r.name}</span>
                    <Badge variant={(r.category ?? 'training') === 'tournament' ? 'warning' : 'primary'}>
                      {t(`roundCategories.${r.category ?? 'training'}`)}
                    </Badge>
                    <Badge variant={r.active ? 'success' : 'neutral'}>{r.active ? t('status.active') : t('status.inactive')}</Badge>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-text-dim">
                    {r.distance_m != null && <span>{r.distance_m}m</span>}
                    <span>
                      {r.ends != null && r.arrows_per_end != null
                        ? t('roundsPage.structure', { ends: r.ends, ape: r.arrows_per_end, total: r.total_arrows })
                        : t('roundsPage.arrowsOnly', { total: r.total_arrows })}
                    </span>
                    <span>{t('roundsPage.maxShort')} {r.max_score}</span>
                    <span>{t('roundsPage.face')}: {getFace(r.target_face).name}</span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => openDuplicate(r)}>{t('common.duplicate')}</Button>
                  <Button size="sm" variant="outline" onClick={() => openEdit(r)}>{t('common.edit')}</Button>
                  {r.active
                    ? <Button size="sm" variant="danger" onClick={() => setConfirm({ open: true, item: r, action: 'archive' })}>{t('common.archive')}</Button>
                    : <Button size="sm" variant="success" onClick={() => setConfirm({ open: true, item: r, action: 'reactivate' })}>{t('common.reactivate')}</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Create / Edit modal */}
      <Modal
        open={modal.open}
        onClose={() => setModal({ open: false, item: null })}
        title={modal.item ? t('roundsPage.editRound') : t('roundsPage.createRound')}
        width="min(560px,100%)"
      >
        <div className="space-y-4">
          <Input
            label={t('roundsPage.roundName')}
            value={form.name}
            onChange={e => setField('name', e.target.value)}
            error={formErrors.name}
            placeholder={t('roundsPage.namePlaceholder')}
          />
          <Select
            label={t('roundsPage.category')}
            options={ROUND_CATEGORIES.map(c => ({ value: c, label: t(`roundCategories.${c}`) }))}
            value={form.category}
            onChange={e => setField('category', e.target.value)}
            hint={t('roundsPage.categoryHint')}
          />

          {/* Bow disciplines this round is for — archers only see rounds that
              match a discipline they shoot. */}
          <div>
            <label className="text-[12px] font-semibold text-text-dim block mb-1.5">{t('roundsPage.bowCategories')}</label>
            <div className="flex flex-wrap gap-2">
              {BOW_CATS.map((b) => {
                const on = form.bow_categories.includes(b)
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setField('bow_categories', on
                      ? form.bow_categories.filter((x) => x !== b)
                      : [...form.bow_categories, b])}
                    className={[
                      'px-3 py-1.5 rounded-[var(--r)] text-sm font-semibold border transition-all capitalize',
                      on ? 'bg-primary text-on-primary border-primary'
                         : 'bg-surface border-line text-text-dim hover:border-line-strong',
                    ].join(' ')}
                  >
                    {t(`bowCategories.${b}`)}
                  </button>
                )
              })}
            </div>
            <p className="text-[12px] text-text-faint mt-1">{t('roundsPage.bowCategoriesHint')}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label={t('roundsPage.distanceM')}
              type="number"
              value={form.distance_m}
              onChange={e => setField('distance_m', e.target.value)}
              error={formErrors.distance_m}
              placeholder={t('roundsPage.distancePlaceholder')}
              hint={t('roundsPage.distanceHint')}
            />
            <Select
              label={t('roundsPage.targetFace')}
              options={FACE_OPTIONS}
              value={form.target_face}
              onChange={e => setField('target_face', e.target.value)}
              hint={t('roundsPage.faceHint')}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label={t('roundsPage.ends')}
              type="number"
              value={form.ends}
              onChange={e => setField('ends', e.target.value)}
              error={formErrors.ends}
            />
            <Input
              label={t('roundsPage.arrowsPerEnd')}
              type="number"
              value={form.arrows_per_end}
              onChange={e => setField('arrows_per_end', e.target.value)}
              error={formErrors.arrows_per_end}
            />
            <Input
              label={t('roundsPage.maxScore')}
              type="number"
              value={form.max_score}
              onChange={e => setField('max_score', e.target.value)}
              error={formErrors.max_score}
              placeholder={t('roundsPage.maxScorePlaceholder')}
            />
          </div>
          <p className="text-xs text-text-dim">
            {t('roundsPage.totalArrows')}: <strong className="text-text">{totalArrowsPreview || '—'}</strong>
            {totalArrowsPreview > 0 && form.max_score && ` · ${t('roundsPage.maxPossible', { max: totalArrowsPreview * 10 })}`}
          </p>

          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => setField('active', e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium">{t('roundsPage.activeHint')}</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setModal({ open: false, item: null })}>{t('common.cancel')}</Button>
            <Button onClick={() => { if (validate()) saveMut.mutate() }} loading={saveMut.isPending}>
              {modal.item ? t('common.saveChanges') : t('roundsPage.createRound')}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm(c => ({ ...c, open: false }))}
        onConfirm={() => confirmMut.mutate()}
        loading={confirmMut.isPending}
        title={confirm.action === 'archive' ? t('roundsPage.archiveRound') : t('roundsPage.reactivateRound')}
        message={
          confirm.action === 'archive'
            ? t('roundsPage.archiveConfirm', { name: confirm.item?.name ?? '' })
            : t('statesPage.reactivateConfirm', { name: confirm.item?.name ?? '' })
        }
        confirmLabel={confirm.action === 'archive' ? t('common.archive') : t('common.reactivate')}
        destructive={confirm.action === 'archive'}
      />
    </PageWrapper>
  )
}

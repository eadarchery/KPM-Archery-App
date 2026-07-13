import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, StatCard, Modal, ConfirmDialog, Input, Select, EmptyState, useToast, ListSkeleton } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'
import { canAccessAdmin2 } from '@/lib/permissions'
import {
  getPLDs, getActiveStates, createPLD, updatePLD, archivePLD, reactivatePLD,
  type OrgPLD, type PLDPayload,
} from '@/services/organization'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface PLDForm {
  name: string
  code: string
  state_id: string
  active: boolean
}

const DEFAULT_FORM: PLDForm = { name: '', code: '', state_id: '', active: true }

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function PLDsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()

  if (!canAccessAdmin2(profile?.role)) return <AccessDenied />

  // ── data ──
  const { data: plds = [], isLoading, isError, refetch } = useQuery({ queryKey: ['plds-management'], queryFn: getPLDs })
  const { data: activeStates = [] }     = useQuery({ queryKey: ['active-states'], queryFn: getActiveStates })

  // ── local state ──
  const [search, setSearch]         = useState('')
  const [fState, setFState]         = useState('')
  const [fActive, setFActive]       = useState('all')
  const [modal, setModal]           = useState<{ open: boolean; item: OrgPLD | null }>({ open: false, item: null })
  const [form, setForm]             = useState<PLDForm>(DEFAULT_FORM)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof PLDForm, string>>>({})
  const [confirm, setConfirm]       = useState<{ open: boolean; item: OrgPLD | null; action: 'archive' | 'reactivate' }>({ open: false, item: null, action: 'archive' })

  // ── stat cards ──
  const total    = plds.length
  const active   = plds.filter(p => p.active).length
  const inactive = plds.filter(p => !p.active).length
  const statesCovered  = new Set(plds.map(p => p.state_id)).size
  const totalSchools   = plds.reduce((acc, p) => acc + p.school_count, 0)

  // ── filtering ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return plds.filter(p => {
      if (fActive === 'active'   && !p.active) return false
      if (fActive === 'inactive' &&  p.active) return false
      if (fState && p.state_id !== fState) return false
      if (q) {
        const hit = p.name.toLowerCase().includes(q)
          || (p.code ?? '').toLowerCase().includes(q)
          || p.state_name.toLowerCase().includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [plds, search, fActive, fState])

  // ── mutations ──
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: PLDPayload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        state_id: form.state_id,
        active: form.active,
      }
      if (modal.item) await updatePLD(modal.item.id, payload)
      else await createPLD(payload)
    },
    onSuccess: () => {
      ok(modal.item ? t('pldsPage.updated') : t('pldsPage.created'))
      qc.invalidateQueries({ queryKey: ['plds-management'] })
      closeModal()
    },
    onError: (e: Error) => err(e.message),
  })

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!confirm.item) return
      if (confirm.action === 'archive') await archivePLD(confirm.item.id)
      else await reactivatePLD(confirm.item.id)
    },
    onSuccess: () => {
      ok(confirm.action === 'archive' ? t('pldsPage.archived') : t('pldsPage.reactivated'))
      qc.invalidateQueries({ queryKey: ['plds-management'] })
      setConfirm(c => ({ ...c, open: false }))
    },
    onError: (e: Error) => err(e.message),
  })

  // ── modal helpers ──
  function openCreate() {
    setForm(DEFAULT_FORM)
    setFormErrors({})
    setModal({ open: true, item: null })
  }

  function openEdit(item: OrgPLD) {
    setForm({ name: item.name, code: item.code ?? '', state_id: item.state_id, active: item.active })
    setFormErrors({})
    setModal({ open: true, item })
  }

  function closeModal() { setModal({ open: false, item: null }) }

  function validate(): boolean {
    const errors: Partial<Record<keyof PLDForm, string>> = {}
    if (!form.name.trim()) errors.name = t('pldsPage.nameRequired')
    if (!form.state_id)    errors.state_id = t('pldsPage.stateRequired')
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  function handleSave() {
    if (!validate()) return
    saveMut.mutate()
  }

  // ── dropdown options ──
  const stateFilterOptions = [
    { value: '', label: t('common.allStates') },
    ...activeStates.map(s => ({ value: s.id, label: `${s.name} (${s.code})` })),
  ]

  const stateSelectOptions = [
    { value: '', label: `— ${t('stateReport.selectState').replace('…', '')} —`, disabled: true },
    ...activeStates.map(s => ({ value: s.id, label: `${s.name} (${s.code})` })),
  ]

  const activeFilterOptions = [
    { value: 'all', label: t('common.allStatuses') },
    { value: 'active', label: t('status.active') },
    { value: 'inactive', label: t('status.inactive') },
  ]

  // Warn if selected state is inactive (for modal)
  const selectedState = activeStates.find(s => s.id === form.state_id)

  return (
    <PageWrapper>
      <PageHead
        title={t('pldsPage.title')}
        description={t('pldsPage.description')}
        action={<Button onClick={openCreate}>+ {t('pldsPage.createPld')}</Button>}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <StatCard label={t('statesPage.totalPlds')}      value={total}         accent />
        <StatCard label={t('status.active')}          value={active}        />
        <StatCard label={t('status.inactive')}        value={inactive}      />
        <StatCard label={t('pldsPage.statesCovered')}  value={statesCovered} />
        <StatCard label={t('statesPage.totalSchools')}   value={totalSchools}  />
      </div>

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder={t('pldsPage.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            wrapperClassName="flex-1 min-w-[180px]"
          />
          <Select
            options={stateFilterOptions}
            value={fState}
            onChange={e => setFState(e.target.value)}
            wrapperClassName="w-[200px]"
          />
          <Select
            options={activeFilterOptions}
            value={fActive}
            onChange={e => setFActive(e.target.value)}
            wrapperClassName="w-[160px]"
          />
        </div>
      </SectionCard>

      {/* PLD list */}
      <SectionCard>
        {isLoading ? (
          <ListSkeleton rows={6} />
        ) : isError ? (
          <EmptyState
            tone="danger"
            title={t('common.loadFailed')}
            action={<Button variant="outline" onClick={() => refetch()}>{t('common.retry')}</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search || fActive !== 'all' || fState ? t('pldsPage.noMatch') : t('pldsPage.noPldsYet')}
            description={!search && fActive === 'all' && !fState ? t('pldsPage.noPldsYetHint') : undefined}
            action={!search && fActive === 'all' && !fState ? <Button onClick={openCreate}>{t('pldsPage.createPld')}</Button> : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map(p => (
              <PLDRow
                key={p.id}
                item={p}
                onEdit={() => openEdit(p)}
                onArchive={() => setConfirm({ open: true, item: p, action: 'archive' })}
                onReactivate={() => setConfirm({ open: true, item: p, action: 'reactivate' })}
              />
            ))}
          </div>
        )}
        {!isLoading && filtered.length > 0 && (
          <p className="text-xs text-text-faint mt-3">
            {t('pldsPage.showing', { shown: filtered.length, total })}
          </p>
        )}
      </SectionCard>

      {/* Create / Edit modal */}
      <Modal
        open={modal.open}
        onClose={closeModal}
        title={modal.item ? t('pldsPage.editPld') : t('pldsPage.createPld')}
        width="min(500px,100%)"
      >
        <div className="space-y-4">
          <Input
            label={t('pldsPage.pldName')}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            error={formErrors.name}
            placeholder={t('pldsPage.namePlaceholder')}
          />
          <Input
            label={t('pldsPage.pldCode')}
            value={form.code}
            onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder={t('pldsPage.codePlaceholder')}
            maxLength={20}
          />
          <Select
            label={t('common.state')}
            options={stateSelectOptions}
            value={form.state_id}
            onChange={e => setForm(f => ({ ...f, state_id: e.target.value }))}
            error={formErrors.state_id}
          />
          {!selectedState && form.state_id && (
            <p className="text-xs text-warning">{t('pldsPage.stateNotFound')}</p>
          )}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium">{t('status.active')}</span>
          </label>
          {!form.active && (
            <p className="text-xs text-warning">
              {t('pldsPage.inactiveWarning')}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saveMut.isPending}>
              {modal.item ? t('common.saveChanges') : t('pldsPage.createPld')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Archive / Reactivate confirm */}
      <ConfirmDialog
        open={confirm.open}
        onClose={() => setConfirm(c => ({ ...c, open: false }))}
        onConfirm={() => confirmMut.mutate()}
        loading={confirmMut.isPending}
        title={confirm.action === 'archive' ? t('pldsPage.archivePld') : t('pldsPage.reactivatePld')}
        message={
          confirm.action === 'archive'
            ? t('pldsPage.archiveConfirm', { name: confirm.item?.name ?? '' })
            : t('statesPage.reactivateConfirm', { name: confirm.item?.name ?? '' })
        }
        confirmLabel={confirm.action === 'archive' ? t('common.archive') : t('common.reactivate')}
        destructive={confirm.action === 'archive'}
      />
    </PageWrapper>
  )
}

// ─── PLD ROW ─────────────────────────────────────────────────────────────────

function PLDRow({ item, onEdit, onArchive, onReactivate }: {
  item: OrgPLD
  onEdit: () => void
  onArchive: () => void
  onReactivate: () => void
}) {
  const { t } = useLanguage()
  return (
    <div className={cn('border border-line rounded-[var(--r-md)] p-4 flex flex-wrap items-start justify-between gap-3', !item.active && 'opacity-70')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{item.name}</span>
          {item.code && <span className="text-xs font-mono text-text-faint bg-section px-2 py-0.5 rounded">{item.code}</span>}
          <Badge variant={item.active ? 'success' : 'neutral'}>{item.active ? t('status.active') : t('status.inactive')}</Badge>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-text-dim tabular-nums">
          <span className="text-text">{item.state_name}</span>
          <span>{item.school_count} {t('statesPage.schoolsLower')}</span>
          <span>{t('statesPage.createdOn')} {formatDate(item.created_at)}</span>
          {item.updated_at !== item.created_at && <span>{t('statesPage.updatedOn')} {formatDate(item.updated_at)}</span>}
        </div>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        <Button size="sm" variant="outline" onClick={onEdit}>{t('common.edit')}</Button>
        {item.active
          ? <Button size="sm" variant="danger" onClick={onArchive}>{t('common.archive')}</Button>
          : <Button size="sm" variant="success" onClick={onReactivate}>{t('common.reactivate')}</Button>
        }
      </div>
    </div>
  )
}

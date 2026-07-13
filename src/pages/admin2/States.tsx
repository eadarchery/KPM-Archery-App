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
  getStates, createState, updateState, archiveState, reactivateState,
  type OrgState, type StatePayload,
} from '@/services/organization'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface StateForm {
  name: string
  code: string
  active: boolean
}

const DEFAULT_FORM: StateForm = { name: '', code: '', active: true }

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function StatesPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()

  // ── guards ──
  if (!canAccessAdmin2(profile?.role)) return <AccessDenied />

  // ── data ──
  const { data: states = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['states-management'],
    queryFn: getStates,
  })

  // ── local state ──
  const [search, setSearch]       = useState('')
  const [fActive, setFActive]     = useState('all')
  const [modal, setModal]         = useState<{ open: boolean; item: OrgState | null }>({ open: false, item: null })
  const [form, setForm]           = useState<StateForm>(DEFAULT_FORM)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof StateForm, string>>>({})
  const [confirm, setConfirm]     = useState<{ open: boolean; item: OrgState | null; action: 'archive' | 'reactivate' }>({ open: false, item: null, action: 'archive' })

  // ── stat cards ──
  const total    = states.length
  const active   = states.filter(s => s.active).length
  const inactive = states.filter(s => !s.active).length
  const totalPLDs    = states.reduce((acc, s) => acc + s.pld_count, 0)
  const totalSchools = states.reduce((acc, s) => acc + s.school_count, 0)

  // ── filtering ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return states.filter(s => {
      if (fActive === 'active'   && !s.active) return false
      if (fActive === 'inactive' &&  s.active) return false
      if (q && !s.name.toLowerCase().includes(q) && !s.code.toLowerCase().includes(q)) return false
      return true
    })
  }, [states, search, fActive])

  // ── mutations ──
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: StatePayload = { name: form.name.trim(), code: form.code.trim().toUpperCase(), active: form.active }
      if (modal.item) await updateState(modal.item.id, payload)
      else await createState(payload)
    },
    onSuccess: () => {
      ok(modal.item ? t('statesPage.updated') : t('statesPage.created'))
      qc.invalidateQueries({ queryKey: ['states-management'] })
      closeModal()
    },
    onError: (e: Error) => err(e.message),
  })

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!confirm.item) return
      if (confirm.action === 'archive') await archiveState(confirm.item.id)
      else await reactivateState(confirm.item.id)
    },
    onSuccess: () => {
      ok(confirm.action === 'archive' ? t('statesPage.archived') : t('statesPage.reactivated'))
      qc.invalidateQueries({ queryKey: ['states-management'] })
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

  function openEdit(item: OrgState) {
    setForm({ name: item.name, code: item.code, active: item.active })
    setFormErrors({})
    setModal({ open: true, item })
  }

  function closeModal() { setModal({ open: false, item: null }) }

  function validate(): boolean {
    const errors: Partial<Record<keyof StateForm, string>> = {}
    if (!form.name.trim()) errors.name = t('statesPage.nameRequired')
    if (!form.code.trim()) errors.code = t('statesPage.codeRequired')
    setFormErrors(errors)
    return Object.keys(errors).length === 0
  }

  function handleSave() {
    if (!validate()) return
    saveMut.mutate()
  }

  const activeOptions = [
    { value: 'all', label: t('common.allStatuses') },
    { value: 'active', label: t('status.active') },
    { value: 'inactive', label: t('status.inactive') },
  ]

  return (
    <PageWrapper>
      <PageHead
        title={t('statesPage.title')}
        description={t('statesPage.description')}
        action={<Button onClick={openCreate}>+ {t('statesPage.createState')}</Button>}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <StatCard label={t('statesPage.totalStates')}  value={total}        accent />
        <StatCard label={t('status.active')}        value={active}       />
        <StatCard label={t('status.inactive')}      value={inactive}     />
        <StatCard label={t('statesPage.totalPlds')}    value={totalPLDs}    />
        <StatCard label={t('statesPage.totalSchools')} value={totalSchools} />
      </div>

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder={t('statesPage.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            wrapperClassName="flex-1 min-w-[180px]"
          />
          <Select
            options={activeOptions}
            value={fActive}
            onChange={e => setFActive(e.target.value)}
            wrapperClassName="w-[180px]"
          />
        </div>
      </SectionCard>

      {/* State list */}
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
            title={search || fActive !== 'all' ? t('statesPage.noMatch') : t('statesPage.noStatesYet')}
            description={!search && fActive === 'all' ? t('statesPage.noStatesYetHint') : undefined}
            action={!search && fActive === 'all' ? <Button onClick={openCreate}>{t('statesPage.createState')}</Button> : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map(s => (
              <StateRow
                key={s.id}
                item={s}
                onEdit={() => openEdit(s)}
                onArchive={() => setConfirm({ open: true, item: s, action: 'archive' })}
                onReactivate={() => setConfirm({ open: true, item: s, action: 'reactivate' })}
              />
            ))}
          </div>
        )}
        {!isLoading && filtered.length > 0 && (
          <p className="text-xs text-text-faint mt-3">
            {t('statesPage.showing', { shown: filtered.length, total })}
          </p>
        )}
      </SectionCard>

      {/* Create / Edit modal */}
      <Modal
        open={modal.open}
        onClose={closeModal}
        title={modal.item ? t('statesPage.editState') : t('statesPage.createState')}
        width="min(480px,100%)"
      >
        <div className="space-y-4">
          <Input
            label={t('statesPage.stateName')}
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            error={formErrors.name}
            placeholder={t('statesPage.namePlaceholder')}
          />
          <Input
            label={t('statesPage.stateCode')}
            value={form.code}
            onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            error={formErrors.code}
            placeholder={t('statesPage.codePlaceholder')}
            maxLength={10}
          />
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium">{t('status.active')}</span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saveMut.isPending}>
              {modal.item ? t('common.saveChanges') : t('statesPage.createState')}
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
        title={confirm.action === 'archive' ? t('statesPage.archiveState') : t('statesPage.reactivateState')}
        message={
          confirm.action === 'archive'
            ? t('statesPage.archiveConfirm', { name: confirm.item?.name ?? '' })
            : t('statesPage.reactivateConfirm', { name: confirm.item?.name ?? '' })
        }
        confirmLabel={confirm.action === 'archive' ? t('common.archive') : t('common.reactivate')}
        destructive={confirm.action === 'archive'}
      />
    </PageWrapper>
  )
}

// ─── STATE ROW ───────────────────────────────────────────────────────────────

function StateRow({ item, onEdit, onArchive, onReactivate }: {
  item: OrgState
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
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-text-dim tabular-nums">
          <span>{item.pld_count} {t('common.pld')}</span>
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

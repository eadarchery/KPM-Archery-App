import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, StatCard, Modal, ConfirmDialog, Input, Select, EmptyState, useToast, ListSkeleton } from '@/components/ui'
import { Textarea } from '@/components/ui/Input'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { cn } from '@/utils/cn'
import { canAccessAdmin2 } from '@/lib/permissions'
import {
  getSchools, getActiveStates, getActivePLDs,
  createSchool, updateSchool, archiveSchool, reactivateSchool,
  type OrgSchool, type SchoolPayload,
} from '@/services/organization'
import { SchoolImportModal } from '@/components/forms/SchoolImportModal'
import { ImportGuideModal } from '@/components/forms/ImportGuideModal'

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface SchoolForm {
  name: string
  code: string
  reg_code: string
  state_id: string
  pld_id: string
  address: string
  contact_person: string
  contact_email: string
  contact_phone: string
  active: boolean
}

const DEFAULT_FORM: SchoolForm = {
  name: '', code: '', reg_code: '', state_id: '', pld_id: '',
  address: '', contact_person: '', contact_email: '', contact_phone: '',
  active: true,
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' })
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// ─── PAGE ─────────────────────────────────────────────────────────────────────

export default function SchoolsPage() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()
  const qc = useQueryClient()

  if (!canAccessAdmin2(profile?.role)) return <AccessDenied />

  // ── data ──
  const { data: schools = [], isLoading, isError, refetch } = useQuery({ queryKey: ['schools-management'], queryFn: getSchools })
  const { data: activeStates = [] }        = useQuery({ queryKey: ['active-states'], queryFn: getActiveStates })
  const { data: allActivePLDs = [] }       = useQuery({ queryKey: ['active-plds'], queryFn: getActivePLDs })

  // ── local state ──
  const [search, setSearch]         = useState('')
  const [fState, setFState]         = useState('')
  const [fPLD, setFPLD]             = useState('')
  const [fActive, setFActive]       = useState('all')
  const [modal, setModal]           = useState<{ open: boolean; item: OrgSchool | null }>({ open: false, item: null })
  const [form, setForm]             = useState<SchoolForm>(DEFAULT_FORM)
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof SchoolForm, string>>>({})
  const [confirm, setConfirm]       = useState<{ open: boolean; item: OrgSchool | null; action: 'archive' | 'reactivate' }>({ open: false, item: null, action: 'archive' })
  const [importOpen, setImportOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  // ── stat cards ──
  const total    = schools.length
  const active   = schools.filter(s => s.active).length
  const inactive = schools.filter(s => !s.active).length
  const statesCovered = new Set(schools.map(s => s.state_id)).size
  const pldsCovered   = new Set(schools.filter(s => s.pld_id).map(s => s.pld_id as string)).size

  // ── PLDs filtered for filter bar (by selected fState) ──
  const pldFilterOptions = useMemo(() => {
    const base = fState
      ? allActivePLDs.filter(p => p.state_id === fState)
      : allActivePLDs
    return [
      { value: '', label: t('common.allPlds') },
      ...base.map(p => ({ value: p.id, label: p.name })),
    ]
  }, [allActivePLDs, fState, t])

  // ── PLDs for modal (filtered by form.state_id) ──
  const modalPLDOptions = useMemo(() => {
    const base = form.state_id
      ? allActivePLDs.filter(p => p.state_id === form.state_id)
      : []
    return [
      { value: '', label: base.length ? t('schoolsPage.selectPld') : t('schoolsPage.selectStateFirst') },
      ...base.map(p => ({ value: p.id, label: p.name })),
    ]
  }, [allActivePLDs, form.state_id, t])

  // ── filtering ──
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return schools.filter(s => {
      if (fActive === 'active'   && !s.active) return false
      if (fActive === 'inactive' &&  s.active) return false
      if (fState && s.state_id !== fState) return false
      if (fPLD   && s.pld_id   !== fPLD)   return false
      if (q) {
        const hit =
          s.name.toLowerCase().includes(q) ||
          (s.code ?? '').toLowerCase().includes(q) ||
          (s.reg_code ?? '').toLowerCase().includes(q) ||
          s.state_name.toLowerCase().includes(q) ||
          (s.pld_name ?? '').toLowerCase().includes(q) ||
          (s.contact_person ?? '').toLowerCase().includes(q) ||
          (s.contact_email ?? '').toLowerCase().includes(q)
        if (!hit) return false
      }
      return true
    })
  }, [schools, search, fActive, fState, fPLD])

  // ── mutations ──
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: SchoolPayload = {
        name:           form.name.trim(),
        code:           form.code.trim() || null,
        reg_code:       form.reg_code.trim() || undefined,
        state_id:       form.state_id,
        pld_id:         form.pld_id || null,
        address:        form.address.trim() || null,
        contact_person: form.contact_person.trim() || null,
        contact_email:  form.contact_email.trim() || null,
        contact_phone:  form.contact_phone.trim() || null,
        active:         form.active,
      }
      if (modal.item) await updateSchool(modal.item.id, payload)
      else await createSchool(payload)
    },
    onSuccess: () => {
      ok(modal.item ? t('schoolsPage.updated') : t('schoolsPage.created'))
      qc.invalidateQueries({ queryKey: ['schools-management'] })
      closeModal()
    },
    onError: (e: Error) => err(e.message),
  })

  const confirmMut = useMutation({
    mutationFn: async () => {
      if (!confirm.item) return
      if (confirm.action === 'archive') await archiveSchool(confirm.item.id)
      else await reactivateSchool(confirm.item.id)
    },
    onSuccess: () => {
      ok(confirm.action === 'archive' ? t('schoolsPage.archived') : t('schoolsPage.reactivated'))
      qc.invalidateQueries({ queryKey: ['schools-management'] })
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

  function openEdit(item: OrgSchool) {
    setForm({
      name:           item.name,
      code:           item.code ?? '',
      reg_code:       item.reg_code ?? '',
      state_id:       item.state_id,
      pld_id:         item.pld_id ?? '',
      address:        item.address ?? '',
      contact_person: item.contact_person ?? '',
      contact_email:  item.contact_email ?? '',
      contact_phone:  item.contact_phone ?? '',
      active:         item.active,
    })
    setFormErrors({})
    setModal({ open: true, item })
  }

  function closeModal() { setModal({ open: false, item: null }) }

  function setField<K extends keyof SchoolForm>(key: K, value: SchoolForm[K]) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function handleStateChange(newStateId: string) {
    setForm(f => ({ ...f, state_id: newStateId, pld_id: '' }))
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof SchoolForm, string>> = {}
    if (!form.name.trim()) errors.name = t('schoolsPage.nameRequired')
    if (!form.state_id)    errors.state_id = t('pldsPage.stateRequired')
    const rc = form.reg_code.trim()
    if (rc) {
      if (!/^[A-Z0-9]{4,20}$/.test(rc)) errors.reg_code = t('schoolsPage.regCodeFormat')
    } else if (modal.item) {
      // Editing an existing school — its registration code cannot be blanked out.
      errors.reg_code = t('schoolsPage.regCodeRequired')
    }
    if (!form.pld_id) {
      const pldsForState = allActivePLDs.filter(p => p.state_id === form.state_id)
      if (pldsForState.length > 0) errors.pld_id = t('schoolsPage.pldRequired')
    }
    if (form.contact_email.trim() && !isValidEmail(form.contact_email.trim())) {
      errors.contact_email = t('schoolsPage.invalidEmail')
    }
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

  return (
    <PageWrapper>
      <PageHead
        title={t('schoolsPage.title')}
        description={t('schoolsPage.description')}
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setGuideOpen(true)}>{t('importGuide.openButton')}</Button>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>{t('schoolsPage.importExcel')}</Button>
            <Button onClick={openCreate}>+ {t('schoolsPage.createSchool')}</Button>
          </div>
        }
      />

      <SchoolImportModal open={importOpen} onClose={() => setImportOpen(false)} />
      <ImportGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <StatCard label={t('statesPage.totalSchools')}  value={total}         accent />
        <StatCard label={t('status.active')}         value={active}        />
        <StatCard label={t('status.inactive')}       value={inactive}      />
        <StatCard label={t('pldsPage.statesCovered')} value={statesCovered} />
        <StatCard label={t('schoolsPage.pldsCovered')}   value={pldsCovered}   />
      </div>

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder={t('schoolsPage.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            wrapperClassName="flex-1 min-w-[220px]"
          />
          <Select
            options={stateFilterOptions}
            value={fState}
            onChange={e => { setFState(e.target.value); setFPLD('') }}
            wrapperClassName="w-[200px]"
          />
          <Select
            options={pldFilterOptions}
            value={fPLD}
            onChange={e => setFPLD(e.target.value)}
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

      {/* School list */}
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
            title={search || fActive !== 'all' || fState || fPLD ? t('schoolsPage.noMatch') : t('schoolsPage.noSchoolsYet')}
            description={!search && fActive === 'all' && !fState && !fPLD ? t('schoolsPage.noSchoolsYetHint') : undefined}
            action={!search && fActive === 'all' && !fState && !fPLD ? <Button onClick={openCreate}>{t('schoolsPage.createSchool')}</Button> : undefined}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map(s => (
              <SchoolRow
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
            {t('schoolsPage.showing', { shown: filtered.length, total })}
          </p>
        )}
      </SectionCard>

      {/* Create / Edit modal */}
      <Modal
        open={modal.open}
        onClose={closeModal}
        title={modal.item ? t('schoolsPage.editSchool') : t('schoolsPage.createSchool')}
        width="min(600px,100%)"
      >
        <div className="space-y-4">
          {/* Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label={t('schoolsPage.schoolName')}
              value={form.name}
              onChange={e => setField('name', e.target.value)}
              error={formErrors.name}
              placeholder={t('schoolsPage.namePlaceholder')}
              wrapperClassName="sm:col-span-2"
            />
            <Input
              label={t('schoolsPage.schoolCode')}
              value={form.code}
              onChange={e => setField('code', e.target.value.toUpperCase())}
              placeholder={t('schoolsPage.codePlaceholder')}
              maxLength={20}
            />
          </div>

          {/* Registration code — archers type this at sign-up */}
          <div>
            <Input
              label={t('schoolsPage.regCode')}
              value={form.reg_code}
              onChange={e => setField('reg_code', e.target.value.toUpperCase().replace(/\s/g, ''))}
              error={formErrors.reg_code}
              placeholder={modal.item ? '' : t('schoolsPage.regCodeAutoPlaceholder')}
              maxLength={20}
            />
            <p className="text-xs text-text-dim mt-1">
              {t('schoolsPage.regCodeHint')}{' '}
              {modal.item
                ? t('schoolsPage.regCodeChangeWarning')
                : t('schoolsPage.regCodeAutoHint')}
            </p>
          </div>

          {/* Organisation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label={t('common.state')}
              options={stateSelectOptions}
              value={form.state_id}
              onChange={e => handleStateChange(e.target.value)}
              error={formErrors.state_id}
            />
            <Select
              label={t('common.pld')}
              options={modalPLDOptions}
              value={form.pld_id}
              onChange={e => setField('pld_id', e.target.value)}
              error={formErrors.pld_id}
              disabled={!form.state_id}
            />
          </div>
          {form.state_id && allActivePLDs.filter(p => p.state_id === form.state_id).length === 0 && (
            <p className="text-xs text-text-dim -mt-2">{t('schoolsPage.noPldsForState')}</p>
          )}

          {/* Address */}
          <Textarea
            label={t('schoolsPage.address')}
            value={form.address}
            onChange={e => setField('address', e.target.value)}
            placeholder={t('schoolsPage.addressPlaceholder')}
            minRows={2}
          />

          {/* Contact */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label={t('schoolsPage.contactPerson')}
              value={form.contact_person}
              onChange={e => setField('contact_person', e.target.value)}
              placeholder={t('schoolsPage.contactPersonPlaceholder')}
            />
            <Input
              label={t('schoolsPage.contactEmail')}
              type="email"
              value={form.contact_email}
              onChange={e => setField('contact_email', e.target.value)}
              error={formErrors.contact_email}
              placeholder={t('schoolsPage.contactEmailPlaceholder')}
            />
            <Input
              label={t('schoolsPage.contactPhone')}
              value={form.contact_phone}
              onChange={e => setField('contact_phone', e.target.value)}
              placeholder={t('schoolsPage.contactPhonePlaceholder')}
            />
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.active}
              onChange={e => setField('active', e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm font-medium">{t('status.active')}</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={closeModal}>{t('common.cancel')}</Button>
            <Button onClick={handleSave} loading={saveMut.isPending}>
              {modal.item ? t('common.saveChanges') : t('schoolsPage.createSchool')}
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
        title={confirm.action === 'archive' ? t('schoolsPage.archiveSchool') : t('schoolsPage.reactivateSchool')}
        message={
          confirm.action === 'archive'
            ? t('schoolsPage.archiveConfirm', { name: confirm.item?.name ?? '' })
            : t('statesPage.reactivateConfirm', { name: confirm.item?.name ?? '' })
        }
        confirmLabel={confirm.action === 'archive' ? t('common.archive') : t('common.reactivate')}
        destructive={confirm.action === 'archive'}
      />
    </PageWrapper>
  )
}

// ─── SCHOOL ROW ──────────────────────────────────────────────────────────────

function SchoolRow({ item, onEdit, onArchive, onReactivate }: {
  item: OrgSchool
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
          {item.reg_code && (
            <span
              className="text-xs font-mono font-bold tracking-wider px-2 py-0.5 rounded"
              style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
              title={t('schoolsPage.regCodeTooltip')}
            >
              {t('schoolsPage.regShort')}: {item.reg_code}
            </span>
          )}
          <Badge variant={item.active ? 'success' : 'neutral'}>{item.active ? t('status.active') : t('status.inactive')}</Badge>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-text-dim">
          <span>{item.state_name}{item.pld_name ? ` › ${item.pld_name}` : ''}</span>
          {item.contact_person && <span>{item.contact_person}</span>}
          {item.contact_email  && <span>{item.contact_email}</span>}
          {item.contact_phone  && <span>{item.contact_phone}</span>}
        </div>
        <div className="text-xs text-text-faint mt-0.5 tabular-nums">
          {t('statesPage.createdOn')} {formatDate(item.created_at)}
          {item.updated_at !== item.created_at && ` · ${t('statesPage.updatedOn')} ${formatDate(item.updated_at)}`}
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

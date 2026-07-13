import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { NotificationInbox } from '@/components/notifications/NotificationInbox'
import {
  Button,
  StatCard,
  Badge,
  Modal,
  ConfirmDialog,
  Input,
  Textarea,
  Select,
  EmptyState,
  useToast,
} from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { supabase } from '@/services/supabase'
import {
  getAllNotificationsAdmin,
  createNotification,
  updateNotification,
  publishNotification,
  archiveNotification,
  deleteNotification,
  type NotifPayload,
} from '@/services/notifications'
import { writeAuditLog } from '@/services/auditLog'
import { uploadArticleImage } from '@/components/articles/BlockEditor'
import { formatDate, timeAgo } from '@/utils/dates'
import { cn } from '@/utils/cn'
import type {
  Notification,
  NotificationAudience,
  NotificationCategory,
  NotificationPriority,
  NotificationStatus,
} from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

type DisplayStatus = NotificationStatus | 'expired'
type TabKey = 'all' | 'draft' | 'scheduled' | 'published' | 'archived'
interface OrgItem { id: string; name: string }

type NotifDerived = Notification & { _status: DisplayStatus }

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const TABS: { key: TabKey; labelKey: string }[] = [
  { key: 'all',       labelKey: 'common.all'       },
  { key: 'draft',     labelKey: 'status.draft'     },
  { key: 'scheduled', labelKey: 'status.scheduled' },
  { key: 'published', labelKey: 'status.published' },
  { key: 'archived',  labelKey: 'status.archived'  },
]

const AUDIENCE_OPTION_KEYS: { value: NotificationAudience; labelKey: string }[] = [
  { value: 'all',    labelKey: 'notifPage.audEveryone' },
  { value: 'archer', labelKey: 'notifPage.audArchers' },
  { value: 'coach',  labelKey: 'notifPage.audCoaches' },
  { value: 'admin1', labelKey: 'roles.admin1' },
  { value: 'admin2', labelKey: 'roles.admin2' },
  { value: 'state',  labelKey: 'notifPage.audState' },
  { value: 'pld',    labelKey: 'notifPage.audPld' },
  { value: 'school', labelKey: 'notifPage.audSchool' },
]

const CATEGORY_OPTION_KEYS: { value: NotificationCategory; labelKey: string }[] = [
  { value: 'announcement', labelKey: 'notifCategory.announcement' },
  { value: 'reminder',     labelKey: 'notifCategory.reminder'     },
  { value: 'score',        labelKey: 'notifCategory.score'        },
  { value: 'tournament',   labelKey: 'notifCategory.tournament'   },
  { value: 'system',       labelKey: 'notifCategory.system'       },
]

const PRIORITY_OPTION_KEYS: { value: NotificationPriority; labelKey: string }[] = [
  { value: 'low',    labelKey: 'notifPriority.low'    },
  { value: 'normal', labelKey: 'notifPriority.normal' },
  { value: 'high',   labelKey: 'notifPriority.high'   },
  { value: 'urgent', labelKey: 'notifPriority.urgent' },
]

const STATUS_BADGE: Record<DisplayStatus, { variant: 'success' | 'warning' | 'danger' | 'primary' | 'neutral'; labelKey: string }> = {
  draft:     { variant: 'neutral', labelKey: 'status.draft'     },
  scheduled: { variant: 'primary', labelKey: 'status.scheduled' },
  published: { variant: 'success', labelKey: 'status.published' },
  expired:   { variant: 'warning', labelKey: 'status.expired'   },
  archived:  { variant: 'neutral', labelKey: 'status.archived'  },
}

const AUDIENCE_LABEL_KEYS: Record<NotificationAudience, string> = {
  all:    'notifPage.audEveryone',
  archer: 'nav.archers',
  coach:  'nav.coaches',
  admin1: 'roles.admin1',
  admin2: 'roles.admin2',
  state:  'common.state',
  pld:    'common.pld',
  school: 'common.school',
}

const REF_AUDIENCES = new Set<NotificationAudience>(['state', 'pld', 'school'])

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function computeStatus(n: Notification): DisplayStatus {
  if (n.status === 'archived') return 'archived'
  if (!n.published_at || n.status === 'draft') return 'draft'
  const now = new Date()
  if (new Date(n.published_at) > now) return 'scheduled'
  if (n.expires_at && new Date(n.expires_at) < now) return 'expired'
  return 'published'
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function Admin2Notifications() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const qc = useQueryClient()
  const { ok, err } = useToast()

  const [tab, setTab] = useState<TabKey>('all')
  const [search, setSearch] = useState('')
  const [filterAudience, setFilterAudience] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterPriority, setFilterPriority] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingNotif, setEditingNotif] = useState<Notification | null>(null)
  const [deletingNotif, setDeletingNotif] = useState<Notification | null>(null)

  // ─── QUERIES ───────────────────────────────────────────────────────────────

  const { data: notifications = [], isLoading } = useQuery<Notification[]>({
    queryKey: ['admin-notifications'],
    queryFn: () => getAllNotificationsAdmin(),
  })

  // Reach: how many users have read each notification (migration 054 grants
  // admins read on notification_reads; degrades to empty if not applied).
  const { data: readCounts = new Map<string, number>() } = useQuery<Map<string, number>>({
    queryKey: ['notification-read-counts', notifications.length],
    enabled: notifications.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const ids = notifications.map((n) => n.id)
      const { data, error } = await supabase
        .from('notification_reads')
        .select('notification_id')
        .in('notification_id', ids)
        .limit(10000)
      const m = new Map<string, number>()
      if (!error) {
        for (const r of (data ?? []) as { notification_id: string }[]) {
          m.set(r.notification_id, (m.get(r.notification_id) ?? 0) + 1)
        }
      }
      return m
    },
  })

  const { data: states = [] } = useQuery<OrgItem[]>({
    queryKey: ['states-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('states').select('id, name').eq('active', true).order('name')
      if (error) throw error
      return data as OrgItem[]
    },
    staleTime: 300_000,
  })

  const { data: plds = [] } = useQuery<OrgItem[]>({
    queryKey: ['plds-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plds').select('id, name').eq('active', true).order('name')
      if (error) throw error
      return data as OrgItem[]
    },
    staleTime: 300_000,
  })

  const { data: schools = [] } = useQuery<OrgItem[]>({
    queryKey: ['schools-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('schools').select('id, name').eq('active', true).order('name')
      if (error) throw error
      return data as OrgItem[]
    },
    staleTime: 300_000,
  })

  // ─── LOOKUP MAPS ───────────────────────────────────────────────────────────

  const stateById  = useMemo(() => new Map(states.map((s) => [s.id, s])),  [states])
  const pldById    = useMemo(() => new Map(plds.map((p) => [p.id, p])),    [plds])
  const schoolById = useMemo(() => new Map(schools.map((s) => [s.id, s])), [schools])

  function getAudienceLabel(n: Notification): string {
    const key = AUDIENCE_LABEL_KEYS[n.audience]
    const base = key ? t(key) : n.audience
    if (!n.audience_ref) return base
    if (n.audience === 'state')  return stateById.get(n.audience_ref)?.name ?? base
    if (n.audience === 'pld')    return pldById.get(n.audience_ref)?.name ?? base
    if (n.audience === 'school') return schoolById.get(n.audience_ref)?.name ?? base
    return base
  }

  // ─── DERIVED DATA ──────────────────────────────────────────────────────────

  const derived = useMemo<NotifDerived[]>(
    () => notifications.map((n) => ({ ...n, _status: computeStatus(n) })),
    [notifications],
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return derived.filter((n) => {
      if (tab === 'archived' && n._status !== 'archived' && n._status !== 'expired') return false
      if (tab !== 'all' && tab !== 'archived' && n._status !== tab) return false
      if (q && !n.title.toLowerCase().includes(q) && !n.body.toLowerCase().includes(q)) return false
      if (filterAudience && n.audience !== filterAudience) return false
      if (filterCategory && (n.category ?? 'announcement') !== filterCategory) return false
      if (filterPriority && (n.priority ?? 'normal') !== filterPriority) return false
      return true
    })
  }, [derived, tab, search, filterAudience, filterCategory, filterPriority])

  const stats = useMemo(() => ({
    total:     derived.length,
    published: derived.filter((n) => n._status === 'published').length,
    scheduled: derived.filter((n) => n._status === 'scheduled').length,
    drafts:    derived.filter((n) => n._status === 'draft').length,
    archived:  derived.filter((n) => n._status === 'archived' || n._status === 'expired').length,
  }), [derived])

  const activeFilterCount = [filterAudience, filterCategory, filterPriority].filter(Boolean).length

  // ─── MUTATIONS ─────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-notifications'] })

  const createMut = useMutation({
    // One notification row per selected audience.
    mutationFn: async ({ base, targets }: {
      base: Omit<NotifPayload, 'audience' | 'audience_ref'>
      targets: { audience: NotifPayload['audience']; audience_ref: string | null }[]
    }) => {
      const created = []
      for (const t of targets) {
        created.push(await createNotification({ ...base, ...t }))
      }
      return created
    },
    onSuccess: async (notifs) => {
      await invalidate()
      ok(notifs.length > 1 ? t('notifPage.createdMulti', { count: notifs.length }) : t('notifPage.createdOne'))
      for (const n of notifs) {
        await writeAuditLog(profile!.id, `notification.${n.status ?? 'created'}`, 'notification', n.id)
      }
      setModalOpen(false)
    },
    onError: (e: Error) => err(t('common.actionFailed'), e.message),
  })

  const updateMut = useMutation({
    // The edited row keeps the first ticked audience; extra ticks add new rows.
    mutationFn: async ({ id, base, targets }: {
      id: string
      base: Omit<NotifPayload, 'created_by' | 'audience' | 'audience_ref'>
      targets: { audience: NotifPayload['audience']; audience_ref: string | null }[]
    }) => {
      const updated = await updateNotification(id, { ...base, ...targets[0] })
      for (const t of targets.slice(1)) {
        await createNotification({ ...base, ...t, created_by: profile!.id })
      }
      return updated
    },
    onSuccess: async (notif) => {
      await invalidate()
      ok(t('notifPage.updatedToast'))
      await writeAuditLog(profile!.id, 'notification.updated', 'notification', notif.id)
      setModalOpen(false)
    },
    onError: (e: Error) => err(t('common.actionFailed'), e.message),
  })

  const publishMut = useMutation({
    mutationFn: (id: string) => publishNotification(id),
    onSuccess: async (notif) => {
      await invalidate()
      ok(t('notifPage.publishedToast'))
      await writeAuditLog(profile!.id, 'notification.published', 'notification', notif.id)
    },
    onError: (e: Error) => err(t('common.actionFailed'), e.message),
  })

  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveNotification(id),
    onSuccess: async (notif) => {
      await invalidate()
      ok(t('notifPage.archivedToast'))
      await writeAuditLog(profile!.id, 'notification.archived', 'notification', notif.id)
    },
    onError: (e: Error) => err(t('common.actionFailed'), e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteNotification(id),
    onSuccess: async () => {
      await invalidate()
      ok(t('notifPage.deletedToast'))
      if (deletingNotif) {
        await writeAuditLog(profile!.id, 'notification.deleted', 'notification', deletingNotif.id)
      }
      setDeletingNotif(null)
    },
    onError: (e: Error) => err(t('common.actionFailed'), e.message),
  })

  const duplicateMut = useMutation({
    mutationFn: (n: Notification) => createNotification({
      title:        `${n.title} ${t('roundsPage.copySuffix')}`,
      body:         n.body,
      audience:     n.audience,
      audience_ref: n.audience_ref ?? null,
      category:     n.category ?? 'announcement',
      priority:     n.priority ?? 'normal',
      status:       'draft',
      created_by:   profile!.id,
      published_at: null,
      expires_at:   null,
    }),
    onSuccess: async (notif) => {
      await invalidate()
      ok(t('notifPage.duplicatedToast'))
      await writeAuditLog(profile!.id, 'notification.created', 'notification', notif.id, { duplicated: true })
    },
    onError: (e: Error) => err(t('common.actionFailed'), e.message),
  })

  // ─── HANDLERS ──────────────────────────────────────────────────────────────

  function openCreate() {
    setEditingNotif(null)
    setModalOpen(true)
  }

  function openEdit(n: Notification) {
    setEditingNotif(n)
    setModalOpen(true)
  }

  function handleSave(
    base: Omit<NotifPayload, 'created_by' | 'audience' | 'audience_ref'>,
    targets: { audience: NotifPayload['audience']; audience_ref: string | null }[],
  ) {
    if (editingNotif) {
      updateMut.mutate({ id: editingNotif.id, base, targets })
    } else {
      createMut.mutate({ base: { ...base, created_by: profile!.id }, targets })
    }
  }

  const saving = createMut.isPending || updateMut.isPending

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <PageWrapper>
      <PageHead
        title={t('notifPage.managerTitle')}
        description={t('notifPage.managerDescription')}
        action={
          <Button onClick={openCreate} icon={<PlusIcon />}>
            {t('notifPage.newNotification')}
          </Button>
        }
      />

      {/* ─── PERSONAL INBOX — read + clear the nav red dot ─────────────── */}
      {profile?.id && (
        <div className="mb-5">
          <NotificationInbox profileId={profile.id} />
        </div>
      )}

      {/* ─── STAT CARDS ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard label={t('common.total')}     value={stats.total}     onClick={() => setTab('all')} clickable active={tab === 'all'} />
        <StatCard label={t('status.published')} value={stats.published} onClick={() => setTab('published')} clickable active={tab === 'published'} />
        <StatCard label={t('status.scheduled')} value={stats.scheduled} onClick={() => setTab('scheduled')} clickable active={tab === 'scheduled'} />
        <StatCard label={t('adminArticles.drafts')}    value={stats.drafts}    onClick={() => setTab('draft')} clickable active={tab === 'draft'} />
        <StatCard label={t('status.archived')}  value={stats.archived}  onClick={() => setTab('archived')} clickable active={tab === 'archived'} />
      </div>

      {/* ─── TABS ───────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-px">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.key}
            onClick={() => setTab(tabDef.key)}
            className={cn(
              'flex-shrink-0 px-4 py-2 text-sm font-semibold rounded-[var(--r-sm)] transition-colors',
              tab === tabDef.key
                ? 'bg-primary text-primary-on'
                : 'text-text-dim hover:text-text hover:bg-surface-soft',
            )}
          >
            {t(tabDef.labelKey)}
          </button>
        ))}
      </div>

      {/* ─── SEARCH + FILTER BAR ────────────────────────────────────────── */}
      <SectionCard className="mb-4">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <Input
              placeholder={t('notifPage.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              'flex-shrink-0 px-3 py-2 text-xs font-semibold rounded-[var(--r-sm)] border transition-colors',
              showFilters || activeFilterCount > 0
                ? 'bg-primary-soft text-primary border-primary'
                : 'bg-section text-text-dim border-line hover:border-line-strong',
            )}
          >
            {t('common.filters')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </button>
          {(search || activeFilterCount > 0) && (
            <button
              onClick={() => { setSearch(''); setFilterAudience(''); setFilterCategory(''); setFilterPriority('') }}
              className="flex-shrink-0 px-3 py-2 text-xs font-semibold rounded-[var(--r-sm)] bg-section text-text-dim border border-line hover:border-line-strong transition-colors"
            >
              {t('common.clear')}
            </button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 pt-3 border-t border-line">
            <Select
              label={t('notifPage.audience')}
              value={filterAudience}
              onChange={(e) => setFilterAudience(e.target.value)}
              options={[{ value: '', label: t('adminArticles.allAudiences') }, ...AUDIENCE_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))]}
            />
            <Select
              label={t('adminArticles.category')}
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              options={[{ value: '', label: t('common.allCategories') }, ...CATEGORY_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))]}
            />
            <Select
              label={t('notifPage.priority')}
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              options={[{ value: '', label: t('notifPage.allPriorities') }, ...PRIORITY_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))]}
            />
          </div>
        )}
      </SectionCard>

      {/* ─── NOTIFICATION LIST ──────────────────────────────────────────── */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="py-10 text-center text-text-faint text-sm">{t('notifPage.loading')}</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={t('notifPage.noneFound')}
            description={search || activeFilterCount > 0 ? t('common.noResultsFilters') : t('notifPage.createFirstHint')}
            action={
              !search && activeFilterCount === 0 ? (
                <Button onClick={openCreate} size="sm" icon={<PlusIcon />}>{t('notifPage.newNotification')}</Button>
              ) : undefined
            }
          />
        ) : (
          filtered.map((n) => (
            <NotifCard
              key={n.id}
              notification={n}
              audienceLabel={getAudienceLabel(n)}
              readCount={readCounts.get(n.id) ?? (n._status === 'published' ? 0 : null)}
              onEdit={() => openEdit(n)}
              onPublish={() => publishMut.mutate(n.id)}
              onDuplicate={() => duplicateMut.mutate(n)}
              onArchive={() => archiveMut.mutate(n.id)}
              onDelete={() => setDeletingNotif(n)}
            />
          ))
        )}
      </div>

      {/* ─── CREATE / EDIT MODAL ────────────────────────────────────────── */}
      {modalOpen && (
        <CreateEditModal
          notification={editingNotif}
          states={states}
          plds={plds}
          schools={schools}
          saving={saving}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
        />
      )}

      {/* ─── DELETE CONFIRM ─────────────────────────────────────────────── */}
      <ConfirmDialog
        open={!!deletingNotif}
        onClose={() => setDeletingNotif(null)}
        onConfirm={() => deletingNotif && deleteMut.mutate(deletingNotif.id)}
        title={t('notifPage.deleteTitle')}
        message={t('notifPage.deleteMessage', { title: deletingNotif?.title ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        loading={deleteMut.isPending}
      />
    </PageWrapper>
  )
}

// ─── NOTIFICATION CARD ───────────────────────────────────────────────────────

function NotifCard({
  notification: n,
  audienceLabel,
  readCount,
  onEdit,
  onPublish,
  onDuplicate,
  onArchive,
  onDelete,
}: {
  notification: NotifDerived
  audienceLabel: string
  readCount?: number | null
  onEdit: () => void
  onPublish: () => void
  onDuplicate: () => void
  onArchive: () => void
  onDelete: () => void
}) {
  const { t } = useLanguage()
  const sb = STATUS_BADGE[n._status]
  const showPublish = n._status === 'draft' || n._status === 'scheduled'
  const showArchive = n._status !== 'archived'
  const cat = n.category ?? 'announcement'
  const pri = n.priority ?? 'normal'

  return (
    <div className="group relative border border-line rounded-[var(--r-lg)] p-4 bg-surface hover:border-line-strong transition-colors">
      {/* Top row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant={sb.variant} dot>{t(sb.labelKey)}</Badge>
          {pri !== 'normal' && (
            <Badge variant={pri === 'urgent' ? 'danger' : 'warning'} className="capitalize">{t(`notifPriority.${pri}`)}</Badge>
          )}
          <Badge variant="neutral">{t(`notifCategory.${cat}`)}</Badge>
        </div>
        {/* Action buttons — visible on hover */}
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          <ActionBtn onClick={onEdit} title={t('common.edit')} icon={<EditIcon />} />
          {showPublish && <ActionBtn onClick={onPublish} title={t('notifPage.publishNow')} icon={<PublishIcon />} className="hover:text-success" />}
          <ActionBtn onClick={onDuplicate} title={t('common.duplicate')} icon={<DuplicateIcon />} />
          {showArchive && <ActionBtn onClick={onArchive} title={t('common.archive')} icon={<ArchiveIcon />} />}
          <ActionBtn onClick={onDelete} title={t('common.delete')} icon={<TrashIcon />} className="hover:text-danger" />
        </div>
      </div>

      {/* Title */}
      <h4 className="font-display font-semibold text-sm text-text leading-snug mb-1">{n.title}</h4>

      {/* Body preview */}
      <p className="text-xs text-text-dim line-clamp-2 mb-3 leading-relaxed">{n.body}</p>

      {/* Cover thumbnail */}
      {(n as { image_url?: string | null }).image_url && (
        <img
          src={(n as { image_url?: string | null }).image_url!}
          alt=""
          className="w-full max-h-32 object-cover rounded-[var(--r-sm)] border border-line mb-3"
        />
      )}

      {/* Footer */}
      <div className="flex items-center gap-3 flex-wrap text-[11px] text-text-faint">
        <span className="flex items-center gap-1">
          <span className="opacity-60">{t('notifPage.to')}:</span> {audienceLabel}
        </span>
        {readCount != null && n._status === 'published' && (
          <span className="font-semibold text-text-dim">👁 {t('notifPage.readBy', { count: readCount })}</span>
        )}
        {n.published_at && (
          <span>{n._status === 'scheduled' ? `${t('status.scheduled')} ` : `${t('status.published')} `}{timeAgo(n.published_at)}</span>
        )}
        {n.expires_at && (
          <span>{t('certPage.expires')} {formatDate(n.expires_at)}</span>
        )}
        {(n.author as any)?.name && (
          <span className="ml-auto">{t('adminArticles.by')} {(n.author as any).name}</span>
        )}
      </div>

      {/* Mobile: action row */}
      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-line sm:hidden">
        <button onClick={onEdit} className="flex-1 py-1.5 text-xs font-semibold text-text-dim hover:text-text transition-colors rounded-[6px] hover:bg-surface-soft">
          {t('common.edit')}
        </button>
        {showPublish && (
          <button onClick={onPublish} className="flex-1 py-1.5 text-xs font-semibold text-success transition-colors rounded-[6px] hover:bg-success-soft">
            {t('adminArticles.publish')}
          </button>
        )}
        <button onClick={onDuplicate} className="flex-1 py-1.5 text-xs font-semibold text-text-dim hover:text-text transition-colors rounded-[6px] hover:bg-surface-soft">
          {t('common.duplicate')}
        </button>
        {showArchive && (
          <button onClick={onArchive} className="flex-1 py-1.5 text-xs font-semibold text-text-dim hover:text-text transition-colors rounded-[6px] hover:bg-surface-soft">
            {t('common.archive')}
          </button>
        )}
        <button onClick={onDelete} className="flex-1 py-1.5 text-xs font-semibold text-danger transition-colors rounded-[6px] hover:bg-danger-soft">
          {t('common.delete')}
        </button>
      </div>
    </div>
  )
}

function ActionBtn({
  onClick, title, icon, className,
}: {
  onClick: () => void
  title: string
  icon: React.ReactNode
  className?: string
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'p-1.5 rounded-[8px] text-text-dim hover:text-text hover:bg-surface-soft transition-colors',
        className,
      )}
    >
      {icon}
    </button>
  )
}

// ─── CREATE / EDIT MODAL ─────────────────────────────────────────────────────

interface ModalProps {
  notification: Notification | null
  states: OrgItem[]
  plds: OrgItem[]
  schools: OrgItem[]
  saving: boolean
  onClose: () => void
  onSave: (
    base: Omit<NotifPayload, 'created_by' | 'audience' | 'audience_ref'>,
    targets: { audience: NotifPayload['audience']; audience_ref: string | null }[],
  ) => void
}

function CreateEditModal({ notification, states, plds, schools, saving, onClose, onSave }: ModalProps) {
  const { t } = useLanguage()
  const isEdit = notification !== null
  const existingStatus = notification ? computeStatus(notification) : 'draft'

  const [title, setTitle] = useState(notification?.title ?? '')
  const [body, setBody] = useState(notification?.body ?? '')
  // Multi-audience: a notification row is created per checked audience.
  const [audiences, setAudiences] = useState<Set<NotificationAudience>>(
    new Set([notification?.audience ?? 'all']),
  )
  const [audienceRef, setAudienceRef] = useState(notification?.audience_ref ?? '')
  const [imageUrl, setImageUrl] = useState<string | null>((notification as { image_url?: string | null } | null)?.image_url ?? null)
  const [coverUploading, setCoverUploading] = useState(false)
  const [category, setCategory] = useState<NotificationCategory>(notification?.category ?? 'announcement')
  const [priority, setPriority] = useState<NotificationPriority>(notification?.priority ?? 'normal')
  const [publishMode, setPublishMode] = useState<'draft' | 'now' | 'scheduled'>('draft')
  const [scheduledAt, setScheduledAt] = useState('')
  const [expiresAt, setExpiresAt] = useState(
    notification?.expires_at ? notification.expires_at.slice(0, 16) : '',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (existingStatus === 'scheduled') {
      setPublishMode('scheduled')
      setScheduledAt(notification?.published_at ? notification.published_at.slice(0, 16) : '')
    } else if (existingStatus === 'published' || existingStatus === 'expired') {
      setPublishMode('now')
    } else {
      setPublishMode('draft')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function toggleAudience(a: NotificationAudience) {
    setAudiences(prev => {
      const next = new Set(prev)
      if (next.has(a)) next.delete(a); else next.add(a)
      return next
    })
  }

  function validate(): boolean {
    const errs: Record<string, string> = {}
    if (!title.trim()) errs.title = t('notifPage.errTitle')
    if (!body.trim()) errs.body = t('notifPage.errBody')
    if (audiences.size === 0) errs.audience = t('notifPage.errAudience')
    if ([...audiences].some(a => REF_AUDIENCES.has(a)) && !audienceRef) errs.audienceRef = t('notifPage.errTarget')
    if (publishMode === 'scheduled' && !scheduledAt) errs.scheduledAt = t('notifPage.errScheduledAt')
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleCover(file: File | null) {
    if (!file) return
    setCoverUploading(true)
    try {
      const url = await uploadArticleImage(file, 'notifications', 'cover-')
      setImageUrl(url)
    } catch (e: unknown) {
      setErrors(prev => ({ ...prev, cover: (e as Error).message }))
    } finally {
      setCoverUploading(false)
    }
  }

  function handleSubmit() {
    if (!validate()) return

    let status: NotificationStatus = 'draft'
    let published_at: string | null = null

    if (publishMode === 'now') {
      status = 'published'
      published_at = isEdit && notification?.published_at
        ? notification.published_at          // preserve original publish time when editing
        : new Date().toISOString()
    } else if (publishMode === 'scheduled') {
      status = 'scheduled'
      published_at = new Date(scheduledAt).toISOString()
    }

    onSave(
      {
        title:        title.trim(),
        body:         body.trim(),
        image_url:    imageUrl,
        category,
        priority,
        status,
        published_at,
        expires_at:   expiresAt ? new Date(expiresAt).toISOString() : null,
      },
      [...audiences].map(a => ({
        audience: a,
        audience_ref: REF_AUDIENCES.has(a) ? audienceRef : null,
      })),
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? t('notifPage.editNotification') : t('notifPage.newNotification')}
      width="min(620px,100%)"
    >
      <div className="space-y-4">
        {/* Title */}
        <Input
          label={t('common.title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
          placeholder={t('notifPage.titlePlaceholder')}
        />

        {/* Body */}
        <Textarea
          label={t('notifPage.body')}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          minRows={4}
          error={errors.body}
          placeholder={t('notifPage.bodyPlaceholder')}
        />

        {/* Cover photo */}
        <div>
          <p className="text-[12px] font-semibold text-text-dim mb-1">{t('notifPage.coverPhoto')}</p>
          <p className="text-[11px] text-text-faint mb-2">
            {t('notifPage.coverHint')}
          </p>
          {imageUrl ? (
            <div className="flex items-start gap-3">
              <img src={imageUrl} alt={t('adminArticles.coverImage')} className="max-h-32 rounded-[var(--r)] border border-line object-cover" />
              <Button variant="ghost" size="sm" onClick={() => setImageUrl(null)}>{t('common.remove')}</Button>
            </div>
          ) : (
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-[var(--r-sm)] border border-dashed border-line text-sm text-text-dim cursor-pointer hover:border-primary hover:text-primary transition-colors">
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                onChange={(e) => { handleCover(e.target.files?.[0] ?? null); e.target.value = '' }} />
              {coverUploading ? t('common.uploading') : `+ ${t('notifPage.uploadCover')}`}
            </label>
          )}
          {errors.cover && <p className="text-[12px] text-danger font-medium mt-1">{errors.cover}</p>}
        </div>

        {/* Audience — checkboxes, multiple allowed */}
        <div>
          <p className="text-[12px] font-semibold text-text-dim mb-1.5">{t('notifPage.audienceTickAll')}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {AUDIENCE_OPTION_KEYS.map((o) => (
              <label key={o.value} className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-primary"
                  checked={audiences.has(o.value as NotificationAudience)}
                  onChange={() => toggleAudience(o.value as NotificationAudience)}
                />
                <span className="text-sm text-text">{t(o.labelKey)}</span>
              </label>
            ))}
          </div>
          {errors.audience && <p className="text-[12px] text-danger font-medium mt-1">{errors.audience}</p>}
          {!isEdit && audiences.size > 1 && (
            <p className="text-[11px] text-text-faint mt-1">{t('notifPage.multiAudienceNote', { count: audiences.size })}</p>
          )}
        </div>

        {/* Category */}
        <Select
          label={t('adminArticles.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value as NotificationCategory)}
          options={CATEGORY_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
        />

        {/* Audience targets (shown when a targeted audience is ticked) */}
        {audiences.has('state') && (
          <Select
            label={t('notifPage.targetState')}
            value={audienceRef}
            onChange={(e) => setAudienceRef(e.target.value)}
            options={states.map((s) => ({ value: s.id, label: s.name }))}
            placeholder={t('stateReport.selectState')}
            error={errors.audienceRef}
          />
        )}
        {audiences.has('pld') && (
          <Select
            label={t('notifPage.targetPld')}
            value={audienceRef}
            onChange={(e) => setAudienceRef(e.target.value)}
            options={plds.map((p) => ({ value: p.id, label: p.name }))}
            placeholder={t('notifPage.selectPld')}
            error={errors.audienceRef}
          />
        )}
        {audiences.has('school') && (
          <Select
            label={t('notifPage.targetSchool')}
            value={audienceRef}
            onChange={(e) => setAudienceRef(e.target.value)}
            options={schools.map((s) => ({ value: s.id, label: s.name }))}
            placeholder={t('notifPage.selectSchool')}
            error={errors.audienceRef}
          />
        )}

        {/* Priority */}
        <Select
          label={t('notifPage.priority')}
          value={priority}
          onChange={(e) => setPriority(e.target.value as NotificationPriority)}
          options={PRIORITY_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
        />

        {/* Publish mode */}
        <div>
          <p className="text-[12px] font-semibold text-text-dim mb-2">{t('notifPage.publishMode')}</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: 'draft',     labelKey: 'notifPage.saveAsDraft'  },
                { key: 'now',       labelKey: 'notifPage.publishNow'    },
                { key: 'scheduled', labelKey: 'notifPage.schedule'       },
              ] as const
            ).map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPublishMode(key)}
                className={cn(
                  'px-3 py-1.5 text-xs font-semibold rounded-[8px] border transition-colors',
                  publishMode === key
                    ? 'bg-primary text-primary-on border-primary'
                    : 'bg-section text-text-dim border-line hover:border-line-strong',
                )}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Scheduled date */}
        {publishMode === 'scheduled' && (
          <Input
            label={t('notifPage.scheduledDate')}
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            error={errors.scheduledAt}
          />
        )}

        {/* Expiry */}
        <Input
          label={t('notifPage.expiryDate')}
          type="datetime-local"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          hint={t('notifPage.expiryHint')}
        />

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2 border-t border-line">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} loading={saving}>
            {isEdit ? t('common.saveChanges') : t('notifPage.createNotification')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ─── ICONS ───────────────────────────────────────────────────────────────────

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

function EditIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

function PublishIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 2 11 13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  )
}

function DuplicateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  )
}

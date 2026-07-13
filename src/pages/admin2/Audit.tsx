import { useState, useMemo, useEffect, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageWrapper, PageHead, SectionCard } from '@/components/layout/PageWrapper'
import { Button, Badge, StatCard, Modal, Input, Select, EmptyState, RoleBadge, useToast, ListSkeleton } from '@/components/ui'
import { AccessDenied } from '@/components/common/AccessDenied'
import { useAuth } from '@/hooks/useAuth'
import { useLanguage } from '@/contexts/LanguageContext'
import { canViewAuditLogs } from '@/lib/permissions'
import {
  getAuditLogs, getAuditSummary, exportAuditLogsCsv, type AuditLogRow,
} from '@/services/audit'
import {
  getActionCategory, getCategoryLabelKey, getActionRisk, humanizeAction,
  riskBadgeVariant, shouldShowRisk, RISK_LABEL_KEYS, AUDIT_CATEGORY_FILTER_OPTION_KEYS,
} from '@/lib/auditRisk'

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const FETCH_CAP = 300   // most-recent rows pulled into the browser at once
const PAGE_SIZE = 50    // "latest 50 + load more"

const ROLE_FILTER_OPTION_KEYS = [
  { value: 'all',         labelKey: 'common.allRoles' },
  { value: 'super_admin', labelKey: 'roles.super_admin' },
  { value: 'admin2',      labelKey: 'roles.admin2' },
  { value: 'admin1',      labelKey: 'roles.admin1' },
  { value: 'coach',       labelKey: 'roles.coach' },
  { value: 'archer',      labelKey: 'roles.archer' },
]

// ─── HELPERS ───────────────────────────────────────────────────────────────

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-MY', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ─── PAGE ──────────────────────────────────────────────────────────────────

export default function Admin2Audit() {
  const { profile } = useAuth()
  const { t } = useLanguage()
  const { ok, err } = useToast()

  // ── guard ──
  if (!canViewAuditLogs(profile?.role)) return <AccessDenied />

  // ── filters / paging ──
  const [search, setSearch]       = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [fRole, setFRole]         = useState('all')
  const [fCategory, setFCategory] = useState('all')
  const [fEntity, setFEntity]     = useState('all')
  const [visible, setVisible]     = useState(PAGE_SIZE)
  const [detail, setDetail]       = useState<AuditLogRow | null>(null)

  // ── data ──
  const { data: summary } = useQuery({ queryKey: ['audit-summary'], queryFn: getAuditSummary })

  const { data: logs = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit-logs', dateFrom, dateTo],
    queryFn: () => getAuditLogs({ from: dateFrom || undefined, to: dateTo || undefined, limit: FETCH_CAP }),
  })

  // ── entity-type options (derived from loaded logs; target_type is freeform) ──
  const entityOptions = useMemo(() => {
    const set = new Set<string>()
    logs.forEach(l => { if (l.target_type) set.add(l.target_type) })
    return [{ value: 'all', label: t('auditPage.allEntities') }, ...[...set].sort().map(v => ({ value: v, label: v }))]
  }, [logs, t])

  // ── client-side filtering over the loaded window ──
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return logs.filter(l => {
      if (fRole !== 'all' && l.actor_role !== fRole) return false
      if (fCategory !== 'all' && getActionCategory(l.action) !== fCategory) return false
      if (fEntity !== 'all' && l.target_type !== fEntity) return false
      if (q) {
        const hay = [
          l.actor_name, l.action, l.entity_label ?? '', l.target_type ?? '',
          l.meta ? JSON.stringify(l.meta) : '',
        ].join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [logs, search, fRole, fCategory, fEntity])

  // Reset the visible window whenever the result set changes.
  useEffect(() => { setVisible(PAGE_SIZE) }, [search, fRole, fCategory, fEntity, dateFrom, dateTo])

  const shown = filtered.slice(0, visible)
  const hasFilters = !!(search || dateFrom || dateTo || fRole !== 'all' || fCategory !== 'all' || fEntity !== 'all')

  function clearFilters() {
    setSearch(''); setDateFrom(''); setDateTo('')
    setFRole('all'); setFCategory('all'); setFEntity('all')
  }

  function handleExport() {
    if (!filtered.length) { err(t('auditPage.noLogsToExport')); return }
    const csv = exportAuditLogsCsv(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    ok(t('auditPage.exportedLogs', { count: filtered.length }))
  }

  return (
    <PageWrapper>
      <PageHead
        title={t('auditPage.title')}
        description={t('auditPage.description')}
        action={<Button variant="outline" onClick={handleExport} disabled={!filtered.length}>{t('stateReport.exportCsv')}</Button>}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard label={t('auditPage.totalLogs')}      value={summary?.total ?? '—'} accent />
        <StatCard label={t('auditPage.logsToday')}      value={summary?.today ?? '—'} />
        <StatCard label={t('auditPage.adminActions')}   value={summary?.adminActions ?? '—'} />
        <StatCard label={t('auditPage.highRisk')}       value={summary?.highRisk ?? '—'} />
        <StatCard label={t('auditPage.userChanges')}    value={summary?.userChanges ?? '—'} />
        <StatCard label={t('auditPage.scoreActions')}   value={summary?.scoreActions ?? '—'} />
        <StatCard label={t('auditPage.contentChanges')} value={summary?.contentChanges ?? '—'} />
        <StatCard label={t('auditPage.systemChanges')}  value={summary?.systemChanges ?? '—'} />
      </div>

      {/* Filters */}
      <SectionCard className="mb-4">
        <div className="flex flex-wrap gap-3">
          <Input
            placeholder={t('auditPage.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            wrapperClassName="flex-1 min-w-[200px]"
          />
          <Select options={ROLE_FILTER_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))} value={fRole} onChange={e => setFRole(e.target.value)} wrapperClassName="w-[150px]" />
          <Select options={AUDIT_CATEGORY_FILTER_OPTION_KEYS.map(o => ({ value: o.value, label: t(o.labelKey) }))} value={fCategory} onChange={e => setFCategory(e.target.value)} wrapperClassName="w-[170px]" />
          <Select options={entityOptions} value={fEntity} onChange={e => setFEntity(e.target.value)} wrapperClassName="w-[150px]" />
        </div>
        <div className="flex flex-wrap items-end gap-3 mt-3">
          <Input type="date" label={t('auditPage.from')} value={dateFrom} onChange={e => setDateFrom(e.target.value)} wrapperClassName="w-[160px]" />
          <Input type="date" label={t('auditPage.to')}   value={dateTo}   onChange={e => setDateTo(e.target.value)}   wrapperClassName="w-[160px]" />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>{t('coachAch.clearFilters')}</Button>
          )}
        </div>
      </SectionCard>

      {/* Log list */}
      <SectionCard>
        {isLoading ? (
          <ListSkeleton rows={6} />
        ) : isError ? (
          <EmptyState
            tone="danger"
            title={t('auditPage.loadError')}
            description={(error as Error)?.message}
            action={<Button variant="outline" onClick={() => refetch()}>{t('common.retry')}</Button>}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title={hasFilters ? t('auditPage.noMatch') : t('auditPage.noLogsYet')}
            description={hasFilters ? t('auditPage.noMatchHint') : t('auditPage.noLogsYetHint')}
            action={hasFilters ? <Button variant="outline" onClick={clearFilters}>{t('coachAch.clearFilters')}</Button> : undefined}
          />
        ) : (
          <div className="space-y-2">
            {shown.map(row => <AuditRow key={row.id} row={row} onView={() => setDetail(row)} />)}
          </div>
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div className="mt-4 flex flex-col items-center gap-2">
            {visible < filtered.length && (
              <Button variant="outline" size="sm" onClick={() => setVisible(v => v + PAGE_SIZE)}>
                {t('auditPage.loadMore', { count: filtered.length - visible })}
              </Button>
            )}
            <p className="text-xs text-text-faint text-center">
              {t('auditPage.showingLoaded', { shown: Math.min(visible, filtered.length), total: filtered.length })}
              {logs.length >= FETCH_CAP && ` · ${t('auditPage.narrowRange')}`}
            </p>
          </div>
        )}
      </SectionCard>

      <AuditDetailModal row={detail} onClose={() => setDetail(null)} />
    </PageWrapper>
  )
}

// ─── LOG ROW ───────────────────────────────────────────────────────────────

function AuditRow({ row, onView }: { row: AuditLogRow; onView: () => void }) {
  const { t } = useLanguage()
  const risk = getActionRisk(row.action)
  return (
    <div className="border border-line rounded-[var(--r-md)] p-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm break-words">{humanizeAction(row.action)}</span>
          <Badge variant="neutral">{t(getCategoryLabelKey(row.action))}</Badge>
          {shouldShowRisk(risk) && <Badge variant={riskBadgeVariant(risk)}>{t('auditPage.riskBadge', { level: t(RISK_LABEL_KEYS[risk]) })}</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-xs text-text-dim">
          <span className="font-medium text-text">{row.actor_name}</span>
          {row.actor_role && <RoleBadge role={row.actor_role} />}
          <span className="text-text-faint">·</span>
          <span className="tabular-nums">{fmtDateTime(row.created_at)}</span>
        </div>
        {(row.target_type || row.entity_label) && (
          <div className="mt-1 text-xs text-text-dim truncate">
            {row.target_type && <span className="font-mono text-text-faint">{row.target_type}</span>}
            {row.entity_label && <span> · {row.entity_label}</span>}
          </div>
        )}
      </div>
      <div className="flex-shrink-0">
        <Button size="sm" variant="outline" onClick={onView}>{t('common.view')}</Button>
      </div>
    </div>
  )
}

// ─── DETAIL MODAL ──────────────────────────────────────────────────────────

function AuditDetailModal({ row, onClose }: { row: AuditLogRow | null; onClose: () => void }) {
  const { t } = useLanguage()
  const risk = row ? getActionRisk(row.action) : 'low'
  return (
    <Modal open={!!row} onClose={onClose} title={t('auditPage.detailTitle')} width="min(640px,100%)">
      {row && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="neutral">{t(getCategoryLabelKey(row.action))}</Badge>
            {shouldShowRisk(risk) && <Badge variant={riskBadgeVariant(risk)}>{t('auditPage.riskBadge', { level: t(RISK_LABEL_KEYS[risk]) })}</Badge>}
          </div>

          <Field label={t('auditPage.action')}>
            <span className="font-mono text-xs">{row.action}</span>
            <span className="text-text-dim"> · {humanizeAction(row.action)}</span>
          </Field>
          <Field label={t('auditPage.when')}>{fmtDateTime(row.created_at)}</Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={t('auditPage.actor')}>
              <div className="flex items-center gap-2 flex-wrap">
                <span>{row.actor_name}</span>
                {row.actor_role && <RoleBadge role={row.actor_role} />}
              </div>
            </Field>
            <Field label={t('auditPage.actorId')}><span className="font-mono text-xs break-all">{row.actor_id ?? '—'}</span></Field>
            <Field label={t('auditPage.entityType')}>{row.target_type ?? '—'}</Field>
            <Field label={t('auditPage.entityId')}><span className="font-mono text-xs break-all">{row.target_id ?? '—'}</span></Field>
          </div>

          {row.entity_label && <Field label={t('auditPage.entityLabel')}>{row.entity_label}</Field>}

          {row.old_value != null && <Field label={t('auditPage.previousValue')}><JsonBlock value={row.old_value} /></Field>}
          {row.new_value != null && <Field label={t('auditPage.newValue')}><JsonBlock value={row.new_value} /></Field>}

          {row.meta && Object.keys(row.meta).length > 0 && (
            <Field label={t('common.details')}><JsonBlock value={row.meta} /></Field>
          )}

          {row.ip_address && <Field label={t('auditPage.ipAddress')}><span className="font-mono text-xs">{row.ip_address}</span></Field>}

          <p className="text-xs text-text-faint border-t border-line pt-3">
            {t('auditPage.readOnlyNote')}
          </p>
        </div>
      )}
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-text-faint mb-0.5">{label}</div>
      <div className="text-text break-words">{children}</div>
    </div>
  )
}

function JsonBlock({ value }: { value: unknown }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <pre className="mt-1 text-xs bg-section rounded-[var(--r-sm)] p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words border border-line">
      {text}
    </pre>
  )
}

/**
 * Audit Logs — read-only viewer service for Admin 2 / Super Admin.
 *
 * Reads the `public.audit_logs` view (→ audit.audit_logs). That view is granted
 * SELECT only and RLS restricts reads to core.is_admin() (admin2 + super_admin),
 * so this service is structurally read-only — there are no insert/update/delete
 * helpers here. New audit rows are written exclusively through the SECURITY
 * DEFINER `log_audit` RPC via `writeAuditLog()` in services/auditLog.ts; that
 * write path is intentionally left untouched.
 *
 * Actor names/roles are joined in JS (batch fetch of profiles) rather than via
 * PostgREST embedding, matching the pattern in services/organization.ts.
 */
import { supabase } from './supabase'
import type { Role } from '@/types'
import { getActionCategory, getActionRisk, type AuditCategory } from '@/lib/auditRisk'

// ─── TYPES ─────────────────────────────────────────────────────────────────

export interface AuditLogRow {
  id: string
  actor_id: string | null
  actor_name: string
  actor_role: Role | null
  action: string
  target_type: string | null
  target_id: string | null
  entity_label: string | null
  meta: Record<string, unknown> | null
  old_value: unknown
  new_value: unknown
  ip_address: string | null
  created_at: string
}

export interface AuditQuery {
  from?: string        // inclusive lower bound, yyyy-mm-dd (local day start)
  to?: string          // inclusive upper bound, yyyy-mm-dd (local day end)
  action?: string
  actorId?: string
  targetType?: string
  targetId?: string
  limit?: number
}

export interface AuditSummary {
  total: number
  today: number
  adminActions: number
  userChanges: number
  scoreActions: number
  contentChanges: number
  systemChanges: number
  highRisk: number
}

// Hard caps so a viewer query never pulls thousands of rows at once.
const DEFAULT_LIMIT = 300
const MAX_LIMIT = 1000
// Summary scans the most-recent N rows for category/risk breakdowns.
const SUMMARY_SCAN_LIMIT = 2000

const SELECT_COLS = 'id, actor_id, action, target_type, target_id, meta, ip_address, created_at'

// Raw row shape returned by PostgREST for public.audit_logs.
// `meta` is typed unknown: rows written through the old writeAuditLog bug
// (JSON.stringify into a jsonb param) come back as a JSON *string*, not an
// object — normalizeMeta() below repairs both shapes.
interface RawAuditRow {
  id: string
  actor_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  meta: unknown
  ip_address: string | null
  created_at: string
}

// ─── META EXTRACTION ───────────────────────────────────────────────────────
// `meta` is freeform jsonb; pull common keys out so the viewer can show a label
// and before/after values without assuming any one writer's shape.

/**
 * Coerce a raw jsonb `meta` value to a plain object. Handles the legacy
 * double-encoded rows (jsonb string scalar containing serialized JSON) that
 * the old writeAuditLog produced — without this, `'name' in meta` throws a
 * TypeError on string meta and one bad row kills the whole viewer.
 */
function normalizeMeta(v: unknown): Record<string, unknown> | null {
  if (v == null) return null
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v)
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  return null
}

function pick(meta: Record<string, unknown> | null, keys: string[]): unknown {
  if (!meta || typeof meta !== 'object') return null
  for (const k of keys) {
    if (k in meta && meta[k] != null) return meta[k]
  }
  return null
}

function entityLabelFromMeta(meta: Record<string, unknown> | null): string | null {
  const v = pick(meta, ['name', 'label', 'title', 'email', 'entity_label'])
  return v == null ? null : String(v)
}

function startOfTodayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// ─── ENRICH ────────────────────────────────────────────────────────────────

async function enrich(raw: RawAuditRow[]): Promise<AuditLogRow[]> {
  const actorIds = [...new Set(raw.map(r => r.actor_id).filter((x): x is string => !!x))]

  let profiles: Record<string, { name: string; role: Role }> = {}
  if (actorIds.length) {
    const { data } = await supabase
      .from('profiles')
      .select('id, name, role')
      .in('id', actorIds)
    profiles = Object.fromEntries(
      ((data ?? []) as { id: string; name: string; role: Role }[])
        .map(p => [p.id, { name: p.name, role: p.role }]),
    )
  }

  return raw.map(r => {
    const prof = r.actor_id ? profiles[r.actor_id] : undefined
    const meta = normalizeMeta(r.meta)
    return {
      id: r.id,
      actor_id: r.actor_id,
      actor_name: prof?.name ?? (r.actor_id ? 'Unknown user' : 'System'),
      actor_role: prof?.role ?? null,
      action: r.action,
      target_type: r.target_type,
      target_id: r.target_id,
      entity_label: entityLabelFromMeta(meta),
      meta,
      old_value: pick(meta, ['old', 'before', 'from', 'old_value', 'previous']),
      new_value: pick(meta, ['new', 'after', 'to', 'new_value']),
      ip_address: r.ip_address,
      created_at: r.created_at,
    }
  })
}

// ─── READS ─────────────────────────────────────────────────────────────────

/** Most-recent audit rows (capped), optionally narrowed by date/actor/entity. */
export async function getAuditLogs(query: AuditQuery = {}): Promise<AuditLogRow[]> {
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

  let q = supabase
    .from('audit_logs')
    .select(SELECT_COLS)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (query.from)       q = q.gte('created_at', `${query.from}T00:00:00`)
  if (query.to)         q = q.lte('created_at', `${query.to}T23:59:59.999`)
  if (query.action)     q = q.eq('action', query.action)
  if (query.actorId)    q = q.eq('actor_id', query.actorId)
  if (query.targetType) q = q.eq('target_type', query.targetType)
  if (query.targetId)   q = q.eq('target_id', query.targetId)

  const { data, error } = await q
  if (error) throw error
  return enrich((data ?? []) as RawAuditRow[])
}

export async function getAuditLogById(id: string): Promise<AuditLogRow | null> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select(SELECT_COLS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const [row] = await enrich([data as RawAuditRow])
  return row ?? null
}

export function getAuditLogsByActor(actorId: string, limit = DEFAULT_LIMIT): Promise<AuditLogRow[]> {
  return getAuditLogs({ actorId, limit })
}

export function getAuditLogsByAction(action: string, limit = DEFAULT_LIMIT): Promise<AuditLogRow[]> {
  return getAuditLogs({ action, limit })
}

export function getAuditLogsByEntity(entityType: string, entityId: string, limit = DEFAULT_LIMIT): Promise<AuditLogRow[]> {
  return getAuditLogs({ targetType: entityType, targetId: entityId, limit })
}

/**
 * Dashboard counts. `total` is exact (head count); the category/risk/today
 * breakdowns are computed over the most-recent SUMMARY_SCAN_LIMIT rows, which
 * comfortably covers this app's volume.
 */
export async function getAuditSummary(): Promise<AuditSummary> {
  const [countRes, scanRes] = await Promise.all([
    supabase.from('audit_logs').select('id', { count: 'exact', head: true }),
    supabase
      .from('audit_logs')
      .select('action, created_at')
      .order('created_at', { ascending: false })
      .limit(SUMMARY_SCAN_LIMIT),
  ])

  const scan = (scanRes.data ?? []) as { action: string; created_at: string }[]
  const todayMs = startOfTodayMs()

  const adminCats: AuditCategory[] = ['users', 'organization', 'system_rules', 'role_permissions', 'auth']
  const contentCats: AuditCategory[] = ['articles', 'achievements', 'notifications']
  const systemCats: AuditCategory[] = ['system_rules', 'role_permissions']

  let today = 0, adminActions = 0, userChanges = 0, scoreActions = 0,
      contentChanges = 0, systemChanges = 0, highRisk = 0

  for (const r of scan) {
    const cat = getActionCategory(r.action)
    const risk = getActionRisk(r.action)
    if (new Date(r.created_at).getTime() >= todayMs) today++
    if (adminCats.includes(cat)) adminActions++
    if (cat === 'users') userChanges++
    if (cat === 'scores') scoreActions++
    if (contentCats.includes(cat)) contentChanges++
    if (systemCats.includes(cat)) systemChanges++
    if (risk === 'high' || risk === 'critical') highRisk++
  }

  return {
    total: countRes.count ?? scan.length,
    today,
    adminActions,
    userChanges,
    scoreActions,
    contentChanges,
    systemChanges,
    highRisk,
  }
}

// ─── CSV EXPORT ────────────────────────────────────────────────────────────

function csvCell(v: unknown): string {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v)
  // RFC 4180: wrap in quotes, double any internal quotes.
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * Build a CSV string from already-filtered audit rows. The page passes the
 * current filtered set so the export matches exactly what the admin sees.
 * Audit `meta` in this app holds names/ids/payloads only — never tokens or
 * secrets — so it is safe to include as the details summary column.
 */
export function exportAuditLogsCsv(rows: AuditLogRow[]): string {
  const header = ['Date', 'Actor', 'Actor role', 'Action', 'Category', 'Risk', 'Entity type', 'Entity label', 'Details summary']
  const lines = rows.map(r => [
    new Date(r.created_at).toISOString(),
    r.actor_name,
    r.actor_role ?? '',
    r.action,
    getActionCategory(r.action),
    getActionRisk(r.action),
    r.target_type ?? '',
    r.entity_label ?? '',
    r.meta ? JSON.stringify(r.meta) : '',
  ].map(csvCell).join(','))
  return [header.map(csvCell).join(','), ...lines].join('\r\n')
}

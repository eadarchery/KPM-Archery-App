import { supabase } from './supabase'
import type { AuditLog } from '@/types'

export async function writeAuditLog(
  actorId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  meta?: object,
) {
  const { error } = await supabase.rpc('log_audit', {
    p_actor_id:    actorId,
    p_action:      action,
    p_target_type: targetType ?? null,
    p_target_id:   targetId ?? null,
    // Pass the object as-is: supabase-js serializes RPC params, and p_meta is
    // jsonb. JSON.stringify-ing here double-encodes it into a jsonb *string*
    // scalar, which crashed the audit viewer (migration 060 repairs old rows).
    p_meta:        meta ?? null,
  })
  if (error) console.warn('Audit log failed:', error.message)
}

export async function getAuditLogs(options?: {
  actorId?: string
  action?: string
  targetType?: string
  limit?: number
  offset?: number
}) {
  const { actorId, action, targetType, limit = 100, offset = 0 } = options ?? {}

  let q = supabase
    .from('audit_logs')
    .select('*, actor:actor_id(name, role)')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (actorId)    q = q.eq('actor_id', actorId)
  if (action)     q = q.eq('action', action)
  if (targetType) q = q.eq('target_type', targetType)

  const { data, error } = await q
  if (error) throw error
  return data as AuditLog[]
}

export async function getAuditCount(): Promise<number> {
  const today = new Date().toISOString().split('T')[0]
  const { count, error } = await supabase
    .from('audit_logs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${today}T00:00:00`)
  if (error) return 0
  return count ?? 0
}

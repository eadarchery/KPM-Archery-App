import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import type { ScopeAssignment } from '@/lib/scope'

/**
 * Admin 1 multi-scope assignments (core.admin1_scopes, migration 052).
 * Admin 2 manages them; each Admin 1 can read their own.
 */

export async function getAdmin1Scopes(adminId: string): Promise<ScopeAssignment[]> {
  const { data, error } = await supabase
    .from('admin1_scopes')
    .select('level, ref_id')
    .eq('admin_id', adminId)
  if (error) {
    // Migration 052 not applied yet → behave as "no assignments" (legacy scope).
    if ((error as { code?: string }).code === '42P01') return []
    throw error
  }
  return (data ?? []) as ScopeAssignment[]
}

/** Replace an admin's assignments with the given set (delete + insert). */
export async function saveAdmin1Scopes(
  actorId: string,
  adminId: string,
  rows: ScopeAssignment[],
): Promise<void> {
  const { error: delErr } = await supabase.from('admin1_scopes').delete().eq('admin_id', adminId)
  if (delErr) throw delErr
  if (rows.length) {
    const { error: insErr } = await supabase
      .from('admin1_scopes')
      .insert(rows.map(r => ({ admin_id: adminId, level: r.level, ref_id: r.ref_id })))
    if (insErr) throw insErr
  }
  writeAuditLog(actorId, 'admin1.scope_assigned', 'profile', adminId, {
    assignments: rows.length,
    states: rows.filter(r => r.level === 'state').length,
    plds: rows.filter(r => r.level === 'pld').length,
    schools: rows.filter(r => r.level === 'school').length,
  }).catch(console.warn)
}

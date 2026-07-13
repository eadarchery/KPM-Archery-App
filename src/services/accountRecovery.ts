import { supabase } from './supabase'
import { writeAuditLog } from './auditLog'
import { useAuthStore } from '@/store/authStore'
import { assertCan, isOperationalAdmin } from '@/lib/permissions'
import type { Role } from '@/types'

// ─── TYPES ───────────────────────────────────────────────────────────────────

export type AccountRecoveryStatus = 'pending' | 'reviewing' | 'resolved' | 'rejected'

export interface AccountRecoveryRequest {
  id: string
  full_name: string
  role: Role | null
  phone: string | null
  archer_id: string | null
  school_name: string | null
  state_name: string | null
  pld_name: string | null
  coach_name: string | null
  notes: string | null
  status: AccountRecoveryStatus
  reviewed_by: string | null
  reviewed_at: string | null
  admin_notes: string | null
  created_at: string
  updated_at: string
}

/** Public submission payload (camelCase from the form). */
export interface AccountRecoveryInput {
  fullName: string
  role?: string
  phone?: string
  archerId?: string
  school?: string
  state?: string
  pld?: string
  coachName?: string
  notes?: string
}

// ─── ACTOR HELPER ────────────────────────────────────────────────────────────

function currentActor(): { id: string | undefined; role: Role | undefined } {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

// ─── PUBLIC SUBMISSION (anon allowed) ────────────────────────────────────────

/**
 * Submit an account recovery request. Callable by ANYONE (including
 * unauthenticated users) — RLS allows insert-only.
 *
 * Deliberately does NOT `.select()` the row back: anon has no SELECT policy, and
 * the caller must never learn anything about stored data or whether an account
 * exists. We only surface success/failure of the write.
 *
 * This changes no account, role, status, email or password — it only files a
 * request for an admin to review.
 */
export async function submitAccountRecoveryRequest(input: AccountRecoveryInput): Promise<void> {
  const trimmed = (v?: string) => {
    const t = (v ?? '').trim()
    return t.length ? t : null
  }

  const { error } = await supabase.from('account_recovery_requests').insert({
    full_name: input.fullName.trim(),
    role: trimmed(input.role),
    phone: trimmed(input.phone),
    archer_id: trimmed(input.archerId),
    school_name: trimmed(input.school),
    state_name: trimmed(input.state),
    pld_name: trimmed(input.pld),
    coach_name: trimmed(input.coachName),
    notes: trimmed(input.notes),
    // status defaults to 'pending' in the DB; review fields stay null.
  })

  // Note: public submission is intentionally NOT written to the audit log — anon
  // has no audit write access, and the request row itself (with created_at) is
  // the record. Admin actions below ARE audited.
  if (error) throw error
}

// ─── ADMIN READS / WRITES (Admin 2 + Super Admin only) ───────────────────────

export interface RecoveryFilters {
  status?: AccountRecoveryStatus | 'all'
}

export async function getAccountRecoveryRequests(
  filters: RecoveryFilters = {},
): Promise<AccountRecoveryRequest[]> {
  assertCan(isOperationalAdmin(currentActor().role), 'view account recovery requests')

  let q = supabase
    .from('account_recovery_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as AccountRecoveryRequest[]
}

export async function updateAccountRecoveryRequestStatus(
  id: string,
  status: AccountRecoveryStatus,
  adminNotes?: string,
): Promise<AccountRecoveryRequest> {
  assertCan(isOperationalAdmin(currentActor().role), 'update account recovery requests')
  const { id: actorId } = currentActor()

  const { data, error } = await supabase
    .from('account_recovery_requests')
    .update({
      status,
      admin_notes: adminNotes?.trim() || null,
      reviewed_by: actorId ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error

  if (actorId) {
    await writeAuditLog(actorId, 'account_recovery.status_updated', 'account_recovery_request', id, { status })
    if (status === 'resolved') {
      await writeAuditLog(actorId, 'account_recovery.resolved', 'account_recovery_request', id)
    } else if (status === 'rejected') {
      await writeAuditLog(actorId, 'account_recovery.rejected', 'account_recovery_request', id)
    }
  }

  return data as AccountRecoveryRequest
}

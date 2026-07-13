import { supabase } from './supabase'

/**
 * School-code archer registration + coach approval.
 *
 * All calls go through SECURITY DEFINER RPCs (migration 034) so the client never
 * sets school_id directly and no broad coach UPDATE policy exists on profiles.
 */

/** Resolve a school code to its name for confirmation. Returns null if invalid. */
export async function resolveSchoolCode(code: string): Promise<string | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const { data, error } = await supabase.rpc('resolve_school_code', { p_code: trimmed })
  if (error) return null
  return (data as string | null) ?? null
}

/** Claim a school code for the current pending archer (sets requested_school_id). Returns the school name. */
export async function claimSchoolCode(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('claim_school_code', { p_code: code.trim() })
  if (error) throw error
  return data as string
}

// ─── DEFERRED CLAIM (email-confirmation flow) ────────────────────────────────
// With email confirmation enabled there is no session right after sign-up, so
// the school code cannot be claimed then (claim_school_code needs auth.uid()).
// We stash the validated code and claim it on the archer's first sign-in.

const PENDING_SCHOOL_CODE_KEY = 'asm_pending_school_code'

export function storePendingSchoolCode(code: string): void {
  try { localStorage.setItem(PENDING_SCHOOL_CODE_KEY, code.trim()) } catch { /* ignore */ }
}

export function clearPendingSchoolCode(): void {
  try { localStorage.removeItem(PENDING_SCHOOL_CODE_KEY) } catch { /* ignore */ }
}

/**
 * Claim a school code stashed at registration, once the archer has a session
 * (e.g. after confirming their email and signing in). Safe to call on every
 * sign-in: it no-ops when there is no stored code and clears the code on success
 * so it never double-claims. Failures are kept for a later retry and surfaced
 * only in development (never block sign-in).
 */
export async function claimPendingSchoolCodeIfAny(): Promise<void> {
  let code: string | null = null
  try { code = localStorage.getItem(PENDING_SCHOOL_CODE_KEY) } catch { code = null }
  if (!code) return
  try {
    await claimSchoolCode(code)
    clearPendingSchoolCode()
  } catch (err) {
    if (import.meta.env.DEV) console.error('[schoolRegistration] deferred claim failed:', err)
  }
}

export interface PendingSchoolArcher {
  id: string
  name: string
  email: string
  archer_id: string | null
  requested_school_id: string
  created_at: string
}

/** Pending archers who requested the current coach's school. Empty if not an approved coach. */
export async function getPendingSchoolArchers(): Promise<PendingSchoolArcher[]> {
  const { data, error } = await supabase.rpc('coach_pending_archers')
  if (error) throw error
  return (data ?? []) as PendingSchoolArcher[]
}

/** Approve a pending archer at the coach's school (status, school, coach link, audit). */
export async function approveSchoolArcher(archerId: string): Promise<void> {
  const { error } = await supabase.rpc('coach_approve_archer', { p_archer_id: archerId })
  if (error) throw error
}

/**
 * Reject a pending school-code registration (migration 056). Scoped exactly like
 * approve: the RPC verifies the archer requested THIS coach's school. The reason
 * is stored on the profile and audited; the archer may re-register with a
 * correct code later.
 */
export async function rejectSchoolArcher(archerId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('coach_reject_archer', {
    p_archer_id: archerId,
    p_reason: reason.trim(),
  })
  if (error) throw error
}

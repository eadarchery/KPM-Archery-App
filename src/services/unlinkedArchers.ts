import { supabase } from './supabase'

/**
 * Unlinked-archer admin validation (migration 059).
 *
 * An archer with no ACTIVE coach link has nobody to validate their scores.
 * These wrappers call scoped SECURITY DEFINER RPCs so Admin 1 (within their
 * assigned scope) and Admin 2 / Super Admin can list unlinked archers and
 * approve/reject their pending scores. All scope enforcement is server-side —
 * the RPCs re-check the caller, so mounting these in any admin page is safe.
 */

export interface UnlinkedArcher {
  id: string
  name: string
  archer_id: string | null
  email: string | null
  state_id: string | null
  pld_id: string | null
  school_id: string | null
  state_name: string | null
  pld_name: string | null
  school_name: string | null
  last_coach_name: string | null
  last_score_date: string | null
}

export interface UnlinkedPendingScore {
  id: string
  archer_id: string
  archer_name: string
  archer_code: string | null
  round_id: string
  round_name: string
  round_category: string
  total_score: number
  max_score: number
  date: string
  bow_category: string | null
  age_group: string | null
  proof_url: string | null
  state_id: string | null
  pld_id: string | null
  school_id: string | null
  school_name: string | null
  state_code: string | null
  created_at: string
}

/** Approved archers with no active coach link, scoped to the caller (Task 10). */
export async function getUnlinkedArchers(): Promise<UnlinkedArcher[]> {
  const { data, error } = await supabase.rpc('admin_unlinked_archers')
  if (error) throw error
  return (data ?? []) as UnlinkedArcher[]
}

/** Pending scores of unlinked archers, scoped to the caller (Task 9 queue). */
export async function getUnlinkedPendingScores(): Promise<UnlinkedPendingScore[]> {
  const { data, error } = await supabase.rpc('admin_unlinked_pending_scores')
  if (error) throw error
  return (data ?? []) as UnlinkedPendingScore[]
}

/** Approve or reject one pending score of an unlinked archer (scoped, audited). */
export async function validateUnlinkedScore(
  id: string,
  approve: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_validate_unlinked_score', {
    p_id: id,
    p_approve: approve,
    p_reason: reason ?? null,
  })
  if (error) throw error
}

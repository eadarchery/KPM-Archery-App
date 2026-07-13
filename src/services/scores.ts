import { supabase } from './supabase'
import { useAuthStore } from '@/store/authStore'
import { writeAuditLog } from './auditLog'
import { assertCan, canApproveScores } from '@/lib/permissions'
import { compressImage, compressPresets } from '@/lib/imageCompress'
import type { Role, ScoreSubmission } from '@/types'

/** Current actor (id + role) for service-layer permission guards. */
function actor(): { id: string | undefined; role: Role | undefined } {
  const p = useAuthStore.getState().profile
  return { id: p?.id, role: p?.role }
}

/** Extra context recorded in the audit log alongside a validation action. */
export interface ScoreActionMeta {
  archer_name?: string
  round_name?: string
  score?: string
  old_status?: string
}

export async function submitScore(payload: {
  archer_id: string
  round_id: string
  coach_id?: string
  date: string
  session_time?: string | null
  total_score: number
  max_score: number
  arrows_data?: object
  plot_data?: object
  proof_url?: string
  notes?: string
  sync_source?: string
  // Bow category the score was shot in + calendar-year age snapshot, frozen at
  // submission so badges + history stay correct after the archer changes group.
  bow_category?: string | null
  competition_year?: number | null
  competition_age?: number | null
  age_group?: string | null
}): Promise<ScoreSubmission> {
  const { data, error } = await supabase
    .from('score_submissions')
    .insert({ ...payload, status: 'pending' })
    .select()
    .single()
  if (error) throw error
  return data as ScoreSubmission
}

export async function getSubmission(id: string) {
  const { data, error } = await supabase
    .from('score_submissions')
    .select('*, round:round_id(*), archer:archer_id(*)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as ScoreSubmission
}

export async function coachApproveScore(id: string) {
  const { data, error } = await supabase
    .from('score_submissions')
    .update({ status: 'coach_approved', coach_approved_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as ScoreSubmission
}

export async function coachRejectScore(id: string, reason: string) {
  const { data, error } = await supabase
    .from('score_submissions')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as ScoreSubmission
}

export async function adminApproveScore(id: string, approverId: string) {
  const { data, error } = await supabase
    .from('score_submissions')
    .update({
      status: 'admin_approved',
      admin_approved_at: new Date().toISOString(),
      approved_by: approverId,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as ScoreSubmission
}

export async function adminRejectScore(id: string, reason: string) {
  const { data, error } = await supabase
    .from('score_submissions')
    .update({ status: 'rejected', rejection_reason: reason })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as ScoreSubmission
}

export async function getPendingScores(coachId?: string) {
  let q = supabase
    .from('score_submissions')
    .select('*, round:round_id(name, max_score), archer:archer_id(name, archer_id, state_id)')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  if (coachId) q = q.eq('coach_id', coachId)

  const { data, error } = await q
  if (error) throw error
  return data as ScoreSubmission[]
}

export async function uploadProofPhoto(
  archerId: string,
  submissionId: string,
  file: File,
) {
  // Camera shots are often 3–10 MB; compress to a ~sub-MB JPEG before upload.
  const upload = await compressImage(file, compressPresets.proofPhoto)
  const ext = upload.name.split('.').pop()
  const path = `${archerId}/${submissionId}.${ext}`
  const { error: uploadError } = await supabase.storage
    .from('proof-photos')
    .upload(path, upload, { upsert: true })
  if (uploadError) throw uploadError

  // proof-photos is a PRIVATE bucket — a public URL would 400 for everyone.
  // Store the object PATH; every viewer (admin2/coach Scores, PLD validation)
  // already resolves non-http values through createSignedUrl at display time.
  // Legacy rows holding full URLs keep working via their startsWith('http') branch.
  return path
}

// ─── GUARDED VALIDATION (admin2 / super_admin) ───────────────────────────────
// These fail fast on the client with a clear message if the role is not allowed
// (RLS remains the real guard) and write a rich audit entry via the log_audit
// RPC. The DB also auto-logs the raw status change + auto-grants achievements
// on the admin_approved transition (migration 007 triggers), so callers do NOT
// need to trigger achievements manually.

/** Admin 2 / Super Admin: validate a submission → counts on the leaderboard. */
export async function approveScore(id: string, meta?: ScoreActionMeta): Promise<ScoreSubmission> {
  const { id: actorId, role } = actor()
  assertCan(canApproveScores(role), 'validate scores')
  if (!actorId) throw new Error('Not authenticated.')

  const { data, error } = await supabase
    .from('score_submissions')
    .update({
      status: 'admin_approved',
      admin_approved_at: new Date().toISOString(),
      approved_by: actorId,
      rejection_reason: null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  await writeAuditLog(actorId, 'score.approved', 'score_submission', id, {
    ...meta,
    new_status: 'admin_approved',
  })
  return data as ScoreSubmission
}

/** Admin 2 / Super Admin: reject a submission with a required reason. */
export async function rejectScore(id: string, reason: string, meta?: ScoreActionMeta): Promise<ScoreSubmission> {
  const { id: actorId, role } = actor()
  assertCan(canApproveScores(role), 'reject scores')
  if (!actorId) throw new Error('Not authenticated.')
  if (!reason.trim()) throw new Error('A rejection reason is required.')

  const { data, error } = await supabase
    .from('score_submissions')
    .update({ status: 'rejected', rejection_reason: reason.trim() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error

  await writeAuditLog(actorId, 'score.rejected', 'score_submission', id, {
    ...meta,
    reason: reason.trim(),
    new_status: 'rejected',
  })
  return data as ScoreSubmission
}

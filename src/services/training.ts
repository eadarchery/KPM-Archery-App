import { supabase } from './supabase'
import type { TrainingLog } from '@/types'

export async function logTrainingSession(payload: {
  archer_id: string
  coach_id?: string
  date: string
  arrows_shot: number
  session_type?: string
  notes?: string
  sync_source?: string
}): Promise<TrainingLog> {
  const { data, error } = await supabase
    .from('training_logs')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as TrainingLog
}

export async function getMyTrainingLogs(archerId: string, limit = 100) {
  const { data, error } = await supabase
    .from('training_logs')
    .select('*')
    .eq('archer_id', archerId)
    .order('date', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data as TrainingLog[]
}

export async function getTotalArrows(archerId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_archer_total_arrows', {
    p_archer_id: archerId,
  })
  if (error) throw error
  return (data as number) ?? 0
}

export async function bulkInsertTrainingLogs(
  rows: Array<{
    archer_id: string
    date: string
    arrows_shot: number
    session_type?: string
    notes?: string
  }>,
  sync_source = 'excel',
) {
  const payload = rows.map((r) => ({ ...r, sync_source }))
  const { data, error } = await supabase
    .from('training_logs')
    .insert(payload)
    .select()
  if (error) throw error
  return data as TrainingLog[]
}

export async function deleteTrainingLog(id: string) {
  const { error } = await supabase.from('training_logs').delete().eq('id', id)
  if (error) throw error
}

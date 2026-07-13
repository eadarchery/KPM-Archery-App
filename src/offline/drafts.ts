import { dbGet, dbPut, dbDelete, dbGetAll } from './db'
import { uid } from '@/utils/format'
import type { SyncItemType } from '@/types'

interface Draft {
  id: string
  type: SyncItemType
  label: string
  data: Record<string, unknown>
  updated_at: string
}

export async function saveDraft(
  type: SyncItemType,
  label: string,
  data: Record<string, unknown>,
  existingId?: string,
): Promise<string> {
  const id = existingId ?? uid('draft')
  const draft: Draft = { id, type, label, data, updated_at: new Date().toISOString() }
  await dbPut('drafts', draft)
  return id
}

export async function loadDraft(id: string): Promise<Draft | undefined> {
  return dbGet<Draft>('drafts', id)
}

export async function deleteDraft(id: string): Promise<void> {
  await dbDelete('drafts', id)
}

export async function listDrafts(type?: SyncItemType): Promise<Draft[]> {
  const all = await dbGetAll<Draft>('drafts')
  return type ? all.filter((d) => d.type === type) : all
}

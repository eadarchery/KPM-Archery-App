import { dbPut, dbGetAll, dbDelete, dbGet } from './db'
import { uid } from '@/utils/format'
import type { SyncQueueItem, SyncItemType, SyncStatus } from '@/types'

// ─── ENQUEUE ─────────────────────────────────────────────────────────────────

export async function enqueue(
  type: SyncItemType,
  payload: Record<string, unknown>,
): Promise<SyncQueueItem> {
  const item: SyncQueueItem = {
    id: uid('sync'),
    type,
    payload,
    status: 'local',
    created_at: new Date().toISOString(),
  }
  await dbPut('sync_queue', item)
  return item
}

// ─── STATUS UPDATE ────────────────────────────────────────────────────────────

export async function setItemStatus(
  id: string,
  status: SyncStatus,
  error?: string,
): Promise<void> {
  const item = await dbGet<SyncQueueItem>('sync_queue', id)
  if (!item) return
  const updated: SyncQueueItem = {
    ...item,
    status,
    last_attempt: new Date().toISOString(),
    error,
  }
  await dbPut('sync_queue', updated)
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

export async function getPendingItems(): Promise<SyncQueueItem[]> {
  const all = await dbGetAll<SyncQueueItem>('sync_queue')
  return all.filter((i) => i.status === 'local' || i.status === 'failed')
}

export async function getFailedItems(): Promise<SyncQueueItem[]> {
  const all = await dbGetAll<SyncQueueItem>('sync_queue')
  return all.filter((i) => i.status === 'failed')
}

export async function getAllQueueItems(): Promise<SyncQueueItem[]> {
  return dbGetAll<SyncQueueItem>('sync_queue')
}

export async function removeItem(id: string): Promise<void> {
  await dbDelete('sync_queue', id)
}

// ─── SYNC ATTEMPT ────────────────────────────────────────────────────────────
// The actual network call is delegated to the caller. This just manages queue state.

export async function attemptSync(
  item: SyncQueueItem,
  syncFn: (payload: Record<string, unknown>) => Promise<void>,
): Promise<'synced' | 'failed'> {
  await setItemStatus(item.id, 'pending')
  try {
    await syncFn(item.payload)
    await removeItem(item.id)
    return 'synced'
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await setItemStatus(item.id, 'failed', msg)
    return 'failed'
  }
}

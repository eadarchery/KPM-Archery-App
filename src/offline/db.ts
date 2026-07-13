import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { SyncQueueItem, SyncItemType } from '@/types'

interface AsmDB extends DBSchema {
  sync_queue: {
    key: string
    value: SyncQueueItem
    indexes: { by_status: string; by_type: string }
  }
  drafts: {
    key: string
    value: {
      id: string
      type: SyncItemType
      label: string
      data: Record<string, unknown>
      updated_at: string
    }
  }
}

let _db: IDBPDatabase<AsmDB> | null = null

export async function getDb(): Promise<IDBPDatabase<AsmDB>> {
  if (_db) return _db

  _db = await openDB<AsmDB>('asm-offline', 2, {
    upgrade(db, oldVersion) {
      // sync_queue store
      if (!db.objectStoreNames.contains('sync_queue')) {
        const store = db.createObjectStore('sync_queue', { keyPath: 'id' })
        store.createIndex('by_status', 'status')
        store.createIndex('by_type', 'type')
      }
      // drafts store
      if (!db.objectStoreNames.contains('drafts')) {
        db.createObjectStore('drafts', { keyPath: 'id' })
      }
    },
  })

  return _db
}

// ─── LOW-LEVEL HELPERS ───────────────────────────────────────────────────────

export async function dbGet<T>(store: 'sync_queue' | 'drafts', key: string): Promise<T | undefined> {
  const db = await getDb()
  return db.get(store, key) as Promise<T | undefined>
}

export async function dbPut<T>(store: 'sync_queue' | 'drafts', value: T): Promise<void> {
  const db = await getDb()
  await db.put(store, value as never)
}

export async function dbDelete(store: 'sync_queue' | 'drafts', key: string): Promise<void> {
  const db = await getDb()
  await db.delete(store, key)
}

export async function dbGetAll<T>(store: 'sync_queue' | 'drafts'): Promise<T[]> {
  const db = await getDb()
  return db.getAll(store) as Promise<T[]>
}

/**
 * Wipe all locally stored offline data (drafts + sync queue). Called on
 * sign-out so the next user on a shared device cannot see or sync the
 * previous user's data — the store is device-global, not per-account.
 */
export async function clearOfflineData(): Promise<void> {
  const db = await getDb()
  await db.clear('sync_queue')
  await db.clear('drafts')
}

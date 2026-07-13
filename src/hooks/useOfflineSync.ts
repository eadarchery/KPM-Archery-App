import { useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPendingItems, getFailedItems, attemptSync, removeItem } from '@/offline/syncQueue'
import { submitScore } from '@/services/scores'
import { logTrainingSession } from '@/services/training'
import type { SyncQueueItem } from '@/types'

// Map of queue item types to their sync functions
const SYNC_HANDLERS: Record<string, (payload: any) => Promise<any>> = {
  score_submission: (payload) => submitScore(payload),
  training_log:    (payload) => logTrainingSession(payload),
}

export function useOfflineSync() {
  const queryClient = useQueryClient()
  const syncingRef  = useRef(false)

  const { data: pendingItems = [] } = useQuery({
    queryKey: ['sync-queue', 'pending'],
    queryFn: getPendingItems,
    refetchInterval: 30_000, // check every 30s
  })

  const { data: failedItems = [] } = useQuery({
    queryKey: ['sync-queue', 'failed'],
    queryFn: getFailedItems,
  })

  const syncMutation = useMutation({
    mutationFn: async (items: SyncQueueItem[]) => {
      const results = await Promise.allSettled(
        items.map((item) => {
          const handler = SYNC_HANDLERS[item.type]
          if (!handler) return Promise.resolve()
          return attemptSync(item, handler)
        }),
      )
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync-queue'] })
      queryClient.invalidateQueries({ queryKey: ['my-scores'] })
      queryClient.invalidateQueries({ queryKey: ['my-training'] })
    },
  })

  const runSync = useCallback(async () => {
    if (syncingRef.current || !navigator.onLine) return
    const pending = await getPendingItems()
    if (!pending.length) return

    syncingRef.current = true
    try {
      await syncMutation.mutateAsync(pending)
    } finally {
      syncingRef.current = false
    }
  }, [syncMutation])

  // Sync when app comes online
  useEffect(() => {
    const onOnline = () => runSync()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [runSync])

  // Initial sync attempt on mount
  useEffect(() => {
    if (navigator.onLine) runSync()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    pendingCount: pendingItems.length,
    failedCount:  failedItems.length,
    isSyncing:    syncMutation.isPending,
    isOnline:     navigator.onLine,
    runSync,
    clearFailed:  async (id: string) => {
      await removeItem(id)
      queryClient.invalidateQueries({ queryKey: ['sync-queue', 'failed'] })
    },
  }
}

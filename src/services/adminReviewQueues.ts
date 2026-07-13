import { supabase } from './supabase'

export type AdminReviewQueue = 'scores' | 'certifications' | 'change_requests'

export interface AdminReviewCursor {
  createdAt: string
  id: string
}

export interface AdminReviewPage<T> {
  items: T[]
  nextCursor: AdminReviewCursor | null
}

export async function getAdminReviewPage<T extends { id: string; created_at: string }>(
  queue: AdminReviewQueue,
  filters: Record<string, string | boolean | null | undefined>,
  cursor: AdminReviewCursor | null,
  limit = 50,
): Promise<AdminReviewPage<T>> {
  const pageSize = Math.min(Math.max(limit, 1), 100)
  const cleanFilters = Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== '' && value !== null && value !== undefined && value !== false),
  )
  const { data, error } = await supabase.rpc('admin2_review_queue_page', {
    p_queue: queue,
    p_filters: cleanFilters,
    p_after_created: cursor?.createdAt ?? null,
    p_after_id: cursor?.id ?? null,
    p_limit: pageSize,
  })
  if (error) throw error

  const rows = (data ?? []) as unknown as T[]
  const hasNext = rows.length > pageSize
  const items = hasNext ? rows.slice(0, pageSize) : rows
  const last = items[items.length - 1]
  return {
    items,
    nextCursor: hasNext && last ? { createdAt: last.created_at, id: last.id } : null,
  }
}

export async function getAdminReviewSummary<T extends Record<string, number>>(
  queue: AdminReviewQueue,
): Promise<T> {
  const { data, error } = await supabase.rpc('admin2_review_queue_summary', { p_queue: queue })
  if (error) throw error
  return (data ?? {}) as T
}

import { supabase } from './supabase'
import type { Notification, NotificationAudience, NotificationCategory, NotificationPriority, NotificationStatus } from '@/types'

// ─── PUBLIC / USER QUERIES ────────────────────────────────────────────────────

export async function getMyNotifications(profileId: string) {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('notifications')
    .select('*, notification_reads!left(read_at)')
    .not('published_at', 'is', null)
    .lte('published_at', now)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('published_at', { ascending: false })
    .limit(100)
  if (error) throw error
  return (data ?? []).map((n: any) => ({
    ...n,
    is_read: (n.notification_reads ?? []).length > 0,
  })) as Notification[]
}

export async function markAsRead(notificationId: string, profileId: string) {
  const { error } = await supabase
    .from('notification_reads')
    .upsert({
      notification_id: notificationId,
      profile_id: profileId,
      read_at: new Date().toISOString(),
    })
  if (error) throw error
}

export async function markAllRead(notificationIds: string[], profileId: string) {
  if (notificationIds.length === 0) return
  const rows = notificationIds.map((id) => ({
    notification_id: id,
    profile_id: profileId,
    read_at: new Date().toISOString(),
  }))
  const { error } = await supabase.from('notification_reads').upsert(rows)
  if (error) throw error
}

export async function getUnreadCount(profileId: string): Promise<number> {
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('notifications')
    .select('id, notification_reads!left(read_at)')
    .not('published_at', 'is', null)
    .lte('published_at', now)
  if (error) return 0
  return (data ?? []).filter((n: any) => !(n.notification_reads ?? []).length).length
}

// ─── ADMIN QUERIES ────────────────────────────────────────────────────────────

export async function getAllNotificationsAdmin(limit = 200) {
  // No embedding — resolve authors separately (embeds fail through the views).
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = (data ?? []) as Notification[]
  const authorIds = [...new Set(rows.map(r => (r as { created_by?: string }).created_by).filter(Boolean))] as string[]
  if (authorIds.length) {
    const { data: authors } = await supabase.from('profiles').select('id, name, role').in('id', authorIds)
    const amap = new Map(((authors ?? []) as { id: string; name: string; role: string }[]).map(a => [a.id, a]))
    for (const r of rows) {
      const cid = (r as { created_by?: string }).created_by
      ;(r as { author?: { name: string; role: string } }).author = cid ? amap.get(cid) : undefined
    }
  }
  return rows
}

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

export interface NotifPayload {
  title: string
  body: string
  /** Optional cover image (public URL). Recommended 1200×630 px. */
  image_url?: string | null
  audience: NotificationAudience
  audience_ref: string | null
  category: NotificationCategory
  priority: NotificationPriority
  status: NotificationStatus
  created_by: string
  published_at: string | null
  expires_at: string | null
}

export async function createNotification(payload: NotifPayload): Promise<Notification> {
  const { data, error } = await supabase
    .from('notifications')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as Notification
}

export type NotifUpdate = Partial<Omit<NotifPayload, 'created_by'>>

export async function updateNotification(id: string, updates: NotifUpdate): Promise<Notification> {
  const { data, error } = await supabase
    .from('notifications')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Notification
}

export async function publishNotification(id: string): Promise<Notification> {
  const { data, error } = await supabase
    .from('notifications')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Notification
}

export async function archiveNotification(id: string): Promise<Notification> {
  const { data, error } = await supabase
    .from('notifications')
    .update({ status: 'archived' })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Notification
}

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', id)
  if (error) throw error
}

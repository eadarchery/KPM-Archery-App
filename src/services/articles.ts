import { supabase } from './supabase'
import { useAuthStore } from '@/store/authStore'
import { assertCan, canManageArticles } from '@/lib/permissions'
import type { Article, ArticleBlock, ArticleStatus } from '@/types'

/**
 * Client-side guard for article mutations. RLS (articles_admin2_full) is the
 * real authority on the server; this fails fast with a friendly message for
 * non-admin2/super_admin roles instead of surfacing a raw Postgres error.
 */
function assertCanManageArticles(): void {
  const role = useAuthStore.getState().profile?.role
  assertCan(canManageArticles(role), 'manage articles')
}

export interface ArticlePayload {
  title: string
  slug: string
  summary?: string
  cover_url?: string
  body_blocks: ArticleBlock[]
  audience: string
  category?: string
  tags?: string[]
  author_name?: string | null
  is_featured?: boolean
  author_id: string
  status?: ArticleStatus
}

export interface ArticleUpdate {
  title?: string
  slug?: string
  summary?: string
  cover_url?: string
  body_blocks?: ArticleBlock[]
  audience?: string
  category?: string
  tags?: string[]
  author_name?: string | null
  is_featured?: boolean
  status?: ArticleStatus
  published_at?: string | null
  archived_at?: string | null
  updated_by?: string
}

/**
 * De-embed + stitch: public.articles is a VIEW over content.articles, so
 * PostgREST cannot resolve the articles.author_id → profiles foreign key for an
 * embedded `author:author_id(...)` select ("Could not find a relationship …").
 * We fetch plain rows and attach the author from profiles client-side — the same
 * pattern used across the KPM report layer. Author reads still honour RLS.
 */
type AuthorLite = { id: string; name: string | null; role: string | null }

async function attachAuthors<T extends { author_id?: string | null }>(rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map((r) => r.author_id).filter(Boolean) as string[])]
  if (!ids.length) return rows.map((r) => ({ ...r, author: null }))
  const { data } = await supabase.from('profiles').select('id, name, role').in('id', ids)
  const byId = new Map((data ?? []).map((p) => [(p as AuthorLite).id, p as AuthorLite]))
  return rows.map((r) => ({ ...r, author: r.author_id ? byId.get(r.author_id) ?? null : null }))
}

export async function getAllArticlesAdmin(limit = 200): Promise<Article[]> {
  const { data, error } = await supabase
    .from('articles')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return attachAuthors((data ?? []) as Article[])
}

export async function createArticle(payload: ArticlePayload): Promise<Article> {
  assertCanManageArticles()
  const { data, error } = await supabase
    .from('articles')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw error
  return (await attachAuthors([data as Article]))[0]
}

export async function updateArticle(id: string, payload: ArticleUpdate): Promise<Article> {
  assertCanManageArticles()
  const { data, error } = await supabase
    .from('articles')
    .update(payload)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return (await attachAuthors([data as Article]))[0]
}

export async function deleteArticle(id: string): Promise<void> {
  assertCanManageArticles()
  const { error } = await supabase.from('articles').delete().eq('id', id)
  if (error) throw error
}

export async function getPublishedArticlesForRole(role: string): Promise<Article[]> {
  const now = new Date().toISOString()
  let query = supabase
    .from('articles')
    .select('*')
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', now)
    .order('published_at', { ascending: false })
    .limit(200)

  if (role !== 'super_admin') {
    query = query.or(`audience.eq.all,audience.eq.${role}`)
  }

  const { data, error } = await query
  if (error) throw error
  return attachAuthors((data ?? []) as Article[])
}

/** Newest visible published_at for the role — used for the nav "new article" dot. */
export async function getLatestArticleDate(role: string): Promise<string | null> {
  const now = new Date().toISOString()
  let query = supabase
    .from('articles')
    .select('published_at')
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', now)
    .order('published_at', { ascending: false })
    .limit(1)
  if (role !== 'super_admin') {
    query = query.or(`audience.eq.all,audience.eq.${role}`)
  }
  const { data } = await query
  return data?.[0]?.published_at ?? null
}

export async function getPublishedArticleBySlug(slug: string, role: string): Promise<Article | null> {
  const now = new Date().toISOString()
  let query = supabase
    .from('articles')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'published')
    .not('published_at', 'is', null)
    .lte('published_at', now)

  if (role !== 'super_admin') {
    query = query.or(`audience.eq.all,audience.eq.${role}`)
  }

  const { data, error } = await query.maybeSingle()
  if (error) throw error
  if (!data) return null
  return (await attachAuthors([data as Article]))[0]
}

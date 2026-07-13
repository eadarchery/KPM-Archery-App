/**
 * Centralised role configuration — single source of truth for access data.
 *
 * Contains DATA only (no React, no Supabase) so it can be imported by the
 * router, navigation, services and the permission helpers alike:
 *   • role hierarchy / ranking
 *   • each role's home (default redirect) path
 *   • which app "sections" each role may enter
 *
 * Internal role values are FIXED and must never be renamed:
 *   archer · coach · admin1 · admin2 · super_admin
 *
 * i18n note: keep this file free of human-facing display copy. Section keys
 * and paths are internal identifiers, not UI text, so a Bahasa Malaysia /
 * English layer can be added later without touching access logic.
 */
import type { Role } from '@/types'

// ─── HIERARCHY ────────────────────────────────────────────────────────────────
// Ordered least → most privileged. Index = rank.

export const ROLE_HIERARCHY: readonly Role[] = [
  'archer',
  'coach',
  'admin1',
  'admin2',
  'super_admin',
] as const

export function roleRank(role: Role | null | undefined): number {
  return role ? ROLE_HIERARCHY.indexOf(role) : -1
}

/** True when `role` sits at or above `min` in the hierarchy. */
export function roleAtLeast(role: Role | null | undefined, min: Role): boolean {
  return roleRank(role) >= roleRank(min)
}

// ─── SECTIONS ─────────────────────────────────────────────────────────────────
// A "section" is a top-level routed area of the app.

export type AppSection =
  | 'archer'
  | 'coach'
  | 'admin1'
  | 'admin2'
  | 'super_admin'
  | 'articles'

/**
 * Which sections each role may enter. super_admin shadows every lower role
 * and may therefore enter every section.
 */
export const ROLE_SECTIONS: Record<Role, AppSection[]> = {
  archer:      ['archer', 'articles'],
  coach:       ['coach', 'articles'],
  admin1:      ['admin1', 'articles'],
  admin2:      ['admin2', 'articles'],
  super_admin: ['archer', 'coach', 'admin1', 'admin2', 'super_admin', 'articles'],
}

/** Map a route path (e.g. "/admin2/users") to its section, or null if public/unknown. */
export function sectionForPath(path: string): AppSection | null {
  const seg = path.replace(/^\/+/, '').split('/')[0]
  switch (seg) {
    case 'archer':      return 'archer'
    case 'coach':       return 'coach'
    case 'admin1':      return 'admin1'
    case 'admin2':      return 'admin2'
    case 'super-admin': return 'super_admin'
    case 'articles':    return 'articles'
    default:            return null
  }
}

// ─── HOME / DEFAULT REDIRECT PATHS ──────────────────────────────────────────────
// Where each role lands after login, and where unauthorized access redirects to.
// These MUST point at routes that actually exist in src/App.tsx.

export const ROLE_HOME_PATH: Record<Role, string> = {
  archer:      '/archer/dashboard',
  coach:       '/coach/dashboard',
  admin1:      '/admin1/overview',
  admin2:      '/admin2/centre',
  super_admin: '/super-admin/settings',
}

export function getHomePath(role: Role | null | undefined): string {
  return (role && ROLE_HOME_PATH[role]) || '/login'
}

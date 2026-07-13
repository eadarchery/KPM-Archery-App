import { useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/services/supabase'
import { loadProfile, signOut as authSignOut } from '@/services/auth'
import { clearOfflineData } from '@/offline/db'
import { claimPendingSchoolCodeIfAny } from '@/services/schoolRegistration'
import { loadPermissionsForRole, getDefaultPermissions } from '@/services/permissions'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import type { Profile } from '@/types'

export function useAuthInit() {
  const { setProfile, setPermissions, setLoading, setInitialized, reset } = useAuthStore()
  const setTheme = useUiStore((s) => s.setTheme)
  const setFontSize = useUiStore((s) => s.setFontSize)
  const queryClient = useQueryClient()

  const handleSession = useCallback(
    async (userId: string | null) => {
      if (!userId) {
        // Don't wipe a dev-bypass profile (only exists in dev builds)
        if (import.meta.env.DEV) {
          const current = useAuthStore.getState().profile
          if (current?.id.startsWith('dev-')) return
        }
        reset()
        setInitialized(true)
        return
      }

      // Token refreshes (e.g. returning to the tab) re-fire this handler for the
      // SAME user. Reloading would flip `loading` and unmount every page behind
      // RequireAuth's spinner — wiping any form the user was filling in. The
      // profile is already loaded; keep the UI mounted and do nothing.
      if (useAuthStore.getState().profile?.id === userId) return

      setLoading(true)
      try {
        const profile = await loadProfile(userId)
        if (!profile) {
          reset()
          setInitialized(true)
          return
        }
        setProfile(profile)

        // First sign-in after email confirmation: claim any school code the
        // archer entered at registration (deferred because sign-up had no session).
        if (profile.role === 'archer') {
          claimPendingSchoolCodeIfAny().catch(() => { /* retried next sign-in */ })
        }

        // Load permissions — fall back to defaults if table not yet migrated
        const perms = await loadPermissionsForRole(profile.role).catch(
          () => getDefaultPermissions(profile.role),
        )
        setPermissions(perms)
      } catch (e) {
        console.error('Auth init error:', e)
        reset()
      } finally {
        setLoading(false)
        setInitialized(true)
      }
    },
    [setProfile, setPermissions, setLoading, setInitialized, reset],
  )

  useEffect(() => {
    const purgeLocalUserData = async () => {
      queryClient.clear()
      await clearOfflineData().catch(() => {})
      if ('caches' in window) await caches.delete('supabase-api-cache').catch(() => false)
    }

    // Kick off with current session
    supabase.auth.getSession().then(({ data: { session } }) => {
      handleSession(session?.user?.id ?? null)
    })

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const nextUserId = session?.user?.id ?? null
      const currentUserId = useAuthStore.getState().profile?.id ?? null
      const identityChanged = !!currentUserId && !!nextUserId && currentUserId !== nextUserId

      // Shared-device hygiene for EVERY sign-out, not just the logout button:
      // token revocation/expiry and the password-recovery signOut fire here but
      // never touch useSignOut. Also purge before replacing one signed-in user
      // with another so no cached response/draft crosses account boundaries.
      if (event === 'SIGNED_OUT' || identityChanged) {
        if (identityChanged) {
          reset()
          setLoading(true)
        }
        void purgeLocalUserData().then(() => handleSession(nextUserId))
        return
      }
      handleSession(nextUserId)
    })

    return () => subscription.unsubscribe()
  }, [handleSession, queryClient, reset, setLoading])

  // Restore theme/fontSize on mount
  useEffect(() => {
    const stored = localStorage.getItem('asm-ui-prefs')
    if (stored) {
      try {
        const prefs = JSON.parse(stored)
        if (prefs.state?.theme) setTheme(prefs.state.theme)
        if (prefs.state?.fontSize) setFontSize(prefs.state.fontSize)
      } catch { /* ignore */ }
    }
  }, [setTheme, setFontSize])
}

export function useAuth() {
  const { profile, permissions, loading, initialized } = useAuthStore()
  return { profile, permissions, loading, initialized, isLoggedIn: !!profile }
}

export function useProfile(): Profile | null {
  return useAuthStore((s) => s.profile)
}

export function useSignOut() {
  const navigate = useNavigate()
  const reset = useAuthStore((s) => s.reset)
  const queryClient = useQueryClient()

  return useCallback(async () => {
    await authSignOut().catch(console.error)
    reset()
    // Shared-device hygiene: drop everything the session accumulated locally —
    // in-memory query results, offline drafts/queue, and any HTTP cache bucket
    // left by older service workers. Best-effort; never blocks the redirect.
    queryClient.clear()
    clearOfflineData().catch(() => {})
    if ('caches' in window) caches.delete('supabase-api-cache').catch(() => {})
    navigate('/login', { replace: true })
  }, [navigate, reset, queryClient])
}

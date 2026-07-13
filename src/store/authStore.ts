import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Profile, PermissionMap } from '@/types'

interface AuthState {
  profile: Profile | null
  permissions: PermissionMap
  loading: boolean
  initialized: boolean

  setProfile: (profile: Profile | null) => void
  setPermissions: (permissions: PermissionMap) => void
  setLoading: (loading: boolean) => void
  setInitialized: (initialized: boolean) => void
  reset: () => void
}

export const useAuthStore = create<AuthState>()(
  subscribeWithSelector((set) => ({
    profile: null,
    permissions: {},
    loading: true,
    initialized: false,

    setProfile: (profile) => set({ profile }),
    setPermissions: (permissions) => set({ permissions }),
    setLoading: (loading) => set({ loading }),
    setInitialized: (initialized) => set({ initialized }),
    reset: () => set({ profile: null, permissions: {}, loading: false }),
  })),
)

// Convenience selectors
export const selectProfile = (s: AuthState) => s.profile
export const selectPermissions = (s: AuthState) => s.permissions
export const selectRole = (s: AuthState) => s.profile?.role
export const selectIsLoggedIn = (s: AuthState) => !!s.profile

import { useQuery } from '@tanstack/react-query'
import { getBrandingSettings, getPublicBrandingSettings } from '@/services/branding'
import type { AppConfig, AppConfigValue } from '@/types'

/** All branding settings — for the Super Admin Branding page. Errors surface. */
export function useBranding() {
  return useQuery<AppConfig[]>({
    queryKey: ['branding'],
    queryFn: getBrandingSettings,
  })
}

/**
 * Public branding settings — safe for any logged-in role.
 * Resilient: returns [] on error so consumers fall back to defaults gracefully.
 */
export function usePublicBranding() {
  return useQuery<AppConfig[]>({
    queryKey: ['branding', 'public'],
    queryFn: getPublicBrandingSettings,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })
}

/**
 * Read a single public branding value from cache with a safe fallback.
 * Useful for integrating brand_name, brand_logo_light, etc. into other pages
 * without coupling those pages to the branding query key.
 */
export function useBrandingValue<T = AppConfigValue>(key: string, fallback: T): T {
  const { data } = usePublicBranding()
  const setting = data?.find((s) => s.key === key)
  if (!setting || setting.value === null || setting.value === undefined) return fallback
  return setting.value as T
}

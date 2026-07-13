import { useQuery } from '@tanstack/react-query'
import { getAppSettings, getPublicAppSettings } from '@/services/appSettings'
import type { AppConfig, AppConfigValue } from '@/types'

/** Full list — for the Super Admin App Settings page. Errors surface. */
export function useAppSettings() {
  return useQuery<AppConfig[]>({
    queryKey: ['app-config'],
    queryFn: getAppSettings,
  })
}

/**
 * Public settings — safe for any logged-in role. The underlying service
 * returns [] on error so feature checks always fall back gracefully.
 */
export function usePublicAppSettings() {
  return useQuery<AppConfig[]>({
    queryKey: ['app-config', 'public'],
    queryFn: getPublicAppSettings,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })
}

/**
 * Read a single public setting value from cache with a safe fallback.
 * Useful for lightly integrating public settings (app_display_name,
 * support_email, footer_text, etc.) into other pages without coupling
 * those pages to the app_config query key.
 */
export function useAppSettingValue<T = AppConfigValue>(key: string, fallback: T): T {
  const { data } = usePublicAppSettings()
  const setting = data?.find((s) => s.key === key)
  if (!setting || setting.value === null || setting.value === undefined) return fallback
  return setting.value as T
}

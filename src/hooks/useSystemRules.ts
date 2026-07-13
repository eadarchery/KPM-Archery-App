import { useQuery } from '@tanstack/react-query'
import { getSystemRules, getPublicSystemRules } from '@/services/systemRules'
import type { SystemRule, SystemRuleValue } from '@/types'

/** Full rule set — for the Super Admin System Rules page (errors surface). */
export function useSystemRules() {
  return useQuery<SystemRule[]>({
    queryKey: ['system-rules'],
    queryFn: getSystemRules,
  })
}

/**
 * Public feature flags — safe for any logged-in role to read. The underlying
 * service returns [] on error, so feature checks always fall back gracefully.
 */
export function usePublicSystemRules() {
  return useQuery<SystemRule[]>({
    queryKey: ['system-rules', 'public'],
    queryFn: getPublicSystemRules,
    staleTime: 1000 * 60 * 5, // feature flags change rarely
    retry: false,
  })
}

/**
 * Read a single public feature flag from cache with a safe fallback.
 * Reusable by scores / achievements / notifications / articles / equipment /
 * reports / leaderboard pages to gate features.
 */
export function useRuleValue<T = SystemRuleValue>(key: string, fallback: T): T {
  const { data } = usePublicSystemRules()
  const rule = data?.find((r) => r.key === key)
  if (!rule || rule.value === null || rule.value === undefined) return fallback
  return rule.value as T
}

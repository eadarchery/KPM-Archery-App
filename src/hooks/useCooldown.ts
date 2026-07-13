import { useEffect, useState } from 'react'

/**
 * Client-side action cooldown (persisted in localStorage so refreshing the page
 * does not reset it). First line of defence against rapid repeat submissions on
 * public forms — the real limits are server-side (Supabase Auth rate limits and
 * the DB rate-limit trigger in migration 055); this simply keeps honest users
 * from hammering those limits and getting opaque errors.
 */
export function useCooldown(key: string, seconds: number) {
  const storageKey = `asm-cooldown:${key}`

  const readRemaining = () => {
    try {
      const until = Number(localStorage.getItem(storageKey) ?? 0)
      return Math.max(0, Math.ceil((until - Date.now()) / 1000))
    } catch {
      return 0
    }
  }

  const [remaining, setRemaining] = useState(readRemaining)

  useEffect(() => {
    if (remaining <= 0) return
    const id = window.setInterval(() => setRemaining(readRemaining()), 1000)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining > 0])

  const start = () => {
    try { localStorage.setItem(storageKey, String(Date.now() + seconds * 1000)) } catch { /* ignore */ }
    setRemaining(seconds)
  }

  return { remaining, active: remaining > 0, start }
}

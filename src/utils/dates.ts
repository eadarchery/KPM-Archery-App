import { format, formatDistanceToNow, parseISO, subDays, isAfter, isBefore } from 'date-fns'

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function daysAgo(n: number): string {
  const d = subDays(new Date(), n)
  return d.toISOString().slice(0, 10)
}

export function parseDate(s: string): Date {
  try {
    // Treat YYYY-MM-DD as local noon to avoid timezone off-by-one
    const d = parseISO(s + (s.length === 10 ? 'T12:00:00' : ''))
    return Number.isNaN(d.getTime()) ? new Date() : d
  } catch {
    return new Date()
  }
}

export function formatDate(s: string): string {
  try { return format(parseDate(s), 'd MMM yyyy') } catch { return s }
}

export function formatShort(s: string): string {
  try { return format(parseDate(s), 'd MMM') } catch { return s }
}

export function timeAgo(s: string): string {
  try { return formatDistanceToNow(parseDate(s), { addSuffix: true }) } catch { return s }
}

export function inRange(dateStr: string, days: number): boolean {
  const cutoff = subDays(new Date(), days)
  return isAfter(parseDate(dateStr), cutoff)
}

export function isExpired(dateStr: string): boolean {
  return isBefore(parseDate(dateStr), new Date())
}

export function daysUntil(dateStr: string): number {
  const diff = parseDate(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

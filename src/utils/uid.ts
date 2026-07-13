/**
 * Generate a UUID that works in ALL contexts.
 *
 * `crypto.randomUUID()` is only available in a *secure context* (HTTPS or
 * localhost). When the app is served over plain HTTP on a LAN IP — e.g.
 * `npm run dev --host` opened via 192.168.x.x — `crypto.randomUUID` is
 * undefined and calling it throws, silently breaking anything that needs an id
 * (adding article blocks, offline score drafts, …).
 *
 * `crypto.getRandomValues()` is NOT gated by secure context, so we build a
 * RFC-4122 v4 UUID from it as a fallback, with a final Math.random() safety net.
 */
export function uid(): string {
  const c = globalThis.crypto as Crypto | undefined

  if (c?.randomUUID) return c.randomUUID()

  if (c?.getRandomValues) {
    const b = new Uint8Array(16)
    c.getRandomValues(b)
    b[6] = (b[6] & 0x0f) | 0x40 // version 4
    b[8] = (b[8] & 0x3f) | 0x80 // variant 10
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'))
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
  }

  // Last resort — not cryptographically strong, but unique enough for client ids.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`
}

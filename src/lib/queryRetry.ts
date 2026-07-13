type ErrorWithStatus = { status?: unknown }

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const status = (error as ErrorWithStatus).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

/** Retry transient failures without multiplying deterministic 4xx responses. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  const status = errorStatus(error)
  if (status === 429) return failureCount < 1
  if (status != null && status >= 400 && status < 500) {
    return status === 408 && failureCount < 2
  }
  return failureCount < 2
}

/** Exponential delay plus jitter prevents synchronized retry waves. */
export function queryRetryDelay(attemptIndex: number): number {
  const exponential = Math.min(750 * 2 ** attemptIndex, 10_000)
  return Math.round(exponential * (0.75 + Math.random() * 0.5))
}

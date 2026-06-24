/**
 * Wraps fetch with automatic retry for network failures (Render free-tier cold start).
 * Only retries on genuine network errors (TypeError: Failed to fetch), not on
 * HTTP error responses (4xx / 5xx) which are real errors.
 */
export async function fetchWithRetry(url, options = {}, { retries = 4, baseDelay = 4000, onRetry } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetch(url, options)
    } catch (err) {
      const isNetworkError = err instanceof TypeError
      if (!isNetworkError || attempt === retries) throw err
      const delay = baseDelay + attempt * 2000
      if (onRetry) onRetry(attempt + 1, retries, Math.round(delay / 1000))
      await new Promise(r => setTimeout(r, delay))
    }
  }
}

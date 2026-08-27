import type { FxRates } from '../shared/types'
import { BASE_CURRENCY, MARKETS } from '../shared/markets'

/**
 * open.er-api.com is keyless, updates daily and covers every currency we
 * quote -- including TWD and AED, which the ECB feeds (and anything built on
 * them, such as Frankfurter) do not carry.
 */
const FX_ENDPOINT = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`

interface ErApiResponse {
  result?: string
  time_last_update_utc?: string
  time_next_update_utc?: string
  rates?: Record<string, number>
}

export async function fetchFxRates(fetcher: typeof fetch = fetch): Promise<FxRates> {
  const response = await fetcher(FX_ENDPOINT)
  if (!response.ok) throw new Error(`FX request failed: ${response.status}`)

  const body = (await response.json()) as ErApiResponse
  if (body.result !== 'success' || !body.rates) throw new Error('FX response was not a success')

  // A success carrying a short rate map is worse than no response at all: it
  // would replace a complete quote with one that silently drops whichever
  // markets it omits, and the site would show them as unpriced.
  const rates = body.rates
  const missing = [...new Set(MARKETS.map((m) => m.currency))].filter((c) => !(c in rates))
  if (missing.length > 0) throw new Error(`FX response is missing ${missing.join(', ')}`)

  // The feed publishes when its next quote is due, so nothing has to guess a
  // refresh interval: a reader can ask for the new rate the minute it exists.
  const nextUpdate = Date.parse(body.time_next_update_utc ?? '')

  return {
    base: BASE_CURRENCY,
    fetchedAt: new Date(body.time_last_update_utc ?? Date.now()).toISOString(),
    refreshedAt: new Date().toISOString(),
    nextUpdateAt: Number.isFinite(nextUpdate) ? new Date(nextUpdate).toISOString() : null,
    rates,
  }
}

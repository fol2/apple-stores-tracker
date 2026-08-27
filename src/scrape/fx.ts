import type { FxRates } from '../shared/types'
import { BASE_CURRENCY } from '../shared/markets'

/**
 * open.er-api.com is keyless, updates daily and covers every currency we
 * quote -- including TWD and AED, which the ECB feeds (and anything built on
 * them, such as Frankfurter) do not carry.
 */
const FX_ENDPOINT = `https://open.er-api.com/v6/latest/${BASE_CURRENCY}`

interface ErApiResponse {
  result?: string
  time_last_update_utc?: string
  rates?: Record<string, number>
}

export async function fetchFxRates(fetcher: typeof fetch = fetch): Promise<FxRates> {
  const response = await fetcher(FX_ENDPOINT)
  if (!response.ok) throw new Error(`FX request failed: ${response.status}`)

  const body = (await response.json()) as ErApiResponse
  if (body.result !== 'success' || !body.rates) throw new Error('FX response was not a success')

  return {
    base: BASE_CURRENCY,
    fetchedAt: new Date(body.time_last_update_utc ?? Date.now()).toISOString(),
    rates: body.rates,
  }
}

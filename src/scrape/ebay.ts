import type { RequestBudget } from './sweep'

/**
 * eBay's Browse API: the one second-hand source that publishes an interface.
 *
 * It is deliberately not reached through `sweep.ts`'s `get`. That helper
 * carries a cool-off shared across every worker, because every request it
 * makes is against Apple's one origin; letting an Apple throttle pause eBay,
 * or the reverse, would couple two unrelated rate limits.
 *
 * What this cannot do is the important part. Apple's refurbished grid names a
 * part number for every unit, which is what lets `secondhand.ts` claim a used
 * price *is* this configuration. An eBay listing is a seller-written title
 * with no part number, so nothing here can support that claim, and none of
 * these types offer a field that would let a caller pretend otherwise.
 */
const EBAY_API = 'https://api.ebay.com'

/** UK only, for the same reason the refurbished grid is: a used machine sits in one warehouse. */
export const MARKETPLACE = 'EBAY_GB'

/**
 * Certified Refurbished, and the three grades that replaced Seller
 * Refurbished. Deliberately not `USED` (3000): an unrestored private sale
 * prices the seller's word, not the machine.
 */
export const REFURBISHED_CONDITIONS = ['2000', '2010', '2020', '2030'] as const

export interface EbayListing {
  itemId: string
  /** Seller-written. The only description of what this is. */
  title: string
  amount: number
  currency: string
  /** eBay's own label, e.g. "Certified - Refurbished". */
  condition: string
  conditionId: string
  url: string
  sellerFeedbackPercent: number | null
  sellerFeedbackScore: number | null
}

/**
 * Exchange the application credentials for a token.
 *
 * Client-credentials, so the token speaks for the application and never for a
 * user -- there is no account here to act on behalf of. It lasts about two
 * hours and a collection run lasts minutes, so it is held in a variable for
 * the run and never stored.
 */
export async function applicationToken(clientId: string, clientSecret: string): Promise<string> {
  const response = await fetch(`${EBAY_API}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      // Basic, per RFC 6749: the credentials authenticate the request itself.
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  })

  if (!response.ok) {
    // OAuth's own error fields, and only those. They name the fault --
    // `invalid_client` for a bad pair, `invalid_scope` for an unauthorised
    // one -- without echoing anything that was sent. An earlier version
    // suppressed the body wholesale, which turned every failure into an
    // unattributable 401.
    const detail = await response
      .json()
      .then((body) => {
        const oauth = body as { error?: unknown; error_description?: unknown }
        return [oauth.error, oauth.error_description].filter((v) => typeof v === 'string').join(': ')
      })
      .catch(() => '')
    throw new Error(`eBay token exchange failed: ${response.status}${detail ? ` -- ${detail}` : ''}`)
  }

  const body = (await response.json()) as { access_token?: unknown }
  if (typeof body.access_token !== 'string') throw new Error('eBay token response had no token')
  return body.access_token
}

/**
 * A price, from a string.
 *
 * eBay states amounts as strings -- `"value": "59.99"` -- where Apple's pages
 * give real numbers. That difference matters beyond parsing: everything
 * downstream of an Apple offer may assume a finite number because JSON.parse
 * cannot produce anything else, and this is the one door through which a NaN
 * could enter. A listing whose price will not parse is dropped, not defaulted.
 */
const amountOf = (price: unknown): number | undefined => {
  const value = (price as { value?: unknown } | undefined)?.value
  const amount = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN
  return Number.isFinite(amount) && amount > 0 ? amount : undefined
}

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.length > 0 ? value : fallback

const numberOrNull = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Turn one search response into listings, discarding whatever cannot be priced. */
export function parseListings(body: unknown): EbayListing[] {
  const summaries = (body as { itemSummaries?: unknown[] } | undefined)?.itemSummaries
  if (!Array.isArray(summaries)) return []

  return summaries.flatMap((raw) => {
    const item = raw as Record<string, unknown>
    const amount = amountOf(item.price)
    const itemId = typeof item.itemId === 'string' ? item.itemId : undefined
    const title = typeof item.title === 'string' ? item.title : undefined
    // A listing with no price, no id or no title cannot be shown or linked to.
    if (amount === undefined || !itemId || !title) return []

    const seller = item.seller as Record<string, unknown> | undefined
    return [
      {
        itemId,
        title,
        amount,
        currency: stringOr((item.price as { currency?: unknown })?.currency, 'GBP'),
        condition: stringOr(item.condition, 'Unstated'),
        conditionId: stringOr(item.conditionId, ''),
        url: stringOr(item.itemWebUrl, ''),
        sellerFeedbackPercent: numberOrNull(seller?.feedbackPercentage),
        sellerFeedbackScore: numberOrNull(seller?.feedbackScore),
      },
    ]
  })
}

export interface EbaySearch {
  listings: EbayListing[]
  /** What was asked for. The claim these listings support is about this, not about a machine. */
  query: string
  total: number
}

/**
 * Search refurbished listings for one description.
 *
 * `limit` is capped at eBay's own maximum of 200. The free tier allows 5,000
 * calls a day and the catalogue is far smaller than that, so there is no
 * pagination here: the cheapest listings are what a price range needs, and
 * `sort=price` puts them first.
 */
export async function searchRefurbished(
  token: string,
  query: string,
  budget: RequestBudget,
  limit = 50,
): Promise<EbaySearch> {
  budget.claim()

  const url = new URL(`${EBAY_API}/buy/browse/v1/item_summary/search`)
  url.searchParams.set('q', query)
  url.searchParams.set('limit', String(Math.min(limit, 200)))
  url.searchParams.set('sort', 'price')
  url.searchParams.set('filter', `conditionIds:{${REFURBISHED_CONDITIONS.join('|')}}`)

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
      accept: 'application/json',
    },
  })
  if (!response.ok) throw new Error(`eBay search failed: ${response.status} for ${query}`)

  const body = (await response.json()) as { total?: unknown }
  return {
    listings: parseListings(body),
    query,
    total: numberOrNull(body.total) ?? 0,
  }
}

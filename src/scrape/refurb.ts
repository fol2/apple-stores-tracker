import { extractJsonAfter } from './apple'
import { storeOrigin, type Market } from '../shared/markets'
import { REFURB_CATEGORIES, type RefurbCategory, type RefurbListing } from '../shared/types'

import { get, type RequestBudget } from './sweep'

/**
 * Apple's refurbished store is its own second-hand market.
 *
 * Every unit is a returned or repaired machine that Apple has restored, tested
 * and re-boxed, and it carries the same warranty as new — which makes its
 * price the one second-hand number a buyer can compare with a new one without
 * also having to price the risk of a private sale.
 *
 * Nothing else free was usable. CeX's API sits behind a bot challenge, Back
 * Market's robots.txt disallows the paths its own site calls, and eBay needs a
 * registered key and OAuth. Apple's grid needs none of that, comes from an
 * origin we already treat politely, and names the exact part number of every
 * unit it lists.
 */
export const refurbUrl = (market: Market, category: RefurbCategory): string =>
  `${storeOrigin}${market.prefix}/shop/refurbished/${category}`

interface GridTile {
  partNumber?: string
  title?: string
  productDetailsUrl?: string
  price?: { priceCurrency?: string; currentPrice?: { raw_amount?: string } }
  filters?: { dimensions?: Record<string, string> }
}

/**
 * The grid ships the whole category in one page: every unit Apple currently
 * has, with its part number, price and the facets the filters run on. There is
 * no pagination and no second endpoint, so a category costs exactly one
 * request.
 */
/**
 * A grid that rendered but holds nothing.
 *
 * Apple ships the page with no bootstrap at all when a category is sold out --
 * today its UK refurbished Macs are -- so an absent bootstrap on its own
 * cannot be read as a failure. This marker is the page's own container, and it
 * is present on a full grid and an empty one alike, so it separates "Apple has
 * none" from "this is not the page we asked for".
 */
const GRID_CONTAINER = 'rf-refurb-category'

export function parseRefurbGrid(
  html: string,
  category: RefurbCategory,
  currency: string,
  gridUrl: string,
): RefurbListing[] {
  if (!html.includes('window.REFURB_GRID_BOOTSTRAP')) {
    // An empty shelf is a successful read. Calling it an error would carry the
    // last units forward for ever, so a sold-out Mac would keep its price on
    // the page long after Apple stopped having one.
    if (html.includes(GRID_CONTAINER)) return []
    throw new Error(`not a refurbished ${category} grid`)
  }

  const data = extractJsonAfter(html, 'window.REFURB_GRID_BOOTSTRAP') as { tiles?: GridTile[] }
  const listings: RefurbListing[] = []

  for (const tile of data.tiles ?? []) {
    const dimensions = tile.filters?.dimensions
    const amount = Number(tile.price?.currentPrice?.raw_amount)
    // A tile with no price, model or part number is furniture — a promo card
    // or a sold-out placeholder — not a unit anyone can buy.
    if (!tile.partNumber || !dimensions?.refurbClearModel || !Number.isFinite(amount)) continue

    listings.push({
      partNumber: tile.partNumber,
      title: (tile.title ?? '').replace(/­|​/g, ''),
      model: dimensions.refurbClearModel,
      category,
      dimensions,
      amount,
      currency: tile.price?.priceCurrency ?? currency,
      sourceUrl: tile.productDetailsUrl
        ? `${storeOrigin}${tile.productDetailsUrl.split('?')[0]}`
        : gridUrl,
    })
  }

  return listings
}

export interface RefurbCollection {
  marketId: string
  collectedAt: string
  listings: RefurbListing[]
  errors: { category: RefurbCategory; message: string }[]
}

/**
 * Read one market's whole refurbished catalogue.
 *
 * Six requests, which is why this can run in a single cron tick while a price
 * sweep needs ninety.
 */
export async function collectRefurb(market: Market, budget: RequestBudget): Promise<RefurbCollection> {
  const listings: RefurbListing[] = []
  const errors: { category: RefurbCategory; message: string }[] = []

  for (const category of REFURB_CATEGORIES) {
    const url = refurbUrl(market, category)
    try {
      const html = await (await get(url, budget)).text()
      listings.push(...parseRefurbGrid(html, category, market.currency, url))
    } catch (error) {
      errors.push({ category, message: String(error) })
    }
  }

  return { marketId: market.id, collectedAt: new Date().toISOString(), listings, errors }
}

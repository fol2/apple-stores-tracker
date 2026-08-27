export interface Market {
  id: string
  name: string
  currency: string
  flag: string
  /** Path prefix on apple.com; the US store has none. */
  prefix: string
  /**
   * The listed price is not what you pay at the till. US stores quote prices
   * before sales tax, which is added at checkout and varies by state — so a US
   * row is not directly comparable with a tax-inclusive one, and saying so
   * matters most precisely when the US comes out cheapest.
   */
  pricesExcludeTax?: boolean
}

/**
 * Adding a market is one line here — the scraper, UI and MCP tools all read
 * this array. `prefix` must match Apple's own store path.
 */
export const MARKETS: Market[] = [
  { id: 'uk', name: 'United Kingdom', currency: 'GBP', flag: '🇬🇧', prefix: '/uk' },
  { id: 'us', name: 'United States', currency: 'USD', flag: '🇺🇸', prefix: '', pricesExcludeTax: true },
  { id: 'ie', name: 'Ireland', currency: 'EUR', flag: '🇮🇪', prefix: '/ie' },
  { id: 'de', name: 'Germany', currency: 'EUR', flag: '🇩🇪', prefix: '/de' },
  { id: 'fr', name: 'France', currency: 'EUR', flag: '🇫🇷', prefix: '/fr' },
  { id: 'jp', name: 'Japan', currency: 'JPY', flag: '🇯🇵', prefix: '/jp' },
  { id: 'hk', name: 'Hong Kong', currency: 'HKD', flag: '🇭🇰', prefix: '/hk' },
  { id: 'sg', name: 'Singapore', currency: 'SGD', flag: '🇸🇬', prefix: '/sg' },
  { id: 'au', name: 'Australia', currency: 'AUD', flag: '🇦🇺', prefix: '/au' },
  { id: 'ca', name: 'Canada', currency: 'CAD', flag: '🇨🇦', prefix: '/ca' },
  { id: 'tw', name: 'Taiwan', currency: 'TWD', flag: '🇹🇼', prefix: '/tw' },
  { id: 'kr', name: 'South Korea', currency: 'KRW', flag: '🇰🇷', prefix: '/kr' },
  { id: 'th', name: 'Thailand', currency: 'THB', flag: '🇹🇭', prefix: '/th' },
  { id: 'cn', name: 'Mainland China', currency: 'CNY', flag: '🇨🇳', prefix: '/cn' },
  { id: 'ae', name: 'United Arab Emirates', currency: 'AED', flag: '🇦🇪', prefix: '/ae' },
]

export const BASE_CURRENCY = 'GBP'

/**
 * The one market whose second-hand listings are collected.
 *
 * A refurbished unit is a single physical machine that has to be bought where
 * it sits, so unlike a new price it does not generalise across markets.
 */
export const REFURB_MARKET = 'uk'

export const marketById = (id: string): Market | undefined =>
  MARKETS.find((m) => m.id === id)

export const storeOrigin = 'https://www.apple.com'

/**
 * Apple runs a parallel education store per market at `/<id>-edu`, with the
 * same page structure and lower prices. Note the US takes a prefix here even
 * though its retail store has none.
 */
export type Store = 'retail' | 'education'

export const STORES: Store[] = ['retail', 'education']

export const storeUrl = (market: Market, path: string, store: Store = 'retail'): string =>
  `${storeOrigin}${store === 'education' ? `/${market.id}-edu` : market.prefix}${path}`

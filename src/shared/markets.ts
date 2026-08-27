export interface Market {
  id: string
  name: string
  currency: string
  flag: string
  /** Path prefix on apple.com; the US store has none. */
  prefix: string
}

/**
 * Adding a market is one line here — the scraper, UI and MCP tools all read
 * this array. `prefix` must match Apple's own store path.
 */
export const MARKETS: Market[] = [
  { id: 'uk', name: 'United Kingdom', currency: 'GBP', flag: '🇬🇧', prefix: '/uk' },
  { id: 'us', name: 'United States', currency: 'USD', flag: '🇺🇸', prefix: '' },
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

export const marketById = (id: string): Market | undefined =>
  MARKETS.find((m) => m.id === id)

export const storeOrigin = 'https://www.apple.com'

export const storeUrl = (market: Market, path: string): string =>
  `${storeOrigin}${market.prefix}${path}`

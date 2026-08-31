import type { FxRates, Offer } from './types'
import { BASE_CURRENCY, MARKETS, type Market } from './markets'
import { afterRefund, refundPolicy, type RefundPolicy } from './refunds'

export interface MarketPrice {
  market: Market
  offer: Offer | undefined
  policy: RefundPolicy
  /** Local price after the estimated refund, when refunds are being applied. */
  localAmount: number | undefined
  /** `localAmount` in the chosen display currency, or null with no rate. */
  displayAmount: number | null
  /** Whether this row is quoted from Apple's education store. */
  isEducation: boolean
  /**
   * Whether this market has no price because collection failed here, rather
   * than because Apple does not sell the configuration.
   *
   * The two look identical in a table and mean opposite things. A market Apple
   * does not sell in is an answer; a market whose page did not answer is a gap
   * in what we know, and presenting it as "not sold" states a fact about
   * Apple's catalogue that nothing observed.
   */
  unread: boolean
  /** What the same build costs at retail, on an education row. */
  retailDisplayAmount?: number | null
}

/** Rows are per market and store, so a market can appear twice. */
export const rowKey = (row: MarketPrice): string =>
  `${row.market.id}:${row.isEducation ? 'education' : 'retail'}`

export interface Comparison {
  rows: MarketPrice[]
  cheapest: MarketPrice | undefined
  /** Gap between the cheapest and dearest market, in the display currency. */
  spread: number | null
  /** How many markets we hold both a price and a rate for. */
  covered: number
  currency: string
}

export interface CompareOptions {
  applyRefunds?: boolean
  /** Currency every converted figure is shown in. */
  currency?: string
  /**
   * The one market whose education price applies. Apple's education store
   * serves students of that country, so at most one market can be claimed —
   * quoting education prices everywhere would describe nobody's situation.
   */
  educationMarketId?: string | null
  /**
   * Markets whose collection failed for this family, so their silence is ours
   * rather than Apple's.
   */
  unreadMarkets?: Iterable<string>
}

/**
 * `rates[CUR]` says how many CUR one unit of the base currency buys, so
 * dividing takes a local price back to the base.
 */
export function toBase(amount: number, currency: string, fx: FxRates): number | null {
  if (currency === fx.base) return amount
  const rate = fx.rates[currency]
  if (!rate) return null
  return amount / rate
}

/**
 * Convert between any two quoted currencies, via the base the rates are
 * quoted against. Note this cannot change the ranking: every price is scaled
 * by the same factor, so cheapest in pounds is cheapest in yen too. The choice
 * of display currency is about reading the numbers, not about the answer.
 */
export function convertBetween(
  amount: number,
  from: string,
  to: string,
  fx: FxRates,
): number | null {
  if (from === to) return amount
  const inBase = toBase(amount, from, fx)
  if (inBase === null) return null
  if (to === fx.base) return inBase
  const rate = fx.rates[to]
  return rate ? inBase * rate : null
}

/** Currencies we can display, in market order, without repeats. */
export const displayCurrencies = (fx: FxRates): string[] =>
  [BASE_CURRENCY, ...MARKETS.map((m) => m.currency)]
    .filter((c, i, all) => all.indexOf(c) === i)
    .filter((c) => c === fx.base || fx.rates[c])

export function formatIn(amount: number, currency: string, locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Rank every market for one exact configuration, cheapest first. Markets with
 * no price still appear — a missing row is information, and silently dropping
 * them would make coverage gaps look like availability.
 */
export function compare(offers: Offer[], fx: FxRates, options: CompareOptions = {}): Comparison {
  const {
    applyRefunds = false,
    currency = BASE_CURRENCY,
    educationMarketId = null,
    unreadMarkets = [],
  } = options
  const unread = new Set(unreadMarkets)

  const toRow = (market: Market, offer: Offer | undefined): MarketPrice => {
    const policy = refundPolicy(market.id)
    const localAmount = offer && applyRefunds ? afterRefund(offer.amount, policy) : offer?.amount
    return {
      market,
      offer,
      policy,
      localAmount,
      displayAmount:
        localAmount === undefined
          ? null
          : convertBetween(localAmount, offer!.currency, currency, fx),
      isEducation: offer?.store === 'education',
      unread: !offer && unread.has(market.id),
    }
  }

  const rows: MarketPrice[] = MARKETS.map((market) => {
    // A snapshot collected before education pricing has no `store` at all;
    // treat those as retail rather than discarding the whole market.
    const retail = offers.find((o) => o.marketId === market.id && o.store !== 'education')
    return toRow(market, retail)
  })

  // The claimed market gets a second row rather than a substituted one, so the
  // discount is visible as a gap instead of silently changing a number. Only
  // one market can be claimed: you can only be a student in one country.
  if (educationMarketId) {
    const market = MARKETS.find((m) => m.id === educationMarketId)
    const education = offers.find(
      (o) => o.marketId === educationMarketId && o.store === 'education',
    )
    if (market && education) {
      const retailRow = rows.find((r) => r.market.id === educationMarketId)
      rows.push({ ...toRow(market, education), retailDisplayAmount: retailRow?.displayAmount ?? null })
    }
  }

  rows.sort((a, b) => (a.displayAmount ?? Infinity) - (b.displayAmount ?? Infinity))

  const priced = rows.map((r) => r.displayAmount).filter((v): v is number => v !== null)

  return {
    rows,
    cheapest: rows.find((r) => r.displayAmount !== null),
    spread: priced.length > 1 ? Math.max(...priced) - Math.min(...priced) : null,
    covered: priced.length,
    currency,
  }
}

export function formatLocal(amount: number, currency: string, locale = 'en-GB'): string {
  // JPY, KRW and friends have no minor unit; Intl already knows which.
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}



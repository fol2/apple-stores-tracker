import type { FxRates, Offer } from './types'
import { BASE_CURRENCY, marketById, type Market } from './markets'
import { afterRefund, refundPolicy, type RefundPolicy } from './refunds'

export interface MarketPrice {
  market: Market
  offer: Offer | undefined
  policy: RefundPolicy
  /** Local price after the estimated refund, when refunds are being applied. */
  localAmount: number | undefined
  /** `localAmount` in the base currency, or null when no rate is available. */
  baseAmount: number | null
}

export interface Comparison {
  rows: MarketPrice[]
  cheapest: MarketPrice | undefined
  /** Gap between the cheapest and dearest market, in the base currency. */
  spread: number | null
  /** How many markets we hold both a price and a rate for. */
  covered: number
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
 * Rank every market for one exact configuration, cheapest first. Markets with
 * no price still appear — a missing row is information, and silently dropping
 * them would make coverage gaps look like availability.
 */
export function compare(
  offers: Offer[],
  fx: FxRates,
  options: { applyRefunds: boolean } = { applyRefunds: false },
): Comparison {
  const byMarket = new Map(offers.map((o) => [o.marketId, o]))

  const rows: MarketPrice[] = [...byMarket.keys(), ...offers.map((o) => o.marketId)]
    .filter((id, i, all) => all.indexOf(id) === i)
    .flatMap((id) => {
      const market = marketById(id)
      if (!market) return []
      const offer = byMarket.get(id)
      const policy = refundPolicy(id)
      const localAmount =
        offer && options.applyRefunds ? afterRefund(offer.amount, policy) : offer?.amount
      return [
        {
          market,
          offer,
          policy,
          localAmount,
          baseAmount:
            localAmount === undefined ? null : toBase(localAmount, offer!.currency, fx),
        },
      ]
    })
    .sort((a, b) => (a.baseAmount ?? Infinity) - (b.baseAmount ?? Infinity))

  const priced = rows.map((r) => r.baseAmount).filter((v): v is number => v !== null)

  return {
    rows,
    cheapest: rows.find((r) => r.baseAmount !== null),
    spread: priced.length > 1 ? Math.max(...priced) - Math.min(...priced) : null,
    covered: priced.length,
  }
}

export function formatLocal(amount: number, currency: string, locale = 'en-GB'): string {
  // JPY, KRW and friends have no minor unit; Intl already knows which.
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
}

export const formatBase = (amount: number, locale = 'en-GB'): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: BASE_CURRENCY,
    maximumFractionDigits: 0,
  }).format(amount)

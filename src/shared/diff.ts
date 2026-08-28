import { configKeyOf } from './offers'
import type { StoredOffer } from './offers'

export interface PricePoint {
  marketId: string
  familyId: string
  store: string
  configKey: string
  currency: string
  amount: number
  observedOn: string
}

// A snapshot written before education prices existed has no `store`, and
// treating that as a distinct value would make every one of its offers look
// newly changed — tens of thousands of spurious history rows on one sweep.
const idOf = (o: StoredOffer, configKey: string): string =>
  `${o.marketId} ${o.store ?? 'retail'} ${o.familyId} ${configKey}`

/**
 * Reduce a full snapshot to the rows worth storing.
 *
 * Apple prices barely move, so recording every configuration every day would
 * write ~90k rows a day to say nothing changed. Storing only first sightings
 * and actual changes keeps the history table small enough that charting one
 * configuration stays a plain indexed lookup.
 *
 * A configuration that disappears from the catalogue is left alone rather than
 * written as a zero -- absence is not a price.
 */
export function changedPoints(
  previous: StoredOffer[],
  current: StoredOffer[],
  observedOn: string,
): PricePoint[] {
  // Derived here rather than read off the offer: the snapshot no longer stores
  // a configKey, and computing it for the diff is cheaper than rebuilding every
  // offer in full just to compare two numbers.
  const before = new Map(previous.map((o) => [idOf(o, configKeyOf(o.dimensions)), o]))

  return current.flatMap((offer) => {
    const configKey = configKeyOf(offer.dimensions)
    const was = before.get(idOf(offer, configKey))
    if (was && was.amount === offer.amount && was.currency === offer.currency) return []
    return [
      {
        marketId: offer.marketId,
        familyId: offer.familyId,
        store: offer.store ?? 'retail',
        configKey,
        currency: offer.currency,
        amount: offer.amount,
        observedOn,
      },
    ]
  })
}

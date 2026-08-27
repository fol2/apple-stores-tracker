import type { Offer } from './types'

export interface PricePoint {
  marketId: string
  familyId: string
  store: string
  configKey: string
  currency: string
  amount: number
  observedOn: string
}

const idOf = (o: { marketId: string; familyId: string; store: string; configKey: string }): string =>
  `${o.marketId} ${o.store} ${o.familyId} ${o.configKey}`

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
export function changedPoints(previous: Offer[], current: Offer[], observedOn: string): PricePoint[] {
  const before = new Map(previous.map((o) => [idOf(o), o]))

  return current.flatMap((offer) => {
    const was = before.get(idOf(offer))
    if (was && was.amount === offer.amount && was.currency === offer.currency) return []
    return [
      {
        marketId: offer.marketId,
        familyId: offer.familyId,
        store: offer.store,
        configKey: offer.configKey,
        currency: offer.currency,
        amount: offer.amount,
        observedOn,
      },
    ]
  })
}

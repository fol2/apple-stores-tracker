import { FAMILIES } from './families'
import { marketById, storeUrl } from './markets'
import type { DimensionValue, Offer } from './types'

/** Stable, market-independent id for a dimension combination. */
export const configKeyOf = (dimensions: DimensionValue[]): string =>
  dimensions
    .map((d) => `${d.field}=${d.value}`)
    .sort()
    .join('|')

/**
 * What the snapshot stores, as against what everything reads.
 *
 * Two of an offer's fields are restatements of the others. `configKey` is the
 * dimensions concatenated, and `sourceUrl` is the family's own route under the
 * market's prefix — together a quarter and a fourteenth of every record,
 * repeated across every configuration in every market. Deriving them on read
 * costs a millisecond and is what keeps the blob inside KV's 25MB value limit
 * now that a Mac carries its full memory and storage matrix.
 *
 * The type is `Omit` rather than a hand-written shape so a field added to
 * `Offer` reaches storage without anyone remembering to add it here.
 */
export type StoredOffer = Omit<Offer, 'configKey' | 'sourceUrl'>

export const packOffer = (offer: Offer): StoredOffer => {
  const { configKey: _configKey, sourceUrl: _sourceUrl, ...stored } = offer
  return stored
}

/**
 * Put back what storage left out.
 *
 * A family or market that no longer exists yields an empty `sourceUrl` rather
 * than a wrong one — a stale snapshot outliving a catalogue change should lose
 * a link, not point at a page that never had this configuration on it.
 */
export function hydrateOffer(stored: StoredOffer): Offer {
  const family = FAMILIES.find((f) => f.id === stored.familyId)
  const market = marketById(stored.marketId)
  return {
    ...stored,
    configKey: configKeyOf(stored.dimensions),
    sourceUrl: family && market ? storeUrl(market, family.route, stored.store) : '',
  }
}

export const packOffers = (offers: Offer[]): StoredOffer[] => offers.map(packOffer)
export const hydrateOffers = (stored: StoredOffer[]): Offer[] => stored.map(hydrateOffer)

/** The least an offer has to be for its configuration to be collapsible. */
interface Priced {
  marketId: string
  familyId: string
  store?: string
  dimensions: DimensionValue[]
  amount: number
}

const keyWithout = (offer: Priced, field: string): string =>
  [
    offer.marketId,
    offer.store ?? 'retail',
    offer.familyId,
    ...offer.dimensions
      .filter((d) => d.field !== field)
      .map((d) => `${d.field}=${d.value}`)
      .sort(),
  ].join('|')

/**
 * Which of a family's dimensions are a choice a buyer pays for.
 *
 * A field is dropped only when two things hold at once: some pair of offers
 * differs in that field alone, and every such pair costs the same. Both halves
 * matter. The first keeps a field that never varies on its own — a Mac's chip
 * always moves with its core count, so no pair differs in the chip alone, and
 * a rule made only of the second half would delete the word "M6" from the
 * page while merging nothing. The second is the point: a MacBook Air's four
 * finishes are one machine at one price.
 *
 * Prices are only ever compared inside one market and store, since two
 * currencies say nothing about each other. The verdict, though, is per family
 * and global: a finish Apple charges for anywhere is a finish everywhere, or
 * the market that charges would key its offers differently from the rest and
 * drop out of every comparison as "not sold".
 */
function paidDimensions(offers: Priced[]): Set<string> {
  const fields = [...new Set(offers.flatMap((o) => o.dimensions.map((d) => d.field)))]

  return new Set(
    fields.filter((field) => {
      const buckets = new Map<string, number[]>()
      for (const offer of offers) {
        if (!offer.dimensions.some((d) => d.field === field)) continue
        const key = keyWithout(offer, field)
        const amounts = buckets.get(key)
        if (amounts) amounts.push(offer.amount)
        else buckets.set(key, [offer.amount])
      }

      let varies = false
      for (const amounts of buckets.values()) {
        if (amounts.length < 2) continue
        varies = true
        if (new Set(amounts).size > 1) return true
      }
      return !varies
    }),
  )
}

/**
 * Drop the dimensions a family never charges for, and the duplicate offers
 * they were multiplying.
 *
 * Apple's configurator lists every finish as a priced option even when every
 * finish costs the same, so a MacBook Air arrived as a hundred offers that are
 * twenty-five machines, and an iMac's matrix arrived seven times over. That is
 * a quarter of the published snapshot spent restating prices already given —
 * against KV's 25MB value limit, and downloaded whole by every reader — and a
 * finish picker on the page that moves no number when you click it.
 *
 * The first offer of each set is kept, colour and part number included, the
 * same choice `parseCatalogOffers` already makes where several colours share
 * one build.
 */
export function collapseUnpaidDimensions<T extends Priced>(offers: T[]): T[] {
  const byFamily = new Map<string, T[]>()
  for (const offer of offers) {
    const family = byFamily.get(offer.familyId)
    if (family) family.push(offer)
    else byFamily.set(offer.familyId, [offer])
  }

  const kept: T[] = []
  for (const family of byFamily.values()) {
    const paid = paidDimensions(family)
    const seen = new Set<string>()
    for (const offer of family) {
      const dimensions = offer.dimensions.filter((d) => paid.has(d.field))
      const key = [
        offer.marketId,
        offer.store ?? 'retail',
        offer.familyId,
        configKeyOf(dimensions),
      ].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      kept.push({ ...offer, dimensions })
    }
  }
  return kept
}

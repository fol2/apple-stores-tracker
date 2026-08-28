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

import { collapseUnpaidDimensions, type StoredOffer } from './offers'

/** The share of the published catalogue a new collection has to still carry. */
export const KEPT_AT_LEAST = 0.9

export interface PublishedSnapshot {
  markets?: string[]
  offers?: StoredOffer[]
}

/**
 * Reasons to refuse a collection, or none.
 *
 * `collect.ts` records a failed family as an error and carries on, which is
 * right: one throttled page should not cost a whole run. But it means a bad
 * day -- Apple rate-limiting the runner, a network fault, a login wall --
 * produces a small, well-formed snapshot, and publishing replaces the whole
 * blob rather than merging into it. The site would go quietly half-empty while
 * every check still reported success.
 *
 * The same reasoning the refurbished read already uses: a read that returned
 * nothing is a failed read, not an empty shop. Stale prices are visibly stale;
 * missing ones just look like Apple stopped selling things.
 *
 * Nothing to compare against is not a complaint -- a first run has to be able
 * to publish, and so does a run after the snapshot has been cleared.
 */
export function diminishedBy(
  before: PublishedSnapshot | null,
  now: { markets: string[]; offers: unknown[] },
): string[] {
  if (!before?.offers?.length) return []

  const lostMarkets = (before.markets ?? []).filter((m) => !now.markets.includes(m))

  // Both sides are counted the same way, because the catalogue's shape can
  // change deliberately. When a dimension stops being carried -- a finish
  // every colour of which costs the same -- the new collection is a quarter
  // smaller while describing exactly the same machines, and a guard comparing
  // raw row counts would read that as Apple withdrawing a quarter of its
  // range. Collapsing the published side too asks the question that was meant:
  // are there fewer machines, not fewer rows.
  const previously = collapseUnpaidDimensions(before.offers)
  const kept = now.offers.length / previously.length

  return [
    lostMarkets.length > 0 ? `markets missing: ${lostMarkets.join(', ')}` : '',
    kept < KEPT_AT_LEAST
      ? `offers fell from ${previously.length} to ${now.offers.length} (${(kept * 100).toFixed(0)}%)`
      : '',
  ].filter(Boolean)
}

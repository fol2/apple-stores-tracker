import { describe, expect, it } from 'vitest'
import { diminishedBy, KEPT_AT_LEAST } from '../src/shared/publish-guard'
import type { StoredOffer } from '../src/shared/offers'

const offers = (n: number) => Array.from({ length: n }, () => ({}) as StoredOffer)
const MARKETS = ['uk', 'us', 'de']
const before = { markets: MARKETS, offers: offers(22442) }

/**
 * Publishing replaces the whole snapshot rather than merging into it, so a
 * collection that failed halfway is indistinguishable from a catalogue that
 * shrank -- and it would be published over a good one while every check still
 * reported success. This is the only thing standing between a bad afternoon at
 * Apple and a site that quietly says half its markets sell nothing.
 */
describe('refusing a diminished collection', () => {
  it('passes a healthy run through', () => {
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(22450) })).toEqual([])
  })

  it('passes a small honest shrinkage', () => {
    // Apple does withdraw products; the gate is for collapses, not drift.
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(21500) })).toEqual([])
  })

  it('refuses a collection that lost most of the catalogue', () => {
    const [complaint] = diminishedBy(before, { markets: MARKETS, offers: offers(9000) })
    expect(complaint).toContain('22442')
    expect(complaint).toContain('9000')
  })

  it('refuses when a whole market failed, however many offers came back', () => {
    // The count can stay healthy while one market is entirely absent.
    const complaints = diminishedBy(before, { markets: ['uk', 'us'], offers: offers(22400) })
    expect(complaints).toHaveLength(1)
    expect(complaints[0]).toContain('de')
  })

  it('names both faults when both apply', () => {
    expect(diminishedBy(before, { markets: ['uk'], offers: offers(100) })).toHaveLength(2)
  })

  /**
   * A first run, or one after the snapshot was cleared, has nothing to be
   * diminished against and must still be able to publish.
   */
  it('has no complaint when nothing is published yet', () => {
    expect(diminishedBy(null, { markets: MARKETS, offers: offers(1) })).toEqual([])
    expect(diminishedBy({ offers: [] }, { markets: MARKETS, offers: offers(1) })).toEqual([])
  })

  it('holds the threshold it documents', () => {
    const n = before.offers.length
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(Math.ceil(n * KEPT_AT_LEAST)) })).toEqual([])
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(Math.floor(n * KEPT_AT_LEAST) - 1) })).toHaveLength(1)
  })
})

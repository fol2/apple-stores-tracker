import { describe, expect, it } from 'vitest'
import { diminishedBy, KEPT_AT_LEAST } from '../src/shared/publish-guard'
import type { StoredOffer } from '../src/shared/offers'

/** Distinct machines at distinct prices, so nothing collapses on the way in. */
const offers = (n: number): StoredOffer[] =>
  Array.from(
    { length: n },
    (_, i) =>
      ({
        marketId: 'uk',
        familyId: 'mac-mini',
        store: 'retail',
        dimensions: [{ field: 'storage-dimensionCapacity', value: `${i}gb`, label: `${i}GB` }],
        amount: 1000 + i,
        currency: 'GBP',
        partNumber: null,
      }) as StoredOffer,
  )

/** The same machines, listed once per finish at one price, as Apple lists them. */
const inEveryFinish = (n: number, finishes: string[]): StoredOffer[] =>
  offers(n).flatMap((offer) =>
    finishes.map(
      (finish) =>
        ({
          ...offer,
          dimensions: [
            ...offer.dimensions,
            { field: 'chassis-dimensionColor', value: finish, label: finish },
          ],
        }) as StoredOffer,
    ),
  )
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

  /**
   * The catalogue's shape can change deliberately. A finish every colour of
   * which costs the same stopped being carried, so a collection describing
   * exactly the same machines arrives a quarter the size -- and a guard
   * counting raw rows would read that as Apple withdrawing three quarters of
   * its range and refuse to publish, every day, until someone overrode it.
   */
  it('counts machines rather than rows, so a collapsed dimension is not a collapse', () => {
    const published = { markets: MARKETS, offers: inEveryFinish(100, ['silver', 'midnight', 'starlight', 'skyblue']) }
    expect(published.offers).toHaveLength(400)
    expect(diminishedBy(published, { markets: MARKETS, offers: offers(100) })).toEqual([])
  })

  it('still refuses when the machines themselves are gone', () => {
    const published = { markets: MARKETS, offers: inEveryFinish(100, ['silver', 'midnight']) }
    const [complaint] = diminishedBy(published, { markets: MARKETS, offers: offers(50) })
    expect(complaint).toContain('100')
    expect(complaint).toContain('50')
  })

  it('holds the threshold it documents', () => {
    const n = before.offers.length
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(Math.ceil(n * KEPT_AT_LEAST)) })).toEqual([])
    expect(diminishedBy(before, { markets: MARKETS, offers: offers(Math.floor(n * KEPT_AT_LEAST) - 1) })).toHaveLength(1)
  })
})

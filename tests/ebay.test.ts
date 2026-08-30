import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseListings, REFURBISHED_CONDITIONS } from '../src/scrape/ebay'

const body = JSON.parse(
  readFileSync(new URL('./fixtures/ebay-uk-search.json', import.meta.url), 'utf8'),
)

/**
 * Shaped from eBay's own published response example rather than from memory --
 * see the Browse API docs for `item_summary/search`. The detail that matters,
 * and that a guess would have got wrong, is that `price.value` arrives as a
 * *string*: Apple's pages give real numbers, so everything downstream of an
 * offer may assume a finite one. This is the door a NaN could come through.
 */
describe('reading eBay listings', () => {
  const listings = parseListings(body)

  it('reads the listings it can price', () => {
    expect(listings.map((l) => l.amount)).toEqual([1549, 1299.99, 899])
  })

  it('parses the price out of a string, not a number', () => {
    expect(listings[0].amount).toBe(1549)
    expect(typeof listings[0].amount).toBe('number')
  })

  /**
   * An auction with no current fixed price states `value: null`. Dropping it
   * is the point: a defaulted zero would make it the cheapest unit on the page
   * and drag a whole price range down to nothing.
   */
  it('drops a listing whose price will not parse rather than defaulting it', () => {
    expect(listings.some((l) => l.title.includes('Auction'))).toBe(false)
    expect(listings.every((l) => Number.isFinite(l.amount) && l.amount > 0)).toBe(true)
  })

  it('drops a listing that cannot be shown or linked', () => {
    // A listing with no title, and one with no itemId: neither can be
    // rendered honestly, and inventing either would be describing a machine
    // eBay never described.
    expect(listings.some((l) => l.itemId === 'v1|296333333333|0')).toBe(false)
    expect(listings.some((l) => l.title === 'Listing with no id at all')).toBe(false)
  })

  it('keeps the seller-written title verbatim', () => {
    // It is the only description of the machine, and paraphrasing it would be
    // inventing a spec eBay never stated.
    expect(listings[0].title).toBe(
      'Apple MacBook Pro 14" M4 Pro 24GB 512GB Space Black - Certified Refurbished',
    )
  })

  it('carries the seller standing a buyer would weigh', () => {
    expect(listings[0].sellerFeedbackPercent).toBe(99.2)
    expect(listings[0].sellerFeedbackScore).toBe(48210)
    // Absent seller data is null, not zero -- zero would read as a seller
    // with a perfect record of failure rather than one with no record.
    expect(listings[2].sellerFeedbackPercent).toBeNull()
    expect(listings[2].sellerFeedbackScore).toBeNull()
  })

  it('asks only for restored machines, never a plain used one', () => {
    // 3000 is Used: an unrestored private sale prices the seller's word.
    expect(REFURBISHED_CONDITIONS).not.toContain('3000')
    expect(REFURBISHED_CONDITIONS).toContain('2000')
  })

  it('has nothing to say about a response with no results', () => {
    expect(parseListings({})).toEqual([])
    expect(parseListings({ itemSummaries: [] })).toEqual([])
    expect(parseListings(null)).toEqual([])
  })
})

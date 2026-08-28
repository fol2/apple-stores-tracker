import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRefurbGrid } from '../src/scrape/refurb'
import {
  processorInTitle,
  processorOf,
  refurbCategoryFor,
  secondHandFor,
} from '../src/shared/secondhand'
import type { DimensionValue, Offer } from '../src/shared/types'

const html = readFileSync(new URL('./fixtures/apple-uk-refurb.html', import.meta.url), 'utf8')
const listings = parseRefurbGrid(html, 'mac', 'GBP', 'https://www.apple.com/uk/shop/refurbished/mac')

const offer = (familyId: string, dimensions: [string, string][]): Offer => ({
  marketId: 'uk',
  familyId,
  store: 'retail',
  configKey: dimensions.map(([f, v]) => `${f}=${v}`).join('|'),
  dimensions: dimensions.map(([field, value]): DimensionValue => ({ field, value, label: value })),
  amount: 0,
  currency: 'GBP',
  partNumber: null,
  sourceUrl: 'https://www.apple.com/uk/shop',
})

describe('parseRefurbGrid', () => {
  it('reads every unit Apple has, from one page', () => {
    expect(listings).toHaveLength(17)
    expect(listings[0]).toMatchObject({ partNumber: 'G1MLBB/A', amount: 2669, currency: 'GBP' })
  })

  /** A tile with no price or no part number is furniture, not a unit. */
  it('skips tiles that are not something you can buy', () => {
    expect(listings.map((l) => l.title)).not.toContain('Sold out placeholder')
    expect(listings.map((l) => l.title)).not.toContain('Refurbished thing with no price')
  })

  it('keeps the exact part number and a link to the unit', () => {
    expect(listings[0].sourceUrl).toMatch(/^https:\/\/www\.apple\.com\/uk\/shop\/product\//)
    expect(listings[0].sourceUrl).not.toContain('?')
  })
})

describe('an empty grid', () => {
  const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`

  /**
   * Apple ships the page with no bootstrap when a category is sold out — its
   * UK refurbished Macs were, the day this shipped. Reporting that as a failed
   * read would carry the last units forward for ever, so a sold-out machine
   * would keep its price on the page long after Apple stopped having one.
   */
  it('reads a sold-out category as empty, not as a failure', () => {
    const sold = page('<div class="rf-refurb-category">currently unavailable</div>')
    expect(parseRefurbGrid(sold, 'mac', 'GBP', 'https://example.com')).toEqual([])
  })

  /** A page that is not the grid at all still has to fail loudly. */
  it('refuses a page that is not a refurbished grid', () => {
    expect(() => parseRefurbGrid(page('<h1>Something else</h1>'), 'mac', 'GBP', 'x')).toThrow(
      'not a refurbished mac grid',
    )
  })
})

describe('processor identity', () => {
  it('reads the chip and cores out of a listing title', () => {
    expect(processorInTitle(listings[0].title)).toEqual({ chip: 'm5pro', cpu: 15, gpu: 16 })
    expect(processorInTitle('iPad Pro 11-inch (M4) Wi-Fi 256GB — Space Black')).toEqual({ chip: 'm4' })
    expect(processorInTitle('Refurbished 24-inch iMac Apple M4 Chip with 8-Core CPU and 8-Core GPU – Silver'))
      .toEqual({ chip: 'm4', cpu: 8, gpu: 8 })
  })

  it('reads it out of a configuration, however Apple spelt it', () => {
    expect(processorOf(offer('mac-mini', [['processor-dimensionChip-cpuCoreCount-gpuCoreCount', 'm6-12-12']])))
      .toEqual({ chip: 'm6', cpu: 12, gpu: 12 })
    expect(processorOf(offer('macbook-air', [['processor-cpuCoreCount-gpuCoreCount', '10-10']])))
      .toEqual({ cpu: 10, gpu: 10 })
  })
})

/** The two questions the page asks, named for readability below. */
const current = (o: Offer) => secondHandFor(o, listings).thisGeneration
const previous = (o: Offer) => secondHandFor(o, listings).earlierGeneration

describe('secondHandFor', () => {
  /**
   * The one shape that can be like-for-like. Apple's iPhone grid puts the
   * generation in the model token itself and carries no release-year facet, so
   * a configuration that pins capacity has pinned everything that moves the
   * price.
   */
  it('calls a match exact when the configuration pins every spec the units carry', () => {
    const phone = offer('iphone-16', [['dimensionCapacity', '128gb']])
    const match = current(phone)!

    expect(match.listings).toHaveLength(2)
    expect([match.low, match.high]).toEqual([589, 589])
    expect(match.exact).toBe(true)
    expect(match.unpinned).toEqual([])
    expect(match.varyingOn).toEqual(['colour'])
  })

  /**
   * An iPad configuration pins storage and connectivity but says nothing about
   * the generation, and Apple refurbishes several at once — so a matched unit
   * may be a chip generation behind the new price it sits next to.
   */
  it('will not call an iPad match exact, because nothing pins the generation', () => {
    const air = offer('ipad-air', [
      ['dimensionScreensize', '11inch'],
      ['dimensionCapacity', '128gb'],
      ['dimensionConnection', 'wifi'],
    ])
    const match = current(air)!

    expect(match.listings).toHaveLength(2)
    expect(match.exact).toBe(false)
    expect(match.unpinned).toEqual(['release year'])
  })

  /**
   * The trap this classification exists for. Apple's Mac select pages do not
   * carry storage or memory, so a 13-inch M5 Air configuration would otherwise
   * match a refurbished 4TB one -- which costs a thousand pounds more than the
   * new machine it would be quoted against.
   */
  it('refuses to call a match exact when the units pin a spec the configuration does not', () => {
    const air = offer('macbook-air', [
      ['chassis-dimensionScreensize', '13inch'],
      ['processor-cpuCoreCount-gpuCoreCount', '10-10'],
    ])
    const match = current(air)!

    expect(match.exact).toBe(false)
    expect(match.unpinned).toEqual(['storage', 'release year', 'memory'])
    expect(match.unconfirmed).toEqual([])
    expect(match.listings[0].amount).toBe(2629)
  })

  /** An M5 Pro 15/16 and an M5 Pro 18/20 are not the same machine. */
  it('separates chip tiers the grid facets cannot tell apart', () => {
    const pro = (cores: string) =>
      current(offer('macbook-pro', [
          ['chassis-dimensionScreensize', '14inch'],
          ['processor-dimensionChip-cpuCoreCount-gpuCoreCount', cores],
        ]))!

    expect(pro('m5pro-15-16').listings.map((l) => l.amount)).toEqual([2669])
    expect(pro('m5pro-18-20').listings.map((l) => l.amount)).toEqual([2849])
  })

  it('reports nothing rather than a near miss when Apple has no such unit', () => {
    const mini = offer('mac-mini', [
      ['processor-dimensionChip-cpuCoreCount-gpuCoreCount', 'm6-12-12'],
      ['memory-dimensionMemory', '16gb'],
      ['storage-dimensionCapacity', '256gb'],
    ])
    expect(current(mini)).toBeNull()
  })

  it('has nothing to say about a family Apple does not refurbish', () => {
    expect(current(offer('airpods-4', []))).toBeNull()
    expect(refurbCategoryFor('airpods-4')).toBeNull()
    expect(refurbCategoryFor('macbook-pro')).toBe('mac')
  })

  /**
   * Apple lists its TV with no facets at all, so nothing a configuration pins
   * can disagree with it. Absence of contradiction is not confirmation: the
   * one unit in stock is a 64GB box, and calling that "the same configuration"
   * as a new 128GB one would be the exact false claim this guards against.
   */
  it('will not call a match exact when the unit carries nothing to check', () => {
    const tv = offer('apple-tv-4k', [['dimensionConnection', 'wifiethernettv128gb']])
    const match = current(tv)!

    expect(match.listings).toHaveLength(1)
    expect(match.exact).toBe(false)
    expect(match.matchedOn).toEqual([])
    // And the reader is told which way the gap runs: not "the unit pins
    // something you did not", but "Apple never said, so nothing was checked".
    // `/^appletv/` names no generation, so that is unpinned as well.
    expect(match.unpinned).toEqual(['generation'])
    expect(match.unconfirmed).toEqual(['connectivity'])
  })

  /**
   * Apple's watch model token is `watchseries11`, not `applewatch`. An earlier
   * spelling matched nothing, so every watch reported no stock at all — a
   * confident claim, made from a grid that had forty-one units in it.
   */
  it('matches a watch on case size and connection', () => {
    const watch = (size: string, connection: string) =>
      current(offer('apple-watch', [
          ['watch_cases-dimensionCaseSize', size],
          ['watch_cases-dimensionConnection', connection],
        ]))

    expect(watch('46mm', 'gps')!.listings.map((l) => l.amount)).toEqual([339])
    expect(watch('42mm', 'gps')!.listings.map((l) => l.amount)).toEqual([309])
    // A GPS configuration must never be priced from a cellular unit.
    expect(watch('46mm', 'gpscell')).toBeNull()
  })

  /** `watchse` is a prefix of `watchseries`, so the SE needs its digit. */
  it('keeps the Watch SE and the Watch Series apart', () => {
    const se = current(offer('apple-watch-se', [
        ['watch_cases-dimensionCaseSize', '44mm'],
        ['watch_cases-dimensionConnection', 'gps'],
      ]))!
    expect(se.listings.map((l) => l.model)).toEqual(['watchse3'])
    // Aluminium or titanium changes the price and our configurations do not
    // say which, so a watch is never quoted as the same machine.
    expect(se.exact).toBe(false)
    expect(se.unpinned).toEqual(['case material', 'generation'])
  })

  /**
   * Apple discontinues a model the day it announces its replacement, so the
   * refurbished store routinely holds nothing at all for what is currently on
   * sale. An earlier generation at the same specification is the useful answer
   * — provided the page says that is what it is.
   */
  /**
   * A machine on sale now has barely been resold, so the model it replaced is
   * usually the only one that exists used. Apple has no refurbished iPhone 17.
   */
  it('offers the generation before, and says which it is', () => {
    const seventeen = offer('iphone-17', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(seventeen, listings)

    expect(thisGeneration).toBeNull()
    expect(earlierGeneration!.basis).toBe('earlier-generation')
    expect(earlierGeneration!.exact).toBe(false)
  })

  /**
   * "The generation before" is the one immediately before, not everything
   * older. Two generations sit behind an iPhone 17 in the grid — 16s and a 15 —
   * and returning both would put two different machines behind one price range.
   *
   * Stated as its own case because the coverage was previously incidental to
   * the test above, where a fixture tidy-up could have removed it silently.
   */
  it('narrows to the nearest generation when several are older', () => {
    const models = (familyId: string) =>
      secondHandFor(offer(familyId, [['dimensionCapacity', '128gb']]), listings)
        .earlierGeneration!.listings.map((l) => l.model)

    // Everything older than an iPhone 17 is in stock; only the 16s come back.
    expect(new Set(models('iphone-17'))).toEqual(new Set(['iphone16']))
    // And one step down the same ladder returns the 15, not nothing.
    expect(new Set(models('iphone-16'))).toEqual(new Set(['iphone15']))
  })

  /** It must never reach forward, only back. */
  it('will not offer a later generation as the earlier one', () => {
    const fifteen = offer('iphone-15', [['dimensionCapacity', '128gb']])
    expect(secondHandFor(fifteen, listings)).toEqual({
      thisGeneration: null,
      earlierGeneration: null,
    })
  })

  /**
   * Both answers at once, which is the point of asking them separately: this
   * model used, and last year's used, so the reader can weigh one against the
   * other rather than being handed whichever happened to be in stock.
   */
  it('answers both questions when Apple has both', () => {
    const sixteen = offer('iphone-16', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(sixteen, listings)

    expect(thisGeneration!.basis).toBe('this-generation')
    expect(thisGeneration!.exact).toBe(true)
    expect(earlierGeneration!.listings.map((l) => l.model)).toEqual(['iphone15'])
  })

  /** The same unit can never appear under both headings. */
  it('never returns a unit under both generations', () => {
    const sixteen = offer('iphone-16', [['dimensionCapacity', '128gb']])
    const { thisGeneration, earlierGeneration } = secondHandFor(sixteen, listings)
    const here = new Set(thisGeneration!.listings.map((l) => l.partNumber))

    expect(earlierGeneration!.listings.some((l) => here.has(l.partNumber))).toBe(false)
  })

  /**
   * A Watch is the quiet case: `watchseries` matches every series Apple has
   * refurbished and the family id carries no number, so a current-series
   * configuration is priced from whatever series is in stock. That has to be
   * reported, and it does not vary — every unit here is the same older series.
   */
  it('reports an unpinned generation even when every unit shares it', () => {
    const watch = current(offer('apple-watch', [
        ['watch_cases-dimensionCaseSize', '46mm'],
        ['watch_cases-dimensionConnection', 'gps'],
      ]))!

    expect(watch.unpinned).toContain('generation')
    expect(watch.exact).toBe(false)
  })

  /**
   * Whether a token names a generation is declared, not read off the pattern.
   * `/^ipad(?:\d{4})?$/` contains the digit 4 in its `{4}` quantifier, and an
   * earlier version tested the pattern text — so the base iPad, the one family
   * with no chip in its configuration and nothing else to pin a generation,
   * was the family reported as having one pinned.
   *
   * Apple's own base-iPad tiles happen to publish a release year, which masked
   * it. The second unit here is that tile without the year: the shape the bug
   * needed, and one Apple ships elsewhere in the same grid.
   */
  it('does not read a generation out of a quantifier', () => {
    const base = offer('ipad', [
      ['dimensionCapacity', '64gb'],
      ['dimensionConnection', 'wifi'],
    ])
    const match = current(base)!

    expect(match.listings).toHaveLength(2)
    expect(match.exact).toBe(false)
    expect(match.unpinned).toContain('release year')
  })

  /**
   * Core counts identify a tier within a generation, not the generation: an M4
   * and an M5 both come in 10-core CPU, 10-core GPU.
   */
  it('does not treat matching core counts as a pinned generation', () => {
    const air = offer('macbook-air', [
      ['chassis-dimensionScreensize', '13inch'],
      ['processor-cpuCoreCount-gpuCoreCount', '10-10'],
    ])
    expect(current(air)!.exact).toBe(false)
  })

  /** Colour never moves the new price, so it must not hide a cheaper unit. */
  it('ignores colour, and says that the units vary by it', () => {
    const imac = offer('imac', [['chassis-dimensionColor', 'orange'], ['processor-cpuCoreCount-gpuCoreCount', '8-8']])
    const match = current(imac)!

    expect(match.listings).toHaveLength(2)
    expect(match.varyingOn).toContain('colour')
  })
})

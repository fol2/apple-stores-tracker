import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseRefurbGrid } from '../src/scrape/refurb'
import { matchRefurb, processorInTitle, processorOf } from '../src/shared/secondhand'
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
    expect(listings).toHaveLength(9)
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

describe('matchRefurb', () => {
  /**
   * The one shape that can be like-for-like. Apple's iPhone grid puts the
   * generation in the model token itself and carries no release-year facet, so
   * a configuration that pins capacity has pinned everything that moves the
   * price.
   */
  it('calls a match exact when the configuration pins every spec the units carry', () => {
    const phone = offer('iphone-16', [['dimensionCapacity', '128gb']])
    const match = matchRefurb(phone, listings)!

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
    const match = matchRefurb(air, listings)!

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
    const match = matchRefurb(air, listings)!

    expect(match.exact).toBe(false)
    expect(match.unpinned).toEqual(['storage', 'release year', 'memory'])
    expect(match.listings[0].amount).toBe(2629)
  })

  /** An M5 Pro 15/16 and an M5 Pro 18/20 are not the same machine. */
  it('separates chip tiers the grid facets cannot tell apart', () => {
    const pro = (cores: string) =>
      matchRefurb(
        offer('macbook-pro', [
          ['chassis-dimensionScreensize', '14inch'],
          ['processor-dimensionChip-cpuCoreCount-gpuCoreCount', cores],
        ]),
        listings,
      )!

    expect(pro('m5pro-15-16').listings.map((l) => l.amount)).toEqual([2669])
    expect(pro('m5pro-18-20').listings.map((l) => l.amount)).toEqual([2849])
  })

  it('reports nothing rather than a near miss when Apple has no such unit', () => {
    const mini = offer('mac-mini', [
      ['processor-dimensionChip-cpuCoreCount-gpuCoreCount', 'm6-12-12'],
      ['memory-dimensionMemory', '16gb'],
      ['storage-dimensionCapacity', '256gb'],
    ])
    expect(matchRefurb(mini, listings)).toBeNull()
  })

  it('has nothing to say about a family Apple does not refurbish', () => {
    expect(matchRefurb(offer('airpods-4', []), listings)).toBeNull()
  })

  /** Colour never moves the new price, so it must not hide a cheaper unit. */
  it('ignores colour, and says that the units vary by it', () => {
    const imac = offer('imac', [['chassis-dimensionColor', 'orange'], ['processor-cpuCoreCount-gpuCoreCount', '8-8']])
    const match = matchRefurb(imac, listings)!

    expect(match.listings).toHaveLength(2)
    expect(match.varyingOn).toContain('colour')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  configKeyOf,
  ctoUrl,
  expandVariant,
  extractJsonAfter,
  parseFamilyStructure,
  parseVariantPricing,
} from '../src/scrape/apple'
import { marketById } from '../src/shared/markets'
import { FAMILIES } from '../src/shared/families'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const uk = marketById('uk')!
const macMini = FAMILIES.find((f) => f.id === 'mac-mini')!
const selectPage = fixture('apple-uk-mac-mini-select.html')
const structure = parseFamilyStructure(selectPage, macMini)

describe('extractJsonAfter', () => {
  it('brace-matches past braces inside strings', () => {
    const html = 'x = {"a":"}{ not a brace","b":{"c":1}}'
    expect(extractJsonAfter(html, 'x =')).toEqual({ a: '}{ not a brace', b: { c: 1 } })
  })

  it('brace-matches past escaped quotes', () => {
    expect(extractJsonAfter('v: {"a":"say \\"}\\" now"}', 'v:')).toEqual({ a: 'say "}" now' })
  })

  it('throws rather than returning a partial object', () => {
    expect(() => extractJsonAfter('v: {"a":1', 'v:')).toThrow(/unterminated/)
    expect(() => extractJsonAfter('nothing here', 'v:')).toThrow(/anchor not found/)
  })
})

describe('parseFamilyStructure', () => {
  it('finds the CTO collection id', () => {
    expect(structure.collection).toBe('MAC_MINI_2026_COLLECTION')
  })

  it('lists one variant per chip build', () => {
    const chips = structure.variants.map(
      (v) => v.find((d) => d.field === 'processor-dimensionChip-cpuCoreCount-gpuCoreCount')?.value,
    )
    expect(chips.sort()).toEqual(['m5pro-15-16', 'm5pro-18-20', 'm6-12-12'])
  })

  it('keeps only the dimensions that carry a price', () => {
    expect(structure.dimensions.map((d) => d.field)).toContain('memory-dimensionMemory')
    expect(structure.dimensions.map((d) => d.field)).toContain('storage-dimensionCapacity')
  })

  it('strips Apple’s marketing markup from option labels', () => {
    const memory = structure.dimensions.find((d) => d.field === 'memory-dimensionMemory')!
    expect(memory.values.map((v) => v.label)).toEqual(['16GB', '24GB', '32GB', '48GB', '64GB'])
  })
})

describe('parseVariantPricing', () => {
  const pricing = parseVariantPricing(JSON.parse(fixture('cto-uk-mac-mini-m6.json')))

  it('reads the base price of the selected build', () => {
    expect(pricing.base).toBe(899)
    expect(pricing.partNumber).toBe('MHQK4B/A')
  })

  it('reads each option’s delta from the base', () => {
    expect(pricing.deltas['memory-dimensionMemory']).toEqual({ '16gb': 0, '24gb': 200, '32gb': 400 })
    expect(pricing.deltas['storage-dimensionCapacity']).toEqual({
      '256gb': 0,
      '512gb': 200,
      '1tb': 500,
      '2tb': 1000,
    })
  })

  it('throws when the response carries no price', () => {
    expect(() => parseVariantPricing({ body: {} })).toThrow(/no price/)
  })
})

describe('expandVariant', () => {
  const pricing = parseVariantPricing(JSON.parse(fixture('cto-uk-mac-mini-m6.json')))
  const m6 = structure.variants.find((v) =>
    v.some((d) => d.value === 'm6-12-12'),
  )!
  const offers = expandVariant(uk, macMini, structure, m6, pricing)

  /**
   * The spike's exit criterion, now a regression test: Apple UK quotes £1,299
   * for the M6 Mac mini with 24GB and 512GB, and we reach it by adding deltas
   * rather than by fetching that configuration.
   */
  it('reproduces Apple UK’s price for M6 / 24GB / 512GB', () => {
    const offer = offers.find(
      (o) =>
        o.dimensions.some((d) => d.value === '24gb') &&
        o.dimensions.some((d) => d.value === '512gb') &&
        o.dimensions.some((d) => d.value === '2_5gb_per_second'),
    )
    expect(offer?.amount).toBe(1299)
    expect(offer?.currency).toBe('GBP')
  })

  it('leaves bundled software out of the hardware matrix', () => {
    expect(structure.dimensions.some((d) => /preInstalledSoftware/.test(d.field))).toBe(false)
    // 3 memory x 4 storage x 2 ethernet, and nothing else.
    expect(offers.length).toBe(24)
  })

  it('prices the untouched base build at the base amount', () => {
    const base = offers.filter((o) => o.amount === pricing.base)
    expect(base.length).toBe(1)
    expect(base[0].partNumber).toBe('MHQK4B/A')
  })

  it('gives upgraded builds no part number, since they are made to order', () => {
    expect(offers.filter((o) => o.amount !== pricing.base).every((o) => o.partNumber === null)).toBe(true)
  })

  it('covers the full option matrix exactly once', () => {
    const sizes = structure.dimensions
      .filter((d) => pricing.deltas[d.field])
      .map((d) => d.values.filter((v) => v.value in pricing.deltas[d.field]).length)
    expect(offers.length).toBe(sizes.reduce((a, b) => a * b, 1))
    expect(new Set(offers.map((o) => o.configKey)).size).toBe(offers.length)
  })

  it('omits options Apple does not offer with this chip', () => {
    // 48GB and 64GB need an M5 Pro, so they must not appear under M6.
    expect(offers.some((o) => o.dimensions.some((d) => d.value === '64gb'))).toBe(false)
  })
})

describe('configKeyOf', () => {
  it('is order-independent, so markets agree on the same configuration', () => {
    const a = [
      { field: 'memory-dimensionMemory', value: '24gb', label: '24GB' },
      { field: 'storage-dimensionCapacity', value: '512gb', label: '512GB' },
    ]
    expect(configKeyOf(a)).toBe(configKeyOf([...a].reverse()))
  })

  it('ignores labels, which are translated per market', () => {
    const en = [{ field: 'memory-dimensionMemory', value: '24gb', label: '24GB' }]
    const jp = [{ field: 'memory-dimensionMemory', value: '24gb', label: '24GB メモリ' }]
    expect(configKeyOf(en)).toBe(configKeyOf(jp))
  })
})

describe('ctoUrl', () => {
  it('builds the market-prefixed endpoint with sv. selectors', () => {
    const url = ctoUrl(uk, 'MAC_MINI_2026_COLLECTION', [
      { field: 'memory-dimensionMemory', value: '24gb', label: '24GB' },
    ])
    expect(url).toBe(
      'https://www.apple.com/uk/shop/api/cto/update-config?collection=MAC_MINI_2026_COLLECTION&fae=true&sv.memory-dimensionMemory=24gb',
    )
  })

  it('uses a bare path for the US store', () => {
    expect(ctoUrl(marketById('us')!, 'X', [])).toBe(
      'https://www.apple.com/shop/api/cto/update-config?collection=X&fae=true',
    )
  })
})

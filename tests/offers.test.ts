import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  expandVariant,
  parseCatalogOffers,
  parseFamilyStructure,
  parseVariantPricing,
} from '../src/scrape/apple'
import {
  collapseUnpaidDimensions,
  hydrateOffers,
  packOffers,
  type StoredOffer,
} from '../src/shared/offers'
import { FAMILIES } from '../src/shared/families'
import { marketById } from '../src/shared/markets'
import type { Offer } from '../src/shared/types'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const uk = marketById('uk')!
const macMini = FAMILIES.find((f) => f.id === 'mac-mini')!
const structure = parseFamilyStructure(fixture('apple-uk-mac-mini-select.html'), macMini)
const pricing = parseVariantPricing(JSON.parse(fixture('cto-uk-mac-mini-m6.json')))
const m6 = structure.variants.find((v) => v.some((d) => d.value === 'm6-12-12'))!

/**
 * Two of an offer's fields restate the others, and the snapshot stopped
 * carrying them: `configKey` is the dimensions concatenated and `sourceUrl` is
 * the family's route under the market's prefix. Together they were a third of
 * every record, across every configuration in every market — enough, once a
 * Mac carried its full memory and storage matrix, to put the blob against
 * KV's 25MB value limit.
 */
describe('what the snapshot stores', () => {
  const offers: Offer[] = expandVariant(uk, macMini, structure, m6, pricing)

  it('leaves out the fields it can work out again', () => {
    const [stored] = packOffers(offers) as unknown as Record<string, unknown>[]
    expect(stored).not.toHaveProperty('configKey')
    expect(stored).not.toHaveProperty('sourceUrl')
    // Everything that cannot be derived has to survive.
    expect(stored).toMatchObject({ marketId: 'uk', familyId: 'mac-mini', currency: 'GBP' })
    expect(stored.amount).toEqual(expect.any(Number))
  })

  /**
   * The claim the saving rests on. Deriving has to reproduce the scraper's own
   * values exactly — a `configKey` that came back even slightly different
   * would break the price history, which is keyed on it, and orphan every
   * chart on the site.
   */
  it('comes back byte-identical to what the scraper produced', () => {
    expect(hydrateOffers(packOffers(offers))).toEqual(offers)
  })

  it('rebuilds the education store its own link, not the retail one', () => {
    const edu: Offer[] = expandVariant(uk, macMini, structure, m6, pricing, 'education')
    const [back] = hydrateOffers(packOffers(edu))
    expect(back.sourceUrl).toContain('/uk-edu/')
    expect(back.sourceUrl).toBe(edu[0].sourceUrl)
  })

  /**
   * A snapshot outlives a catalogue change. Losing the link is the right
   * failure; pointing at a page that never had this configuration on it is
   * not, and neither is throwing and taking the whole page down with it.
   */
  it('drops the link rather than inventing one for a family that has gone', () => {
    const orphan = { ...packOffers(offers)[0], familyId: 'mac-retired' } as StoredOffer
    const [back] = hydrateOffers([orphan])
    expect(back.sourceUrl).toBe('')
    expect(back.configKey).toBe(hydrateOffers(packOffers(offers))[0].configKey)
  })
})

/**
 * The other half of the catalogue, and the larger one. A Mac is built through
 * Apple's configurator; every iPhone, iPad and Watch is a list of stocked SKUs
 * read by `parseCatalogOffers`, which builds its own `sourceUrl`. If the two
 * paths ever disagree about how that string is made, deriving it would orphan
 * the price history for most of the site rather than a corner of it.
 */
describe('what the snapshot stores, for a catalogue family', () => {
  const iphone = FAMILIES.find((f) => f.id === 'iphone-17')!
  const offers: Offer[] = parseCatalogOffers(
    fixture('apple-uk-iphone-17-select.html'),
    uk,
    iphone,
    'retail',
  )

  it('reads the stocked builds and collapses the colours', () => {
    // Ten SKUs are two builds in five finishes, and the finish costs nothing.
    expect(offers.map((o) => o.configKey)).toEqual([
      'dimensionCapacity=256gb',
      'dimensionCapacity=512gb',
    ])
  })

  it('comes back byte-identical to what the scraper produced', () => {
    expect(hydrateOffers(packOffers(offers))).toEqual(offers)
  })
})

/**
 * Apple's configurator lists a finish as a priced option whether or not it
 * costs anything, so a MacBook Air arrived as a hundred offers that are
 * twenty-five machines -- a quarter of the published snapshot spent restating
 * prices already given, against KV's 25MB limit and downloaded whole by every
 * reader, plus a finish picker on the page that moves no number.
 */
describe('dimensions nobody pays for', () => {
  const build = (
    marketId: string,
    dimensions: [string, string][],
    amount: number,
  ): StoredOffer => ({
    marketId,
    familyId: 'macbook-air',
    store: 'retail',
    dimensions: dimensions.map(([field, value]) => ({ field, value, label: value })),
    amount,
    currency: marketId === 'uk' ? 'GBP' : 'EUR',
    partNumber: null,
  })

  const finishes = ['silver', 'midnight']
  const inEveryFinish = (marketId: string, storage: string, amount: number) =>
    finishes.map((finish) =>
      build(marketId, [['chassis-dimensionColor', finish], ['storage-dimensionCapacity', storage]], amount),
    )

  it('keeps one offer where a family charges the same for every finish', () => {
    const collapsed = collapseUnpaidDimensions([
      ...inEveryFinish('uk', '512gb', 1299),
      ...inEveryFinish('uk', '1tb', 1499),
    ])

    expect(collapsed).toHaveLength(2)
    expect(collapsed.map((o) => o.amount)).toEqual([1299, 1499])
    expect(collapsed.flatMap((o) => o.dimensions.map((d) => d.field))).toEqual([
      'storage-dimensionCapacity',
      'storage-dimensionCapacity',
    ])
  })

  /**
   * The verdict has to be one verdict for the family, in every market. Apple's
   * Irish education store really does charge two euros more for two of the
   * iMac's colours; deciding market by market would leave Ireland keying its
   * offers on a dimension nobody else carries, which is precisely how a market
   * drops out of every comparison reading "not sold".
   */
  it('keeps a finish everywhere when one market charges for it', () => {
    const collapsed = collapseUnpaidDimensions([
      ...inEveryFinish('uk', '512gb', 1299),
      build('ie', [['chassis-dimensionColor', 'silver'], ['storage-dimensionCapacity', '512gb']], 1501),
      build('ie', [['chassis-dimensionColor', 'midnight'], ['storage-dimensionCapacity', '512gb']], 1499),
    ])

    expect(collapsed).toHaveLength(4)
    expect(collapsed.every((o) => o.dimensions.some((d) => d.field === 'chassis-dimensionColor'))).toBe(true)
  })

  /**
   * A Mac's chip never varies on its own -- it moves with its core count, so
   * no two offers differ in the chip alone. That is not the same as nobody
   * paying for it, and a rule that only asked "does this field ever change the
   * price by itself" would delete the word "M6" from the page while merging
   * nothing at all.
   */
  it('keeps a dimension that never varies alone', () => {
    const chip = (name: string, cores: string, amount: number) =>
      build('uk', [['processor-dimensionChip', name], ['processor-cpuCoreCount-gpuCoreCount', cores]], amount)
    const collapsed = collapseUnpaidDimensions([chip('m6', '12-12', 899), chip('m5pro', '15-16', 1399)])

    expect(collapsed).toHaveLength(2)
    expect(collapsed[0].dimensions.map((d) => d.field)).toContain('processor-dimensionChip')
  })

  /**
   * A field an offer does not carry is not a value that offer has. Apple's
   * base iMac has no nano-texture option at all, so a third of that family's
   * offers name no glass; reading the absence as a value pairs a machine that
   * can take the option against one that cannot, and merges two different
   * machines whenever they happen to cost the same.
   */
  it('does not read a missing option as one nobody pays for', () => {
    const collapsed = collapseUnpaidDimensions([
      build('uk', [['storage-dimensionCapacity', '256gb']], 1699),
      build('uk', [['storage-dimensionCapacity', '256gb'], ['display-dimensionFinish', 'glossy']], 1699),
    ])

    expect(collapsed).toHaveLength(2)
  })

  it('changes nothing on a second pass', () => {
    const once = collapseUnpaidDimensions([...inEveryFinish('uk', '512gb', 1299), ...inEveryFinish('uk', '1tb', 1499)])
    expect(collapseUnpaidDimensions(once)).toEqual(once)
  })
})

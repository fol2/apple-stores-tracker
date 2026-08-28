import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expandVariant, parseFamilyStructure, parseVariantPricing } from '../src/scrape/apple'
import { hydrateOffers, packOffers, type StoredOffer } from '../src/shared/offers'
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

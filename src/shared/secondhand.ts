import type { Offer, RefurbListing } from './types'

/**
 * Apple's refurbished store is split into these grids, one page each.
 *
 * The list lives here rather than in the scraper because the matcher needs it
 * too: a family whose grid failed to load must say so, rather than say Apple
 * has none.
 */
export const REFURB_CATEGORIES = ['mac', 'ipad', 'iphone', 'watch', 'appletv', 'homepod'] as const
export type RefurbCategory = (typeof REFURB_CATEGORIES)[number]

/**
 * Which refurbished-grid models belong to each family we price.
 *
 * Apple's grid uses its own model tokens, and they are not our family ids:
 * `ipadair_11` and `ipadair_13` are both the iPad Air, `macbookpro` covers
 * every size and chip, and a Watch is `watchseries11`, not `applewatch`. The
 * rest of the specification is pinned by the facet match below, so a broad
 * token here does not loosen the comparison.
 */
interface FamilyGrid {
  category: RefurbCategory
  model: RegExp
  /**
   * The same product a generation or more back, where Apple's token names the
   * generation. Used only when nothing current is in stock — see `matchRefurb`.
   */
  lineage?: RegExp
}

const REFURB_MODELS: Record<string, FamilyGrid> = {
  'macbook-air': { category: 'mac', model: /^macbookair/ },
  'macbook-pro': { category: 'mac', model: /^macbookpro/ },
  'macbook-neo': { category: 'mac', model: /^macbookneo/ },
  imac: { category: 'mac', model: /^imac/ },
  'mac-mini': { category: 'mac', model: /^macmini/ },
  'mac-studio': { category: 'mac', model: /^macstudio/ },
  'ipad-pro': { category: 'ipad', model: /^ipadpro/ },
  'ipad-air': { category: 'ipad', model: /^ipadair/ },
  'ipad-mini': { category: 'ipad', model: /^ipadmini/ },
  ipad: { category: 'ipad', model: /^ipad(?:\d{4})?$/ },
  'iphone-17': { category: 'iphone', model: /^iphone17$/, lineage: /^iphone\d+$/ },
  'iphone-17-pro': { category: 'iphone', model: /^iphone17pro/, lineage: /^iphone\d+pro/ },
  'iphone-17e': { category: 'iphone', model: /^iphone17e$/, lineage: /^iphone\d+e$/ },
  'iphone-16': { category: 'iphone', model: /^iphone16$/, lineage: /^iphone\d+$/ },
  'iphone-air': { category: 'iphone', model: /^iphoneair/ },
  // `watchse` alone would also match `watchseries10`, so the SE needs its digit.
  'apple-watch': { category: 'watch', model: /^watchseries/ },
  'apple-watch-se': { category: 'watch', model: /^watchse\d/ },
  'apple-watch-ultra': { category: 'watch', model: /^watchultra/ },
  'apple-tv-4k': { category: 'appletv', model: /^appletv/ },
  homepod: { category: 'homepod', model: /^homepod$/ },
  'homepod-mini': { category: 'homepod', model: /^homepodmini/ },
}

/** The grid a family's units would appear in, if Apple refurbishes it at all. */
export const refurbCategoryFor = (familyId: string): RefurbCategory | null =>
  REFURB_MODELS[familyId]?.category ?? null

/**
 * Our dimension fields carry the selector section they came from
 * (`storage-dimensionCapacity`); the grid's facets do not. Match on the
 * suffix — and note that one suffix can mean two different grid keys, since
 * Apple spells connectivity `dimensionconnectivity` on an iPad and
 * `dimensionConnection` on a Watch. A listing carries exactly one of them.
 *
 * Colour is deliberately absent. It never moves the new price, and a buyer
 * comparing a second-hand price against a new one is not served by hiding the
 * silver one because they were looking at midnight.
 */
const FACETS_FOR_SUFFIX: Record<string, string[]> = {
  dimensionCapacity: ['dimensionCapacity'],
  dimensionScreensize: ['dimensionScreensize'],
  dimensionMemory: ['tsMemorySize'],
  dimensionConnection: ['dimensionconnectivity', 'dimensionConnection'],
  dimensionCaseSize: ['dimensionCaseSize'],
  dimensionCaseMaterial: ['dimensionCaseMaterial'],
}

/**
 * Facets that move the price, and so decide whether a comparison is honest.
 *
 * If a listing pins one of these and our configuration does not, the two are
 * not the same machine however well everything else lines up: a used 4TB
 * MacBook Air costs more than a new base one, and quoting it as "this
 * configuration, used" would be a straightforwardly false claim.
 */
const PRICE_DRIVING = new Set([
  'dimensionCapacity',
  'tsMemorySize',
  'dimensionconnectivity',
  'dimensionConnection',
  'dimensionCaseSize',
  'dimensionCaseMaterial',
  // A generation is a spec. Apple refurbishes what it sold a year ago, and an
  // M2 iPad Pro sitting next to an M4 one is not a cheaper version of it.
  'dimensionRelYear',
])

const FACET_LABELS: Record<string, string> = {
  dimensionCapacity: 'storage',
  dimensionScreensize: 'screen size',
  tsMemorySize: 'memory',
  dimensionconnectivity: 'connectivity',
  dimensionConnection: 'connectivity',
  dimensionCaseSize: 'case size',
  dimensionCaseMaterial: 'case material',
  dimensionColor: 'colour',
  dimensionRelYear: 'release year',
  refurbClearModel: 'generation',
}

const labelFor = (facet: string): string => FACET_LABELS[facet] ?? facet

/** Chip family and core counts, however each side happens to spell them. */
interface Processor {
  chip?: string
  cpu?: number
  gpu?: number
}

/**
 * What our configuration says about the processor.
 *
 * Apple spells this three ways across families: a chip token on its own
 * (`m5pro`), a chip token with its core counts (`m5pro-15-16`), or bare core
 * counts where the family has only one chip (`10-10`).
 */
export function processorOf(offer: Offer): Processor {
  const processor: Processor = {}
  for (const dimension of offer.dimensions) {
    if (!dimension.field.includes('CoreCount') && !dimension.field.endsWith('dimensionChip')) continue
    const parts = dimension.value.split('-')
    const cores = parts.filter((p) => /^\d+$/.test(p)).map(Number)
    const chip = parts.find((p) => /^m\d/.test(p))
    if (chip) processor.chip = chip
    if (cores.length === 2) [processor.cpu, processor.gpu] = cores
  }
  return processor
}

/**
 * What a listing's own title says about the processor.
 *
 * The grid's facets do not carry the chip, so an M5 and an M5 Pro of the same
 * size and storage look identical there. The title names it, and a comparison
 * that skipped this would be quoting one machine's price against another's.
 */
export function processorInTitle(title: string): Processor {
  const processor: Processor = {}
  // "Apple M5 Pro chip" on a Mac, a bare "(M4)" on an iPad.
  const chip =
    /\bapple\s+(m\d+)(?:\s+(pro|max|ultra))?\s+chip/i.exec(title) ??
    /\((m\d+)(?:\s+(pro|max|ultra))?\)/i.exec(title)
  if (chip) processor.chip = (chip[1] + (chip[2] ?? '')).toLowerCase()

  const cpu = /(\d+)[‐-―-]core\s+cpu/i.exec(title)
  const gpu = /(\d+)[‐-―-]core\s+gpu/i.exec(title)
  if (cpu) processor.cpu = Number(cpu[1])
  if (gpu) processor.gpu = Number(gpu[1])
  return processor
}

/**
 * The generation number in a family id or a grid token: `iphone-17` and
 * `iphone17` are 17, `watchseries10` is 10, `macbookpro` is nothing.
 */
const generationIn = (text: string): number | undefined => {
  const digits = /(\d+)/.exec(text)?.[1]
  return digits ? Number(digits) : undefined
}

/** `m6` is 6. A chip number is a generation too, where a token is not. */
const chipGeneration = (chip: string | undefined): number | undefined => {
  const digits = chip ? /^m(\d+)/.exec(chip)?.[1] : undefined
  return digits ? Number(digits) : undefined
}

/** Equal wherever both sides say something; silence never contradicts. */
const processorsAgree = (a: Processor, b: Processor): boolean =>
  (!a.chip || !b.chip || a.chip === b.chip) &&
  (!a.cpu || !b.cpu || a.cpu === b.cpu) &&
  (!a.gpu || !b.gpu || a.gpu === b.gpu)

/** One spec this configuration pins, and the grid keys that could carry it. */
interface Wanted {
  keys: string[]
  value: string
}

const carriedKey = (wanted: Wanted, listing: RefurbListing): string | undefined =>
  wanted.keys.find((key) => listing.dimensions[key] !== undefined)

export interface SecondHandMatch {
  /** Matching units, cheapest first. */
  listings: RefurbListing[]
  low: number
  high: number
  currency: string
  /** The specs actually checked against the units, for display. */
  matchedOn: string[]
  /**
   * Facets the matched units differ on. These are specs this configuration
   * does not pin, so the range spans them rather than describing one machine.
   */
  varyingOn: string[]
  /**
   * Whether these units are the product being priced, or the nearest earlier
   * generation Apple still has. Apple discontinues a model the day it
   * announces its replacement, so the refurbished store is often a generation
   * behind the new-price catalogue — with nothing at all for the new one.
   */
  basis: 'this-generation' | 'earlier-generation'
  /**
   * Whether these units are the same machine as the configuration priced
   * alongside them: at least one price-driving spec positively confirmed on
   * every unit, and no price-driving spec left unpinned.
   *
   * Positive confirmation, not absence of contradiction. A unit that carries
   * no facets at all -- Apple lists its TV that way -- contradicts nothing,
   * and an earlier version of this called that "the same configuration" while
   * comparing a 128GB new box with a 64GB used one.
   */
  exact: boolean
  /** Price-driving facets the units carry and this configuration does not. */
  unpinned: string[]
}

/**
 * Find the refurbished units that answer "what does this cost used".
 *
 * Matching is by construction never an identity claim: the grid's facets and
 * our configuration dimensions overlap without either containing the other, so
 * this pins every facet both sides name, checks the processor against the
 * listing's own title, and then reports what it matched on, what the matches
 * still vary by, and whether the result is the same machine at all.
 */
export function matchRefurb(offer: Offer, listings: RefurbListing[]): SecondHandMatch | null {
  const family = REFURB_MODELS[offer.familyId]
  if (!family) return null

  return (
    search(offer, listings, family.model, true) ??
    search(offer, listings, family.lineage ?? family.model, false)
  )
}

/**
 * @param model      which grid tokens count as this family.
 * @param sameChip   whether the unit's processor must match the configuration.
 *                   False is the fallback pass, and every unit it returns has
 *                   to prove it is an earlier generation.
 */
function search(
  offer: Offer,
  listings: RefurbListing[],
  model: RegExp,
  sameChip: boolean,
): SecondHandMatch | null {
  const wanted: Wanted[] = []
  for (const dimension of offer.dimensions) {
    const keys = FACETS_FOR_SUFFIX[dimension.field.slice(dimension.field.lastIndexOf('-') + 1)]
    if (keys) wanted.push({ keys, value: dimension.value })
  }
  const processor = processorOf(offer)

  const configGeneration = generationIn(offer.familyId)
  const configChip = chipGeneration(processor.chip)

  /**
   * Strictly older, by Apple's own numbering: an iPhone 16 against an iPhone
   * 17, an M4 against an M6. Anything that cannot prove it is behind the
   * configuration is not offered at all, so the label is never a guess.
   */
  const isEarlier = (listing: RefurbListing): boolean => {
    const generation = generationIn(listing.model)
    const chip = chipGeneration(processorInTitle(listing.title).chip)
    return (
      (configGeneration !== undefined && generation !== undefined && generation < configGeneration) ||
      (configChip !== undefined && chip !== undefined && chip < configChip)
    )
  }

  const matches = listings.filter((listing) => {
    if (!model.test(listing.model)) return false
    if (!sameChip && !isEarlier(listing)) return false
    for (const spec of wanted) {
      // A facet the grid does not carry for this model cannot disagree; one it
      // does carry must agree exactly.
      const key = carriedKey(spec, listing)
      if (key !== undefined && listing.dimensions[key] !== spec.value) return false
    }
    return !sameChip || processorsAgree(processor, processorInTitle(listing.title))
  })

  if (matches.length === 0) return null

  const sorted = [...matches].sort((a, b) => a.amount - b.amount)
  const facetsCarried = [...new Set(matches.flatMap((l) => Object.keys(l.dimensions)))]
  const asked = new Set(wanted.flatMap((spec) => spec.keys))

  // Judged per facet the listings carry, not per facet that happens to vary: a
  // single match varies by nothing while still being a different machine.
  const unpinned = facetsCarried
    .filter((facet) => PRICE_DRIVING.has(facet) && !asked.has(facet))
    .map(labelFor)

  // `refurbClearModel` is included deliberately. Apple's Watch token carries
  // the series, and a Series 11 configuration quietly priced from Series 10
  // stock is the whole reason this list exists.
  const varyingOn = facetsCarried
    .filter(
      (facet) =>
        !asked.has(facet) &&
        new Set(matches.map((l) => l.dimensions[facet])).size > 1,
    )
    .map(labelFor)

  /**
   * A generation is pinned when the grid token names one (`iphone16`) or when
   * the configuration named a processor for the title check to agree with.
   * Neither holds for a Watch: `watchseries` matches every series Apple has
   * refurbished, and our family id is just `apple-watch` — so a Series 11
   * configuration was being priced from Series 10 stock with nothing saying
   * so. Release year already carries this for the grids that publish it.
   */
  const generationPinned =
    /\d/.test(model.source) || processor.chip !== undefined || processor.cpu !== undefined
  if (!generationPinned && !unpinned.includes(labelFor('dimensionRelYear'))) {
    unpinned.push(labelFor('refurbClearModel'))
  }

  const checked = wanted.filter((spec) => matches.some((l) => carriedKey(spec, l) !== undefined))
  const confirmed = checked.filter((spec) => spec.keys.some((key) => PRICE_DRIVING.has(key)))

  const matchedOn = checked.map((spec) => labelFor(carriedKey(spec, matches[0]) ?? spec.keys[0]))
  if (processor.chip || processor.cpu) matchedOn.push('processor')

  return {
    listings: sorted,
    low: sorted[0].amount,
    high: sorted[sorted.length - 1].amount,
    currency: sorted[0].currency,
    matchedOn,
    varyingOn,
    basis: sameChip ? 'this-generation' : 'earlier-generation',
    // Every unit must carry and agree on each confirmed spec, and there must
    // be at least one -- otherwise nothing was verified.
    // An earlier generation is never the same machine, whatever else lines up.
    exact:
      sameChip &&
      unpinned.length === 0 &&
      confirmed.length > 0 &&
      confirmed.every((spec) => matches.every((l) => carriedKey(spec, l) !== undefined)),
    unpinned,
  }
}

import type { Offer, RefurbListing } from './types'

/**
 * Which refurbished-grid models belong to each family we price.
 *
 * Apple's grid uses its own model tokens, and they are not our family ids:
 * `ipadair_11` and `ipadair_13` are both the iPad Air, `macbookpro` covers
 * every size and chip. The screen size is then pinned separately by the facet
 * match below, so a broad token here does not loosen the comparison.
 */
const REFURB_MODELS: Record<string, RegExp> = {
  'macbook-air': /^macbookair/,
  'macbook-pro': /^macbookpro/,
  'macbook-neo': /^macbookneo/,
  imac: /^imac/,
  'mac-mini': /^macmini/,
  'mac-studio': /^macstudio/,
  'mac-pro': /^macpro/,
  'ipad-pro': /^ipadpro/,
  'ipad-air': /^ipadair/,
  'ipad-mini': /^ipadmini/,
  ipad: /^ipad(?:\d{4})?$/,
  'iphone-17': /^iphone17$/,
  'iphone-17-pro': /^iphone17pro/,
  'iphone-17e': /^iphone17e$/,
  'iphone-16': /^iphone16$/,
  'iphone-air': /^iphoneair/,
  'apple-watch': /^applewatchseries/,
  'apple-watch-se': /^applewatchse/,
  'apple-watch-ultra': /^applewatchultra/,
  'apple-tv-4k': /^appletv/,
  homepod: /^homepod$/,
  'homepod-mini': /^homepodmini/,
  'studio-display': /^studiodisplay/,
  'apple-vision-pro': /^visionpro/,
}

/**
 * Our dimension fields carry the selector section they came from
 * (`storage-dimensionCapacity`); the grid's facets do not. Match on the
 * suffix, and only for facets that mean the same thing on both sides.
 *
 * Colour is deliberately absent. It never moves the new price, and a buyer
 * comparing a second-hand price against a new one is not served by hiding the
 * silver one because they were looking at midnight.
 */
const FACET_FOR_SUFFIX: Record<string, string> = {
  dimensionCapacity: 'dimensionCapacity',
  dimensionScreensize: 'dimensionScreensize',
  dimensionMemory: 'tsMemorySize',
  dimensionConnection: 'dimensionconnectivity',
}

/**
 * Facets that move the price, and so decide whether a comparison is honest.
 *
 * If a listing pins one of these and our configuration does not, the two are
 * not the same machine however well everything else lines up: a used 4TB
 * MacBook Air costs more than a new base one, and quoting it as "this
 * configuration, used" would be a straightforwardly false claim.
 */
const PRICE_DRIVING = [
  'dimensionCapacity',
  'tsMemorySize',
  'dimensionconnectivity',
  // A generation is a spec. Apple refurbishes what it sold a year ago, and an
  // M2 iPad Pro sitting next to an M4 one is not a cheaper version of it.
  'dimensionRelYear',
]

const FACET_LABELS: Record<string, string> = {
  dimensionCapacity: 'storage',
  dimensionScreensize: 'screen size',
  tsMemorySize: 'memory',
  dimensionconnectivity: 'connectivity',
  dimensionColor: 'colour',
  dimensionRelYear: 'release year',
}

const facetOf = (field: string): string | undefined =>
  FACET_FOR_SUFFIX[field.slice(field.lastIndexOf('-') + 1)]

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

/** Equal wherever both sides say something; silence never contradicts. */
const processorsAgree = (a: Processor, b: Processor): boolean =>
  (!a.chip || !b.chip || a.chip === b.chip) &&
  (!a.cpu || !b.cpu || a.cpu === b.cpu) &&
  (!a.gpu || !b.gpu || a.gpu === b.gpu)

export interface SecondHandMatch {
  /** Matching units, cheapest first. */
  listings: RefurbListing[]
  low: number
  high: number
  currency: string
  /** The facets this configuration actually pinned, for display. */
  matchedOn: string[]
  /**
   * Facets the matched units differ on. These are the specs this
   * configuration does not pin, so the range spans them rather than
   * describing one machine.
   */
  varyingOn: string[]
  /**
   * Whether every price-driving facet these units carry is pinned by this
   * configuration. False means the units are the same model and chip but not
   * the same machine, and no honest reading subtracts one price from the
   * other.
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
 * listing's own title, and then reports what it matched on and what the
 * matches still vary by. A caller showing the range without showing those two
 * lists would be presenting unlike machines as the same one.
 */
export function matchRefurb(offer: Offer, listings: RefurbListing[]): SecondHandMatch | null {
  const model = REFURB_MODELS[offer.familyId]
  if (!model) return null

  const wanted = new Map<string, string>()
  for (const dimension of offer.dimensions) {
    const facet = facetOf(dimension.field)
    if (facet) wanted.set(facet, dimension.value)
  }
  const processor = processorOf(offer)

  const matches = listings.filter((listing) => {
    if (!model.test(listing.model)) return false
    for (const [facet, value] of wanted) {
      const theirs = listing.dimensions[facet]
      // A facet the grid does not carry for this model cannot disagree; one it
      // does carry must agree exactly.
      if (theirs !== undefined && theirs !== value) return false
    }
    return processorsAgree(processor, processorInTitle(listing.title))
  })

  if (matches.length === 0) return null

  const sorted = [...matches].sort((a, b) => a.amount - b.amount)
  const amounts = sorted.map((l) => l.amount)

  const matchedOn = [...wanted.keys()]
    .filter((facet) => matches.some((l) => l.dimensions[facet] !== undefined))
    .map((facet) => FACET_LABELS[facet] ?? facet)
  if (processor.chip || processor.cpu) matchedOn.push('processor')

  const facetsCarried = [...new Set(matches.flatMap((l) => Object.keys(l.dimensions)))]

  // Judged per facet the listings carry, not per facet that happens to vary:
  // a single match varies by nothing while still being a different machine.
  const unpinned = facetsCarried
    .filter((facet) => PRICE_DRIVING.includes(facet) && !wanted.has(facet))
    .map((facet) => FACET_LABELS[facet] ?? facet)

  const varyingOn = facetsCarried
    .filter(
      (facet) =>
        facet !== 'refurbClearModel' &&
        !wanted.has(facet) &&
        new Set(matches.map((l) => l.dimensions[facet])).size > 1,
    )
    .map((facet) => FACET_LABELS[facet] ?? facet)

  return {
    listings: sorted,
    low: amounts[0],
    high: amounts[amounts.length - 1],
    currency: sorted[0].currency,
    matchedOn,
    varyingOn,
    exact: unpinned.length === 0,
    unpinned,
  }
}

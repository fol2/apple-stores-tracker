import type { Category, Family } from '../../shared/families'
import type { Market } from '../../shared/markets'
import type { RefundPolicy } from '../../shared/refunds'
import { hydrateOffers, type StoredOffer } from '../../shared/offers'
import type {
  DimensionValue,
  FxRates,
  Offer,
  RefurbCategory,
  RefurbListing,
} from '../../shared/types'

export interface SnapshotResponse {
  collectedAt: string
  baseCurrency: string
  markets: Market[]
  categories: Category[]
  families: Family[]
  refunds: Record<string, RefundPolicy>
  fx: FxRates | null
  /** Second-hand listings for the one market they are collected in. */
  refurb: {
    marketId: string
    collectedAt: string
    listings: RefurbListing[]
    errors: { category: RefurbCategory; message: string }[]
  } | null
  offers: Offer[]
  errors: { marketId: string; familyId: string; store?: 'retail' | 'education'; message: string }[]
}

export async function loadSnapshot(): Promise<SnapshotResponse> {
  const response = await fetch('/api/snapshot')
  if (!response.ok) throw new Error(`Prices are unavailable (${response.status}).`)
  const body = await response.json()
  if (body.error) throw new Error(body.error)

  const data = body as Omit<SnapshotResponse, 'offers'> & { offers: StoredOffer[] }
  return {
    ...data,
    // The snapshot ships without the two fields that restate the others, so
    // they are rebuilt here -- the one boundary where stored data enters the
    // app. A snapshot collected before education prices existed also has no
    // `store`; defaulting it in the same pass keeps a stale snapshot rendering
    // instead of filtering every offer out and leaving the page on "Loading".
    offers: hydrateOffers(data.offers.map((o) => ({ ...o, store: o.store ?? 'retail' }))),
  }
}

export interface Dimension {
  field: string
  label: string
  values: { value: string; label: string }[]
}

/**
 * Derive the specification picker from the prices themselves.
 *
 * Availability differs by market, so the options are the union across every
 * market -- otherwise a configuration sold in Japan but not the UK would be
 * unreachable, which is exactly the kind of thing this site exists to show.
 */
export function dimensionsOf(offers: Offer[], familyId: string): Dimension[] {
  const order: string[] = []
  const byField = new Map<string, Map<string, string>>()

  for (const offer of offers) {
    if (offer.familyId !== familyId || offer.store === 'education') continue
    for (const { field, value, label } of offer.dimensions) {
      if (!byField.has(field)) {
        byField.set(field, new Map())
        order.push(field)
      }
      byField.get(field)!.set(value, label)
    }
  }

  // Order each dimension by what it costs. Apple's own order is not carried on
  // the offers, and cheapest-first is both stable across markets and the order
  // a buyer reads anyway: 256GB before 512GB, 16GB before 64GB.
  const floor = new Map<string, number>()
  for (const offer of offers) {
    if (offer.familyId !== familyId || offer.store === 'education') continue
    for (const { field, value } of offer.dimensions) {
      const key = `${field}=${value}`
      floor.set(key, Math.min(floor.get(key) ?? Infinity, offer.amount))
    }
  }

  return order.map((field) => ({
    field,
    label: dimensionLabel(field),
    values: [...byField.get(field)!]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => (floor.get(`${field}=${a.value}`) ?? 0) - (floor.get(`${field}=${b.value}`) ?? 0)),
  }))
}

/** Apple's field ids are internal; give each a name a buyer would use. */
function dimensionLabel(field: string): string {
  const tail = field.split('-').pop() ?? field
  const named: Record<string, string> = {
    dimensionChip: 'Chip',
    dimensionMemory: 'Memory',
    dimensionCapacity: 'Storage',
    dimensionScreensize: 'Model',
    dimensionColor: 'Finish',
    dimensionConnection: 'Connectivity',
    dimensionCaseSize: 'Case size',
    dimensionCaseMaterial: 'Case material',
    ethernetBandwidth: 'Ethernet',
    dimensionFinish: 'Glass',
    dimensionStandType: 'Stand',
    gpuCoreCount: 'Cores',
  }
  if (named[tail]) return named[tail]
  return tail.replace(/^dimension/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}

const keyOf = (dimensions: DimensionValue[]): string =>
  dimensions
    .map((d) => `${d.field}=${d.value}`)
    .sort()
    .join('|')

/**
 * Snap a wanted specification to a real one.
 *
 * Choosing 64GB may rule out the selected chip, so rather than showing an
 * empty table we pick the offered configuration that agrees with the most
 * recent choices -- the same way Apple's own selector repairs a build.
 */
export function resolveSelection(
  offers: Offer[],
  familyId: string,
  wanted: Record<string, string>,
  priority: string[],
  homeMarketId: string,
): { configKey: string; dimensions: DimensionValue[] } | null {
  // Resolve against retail: education is a second price for the same build,
  // and offering education-only configurations would be a different catalogue.
  const candidates = offers.filter((o) => o.familyId === familyId && o.store !== 'education')
  if (candidates.length === 0) return null

  // Before anything is chosen, open on the entry-level build, the way Apple's
  // own "From ..." price does. Price it at home so the default is comparable.
  if (priority.length === 0) {
    const home = candidates.filter((o) => o.marketId === homeMarketId)
    const pool = home.length ? home : candidates
    const cheapest = pool.reduce((low, o) => (o.amount < low.amount ? o : low), pool[0])
    return { configKey: keyOf(cheapest.dimensions), dimensions: cheapest.dimensions }
  }

  let best = candidates[0]
  let bestScore = -1
  for (const offer of candidates) {
    let score = 0
    for (const [index, field] of priority.entries()) {
      const match = offer.dimensions.find((d) => d.field === field)
      if (match && match.value === wanted[field]) score += priority.length - index
    }
    if (score > bestScore) {
      bestScore = score
      best = offer
    }
  }

  return { configKey: keyOf(best.dimensions), dimensions: best.dimensions }
}

export const offersFor = (offers: Offer[], familyId: string, configKey: string): Offer[] =>
  offers.filter((o) => o.familyId === familyId && o.configKey === configKey)

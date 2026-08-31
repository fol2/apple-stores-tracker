import type { DimensionValue, FamilyStructure, Offer } from '../shared/types'
import { storeUrl, type Market, type Store } from '../shared/markets'
import { FAMILIES, type Family } from '../shared/families'
import {
  ctoUrl,
  expandVariant,
  parseCatalogOffers,
  parseFamilyStructure,
  parseVariantPricing,
} from './apple'

/**
 * Identify ourselves rather than hiding behind a browser string. Apple's
 * robots.txt permits these paths; a contactable agent is the difference
 * between a scraper someone can ask to slow down and one they can only block.
 */
const USER_AGENT =
  'apple-price-tracker/1.0 (+https://apple-price-tracker.eugnel.com; price comparison; contact via site)'

/**
 * Statuses that mean "you are going too fast", not "this does not exist".
 * Apple's edge answers a burst with 541, alongside the usual 429/503.
 */
const THROTTLED = new Set([429, 503, 541])

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Small random pause so parallel workers do not march in lockstep. */
const jitter = (ms: number) => sleep(ms / 2 + Math.random() * ms)

/**
 * When one request is throttled, every worker must slow down.
 *
 * The rate limit belongs to the origin, not to a request, so backing off only
 * the unlucky caller leaves the rest of the pool hammering the very limit we
 * just tripped. This gate makes the cool-off shared.
 */
let coolOffUntil = 0

const respectCoolOff = async (): Promise<void> => {
  const wait = coolOffUntil - Date.now()
  if (wait > 0) await sleep(wait)
}

const MAX_ATTEMPTS = 6

/**
 * A hard ceiling on outbound requests for one run.
 *
 * Cloudflare caps subrequests per Worker invocation, and a retry spends from
 * the same allowance as a first attempt — so a throttled patch of families can
 * quietly exhaust the budget that later families were counting on. Exceeding
 * the cap kills the whole invocation mid-flight and loses the work already
 * done, whereas running out of this budget fails one family cleanly and leaves
 * the rest of the step intact.
 */
export class RequestBudget {
  private spent = 0

  constructor(private readonly limit: number) {}

  claim(): void {
    if (this.spent >= this.limit) {
      throw new Error(`request budget of ${this.limit} exhausted`)
    }
    this.spent++
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.spent)
  }
}

/**
 * Every outbound request goes through here, so the cool-off, the retry policy
 * and the budget are one regime rather than one per caller.
 */
export const get = async (url: string, budget: RequestBudget): Promise<Response> => {
  for (let attempt = 1; ; attempt++) {
    await respectCoolOff()
    budget.claim()

    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json' },
    })
    if (response.ok) return response

    if (!THROTTLED.has(response.status) || attempt >= MAX_ATTEMPTS) {
      throw new Error(`${response.status} for ${url}`)
    }

    const backoff = 800 * 2 ** attempt
    coolOffUntil = Math.max(coolOffUntil, Date.now() + backoff)
    await jitter(backoff)
  }
}

/**
 * Run tasks a few at a time, pausing between them.
 *
 * Apple's edge throttles bursts, and every request here is against one origin,
 * so the pool is deliberately narrow. A sweep step has a whole cron interval
 * to finish in; there is nothing to win by going faster.
 */
const POOL_SIZE = 3
const PACE_MS = 150

async function pooled<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(POOL_SIZE, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await run(items[index])
      await jitter(PACE_MS)
    }
  })
  await Promise.all(workers)
  return results
}

export interface CollectionError {
  marketId: string
  familyId: string
  store: Store
  message: string
}

export interface FamilyStructures {
  discoveredAt: string
  structures: FamilyStructure[]
  errors: CollectionError[]
}

/**
 * Read every family's selector shape once. Dimensions and chip variants are
 * market-independent -- only the money differs -- so this runs against a
 * single market and the result is reused for all of them.
 */
export async function discoverStructures(
  market: Market,
  budget: RequestBudget,
): Promise<FamilyStructures> {
  const structures: FamilyStructure[] = []
  const errors: CollectionError[] = []

  await pooled(FAMILIES, async (family) => {
    try {
      const html = await (await get(storeUrl(market, family.route), budget)).text()
      structures.push(parseFamilyStructure(html, family))
    } catch (error) {
      errors.push({ marketId: market.id, familyId: family.id, store: 'retail', message: String(error) })
    }
  })

  return { discoveredAt: new Date().toISOString(), structures, errors }
}

export interface MarketCollection {
  marketId: string
  store: Store
  collectedAt: string
  offers: Offer[]
  errors: CollectionError[]
}

/**
 * Price a set of families in one market, at one of Apple's stores.
 *
 * Callers pass a slice of the catalogue rather than all of it, so that a step
 * fits inside the request budget it was planned against.
 */
export async function collectFamilies(
  market: Market,
  store: Store,
  structures: FamilyStructure[],
  budget: RequestBudget,
): Promise<MarketCollection> {
  const offers: Offer[] = []
  const errors: CollectionError[] = []

  type Job =
    | { kind: 'cto'; family: Family; structure: FamilyStructure; variant: DimensionValue[] }
    | { kind: 'catalog'; family: Family; structure: FamilyStructure }

  const jobs = structures.flatMap((structure): Job[] => {
    const family = FAMILIES.find((f) => f.id === structure.familyId)
    if (!family) return []
    if (structure.kind === 'catalog') return [{ kind: 'catalog', family, structure }]
    return structure.variants.map((variant) => ({ kind: 'cto' as const, family, structure, variant }))
  })

  await pooled(jobs, async (job) => {
    try {
      if (job.kind === 'catalog') {
        const html = await (await get(storeUrl(market, job.family.route, store), budget)).text()
        offers.push(...parseCatalogOffers(html, market, job.family, job.structure, store))
        return
      }
      const url = ctoUrl(market, job.structure.collection!, job.variant, store)
      const pricing = parseVariantPricing((await (await get(url, budget)).json()) as never)
      offers.push(...expandVariant(market, job.family, job.structure, job.variant, pricing, store))
    } catch (error) {
      errors.push({ marketId: market.id, familyId: job.family.id, store, message: String(error) })
    }
  })

  return { marketId: market.id, store, collectedAt: new Date().toISOString(), offers, errors }
}

export type { Family }

import { MARKETS, STORES, type Store } from './markets'
import { FAMILIES, hasEducationPricing } from './families'
import type { FamilyStructure } from './types'

/**
 * Outbound requests one cron tick may make.
 *
 * Cloudflare caps subrequests per Worker invocation, and KV and D1 calls draw
 * on the same allowance as `fetch`. This sits well under the cap so retries
 * and the step's own storage writes still have room; exceeding the cap aborts
 * the invocation and throws away everything it had already collected.
 */
export const REQUESTS_PER_TICK = 30

/** Plan each step below that, to leave headroom for retries. */
export const REQUESTS_PER_STEP = 15

export interface SweepStep {
  marketId: string
  store: Store
  familyIds: string[]
}

/**
 * How many requests pricing one family costs.
 *
 * A build-to-order family needs one request per chip variant, because Apple
 * quotes option deltas relative to a selected build. A catalogue family needs
 * one, because its page already carries every price.
 */
export const familyRequestCost = (structure: FamilyStructure): number =>
  structure.kind === 'cto' ? Math.max(1, structure.variants.length) : 1

/**
 * Break the catalogue into steps that each fit a single invocation.
 *
 * Costs are read from the discovered structures rather than assumed, so a
 * family that gains a chip variant makes its own step smaller instead of
 * quietly pushing the step over the limit.
 */
export function planSweep(structures: FamilyStructure[]): SweepStep[] {
  const steps: SweepStep[] = []

  for (const market of MARKETS) {
    for (const store of STORES) {
      let batch: string[] = []
      let cost = 0

      for (const structure of structures) {
        if (store === 'education') {
          const family = FAMILIES.find((f) => f.id === structure.familyId)
          if (family && !hasEducationPricing(family)) continue
        }

        const price = familyRequestCost(structure)
        if (batch.length > 0 && cost + price > REQUESTS_PER_STEP) {
          steps.push({ marketId: market.id, store, familyIds: batch })
          batch = []
          cost = 0
        }
        batch.push(structure.familyId)
        cost += price
      }

      if (batch.length > 0) steps.push({ marketId: market.id, store, familyIds: batch })
    }
  }

  return steps
}

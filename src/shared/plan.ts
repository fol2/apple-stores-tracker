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
  /**
   * Half-open slice of a family's variants, for a family too expensive to
   * price in one step. Keyed by family id, absent when nothing was split.
   *
   * Without this a family simply lost its tail: a MacBook Pro costs one
   * request per build and Apple sells thirty-two of them, against a thirty
   * request tick budget, so two builds failed in every market on every sweep
   * -- and the failure was a logged error rather than a missing page, so the
   * catalogue just quietly had holes in it.
   */
  slices?: Record<string, [number, number]>
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
 *
 * Packing is first-fit-decreasing, because family costs are lopsided: a
 * MacBook Pro can cost a dozen requests while a HomePod costs one. Walking the
 * catalogue in its natural order strands a big family in a step of its own and
 * leaves the rest half empty — placing the expensive ones first, then filling
 * the gaps with cheap ones, cut a real sweep from 210 steps to well under half
 * that, and every step still fits.
 */
export function planSweep(structures: FamilyStructure[]): SweepStep[] {
  const steps: SweepStep[] = []

  for (const market of MARKETS) {
    for (const store of STORES) {
      const families = structures
        .filter((structure) => {
          if (store !== 'education') return true
          const family = FAMILIES.find((f) => f.id === structure.familyId)
          return !family || hasEducationPricing(family)
        })
        .map((structure) => ({ id: structure.familyId, cost: familyRequestCost(structure) }))
        .sort((a, b) => b.cost - a.cost || a.id.localeCompare(b.id))

      // A family costing more than one step is cut into slices of its variants
      // first, so that packing never has to place something that cannot fit.
      const parts: { id: string; cost: number; slice?: [number, number] }[] = []
      for (const family of families) {
        if (family.cost <= REQUESTS_PER_STEP) {
          parts.push({ id: family.id, cost: family.cost })
          continue
        }
        for (let from = 0; from < family.cost; from += REQUESTS_PER_STEP) {
          const to = Math.min(from + REQUESTS_PER_STEP, family.cost)
          parts.push({ id: family.id, cost: to - from, slice: [from, to] })
        }
      }

      const bins: { familyIds: string[]; slices: Record<string, [number, number]>; cost: number }[] = []

      /**
       * The last step each family was placed in.
       *
       * A family's slices must land in strictly increasing steps, because the
       * step holding its first variants is the one that clears the previous
       * sweep's results. Plain first-fit does not give that: a small tail slice
       * fits the spare room in an earlier family's last step, while its own
       * head still needs a step of its own further along -- so the head ran
       * second and wiped the tail's offers, on a sweep with nothing wrong with
       * it. Requiring a later step than the family's previous slice also means
       * two slices can never share one, which the step's shape relies on.
       */
      const placedIn = new Map<string, number>()

      for (const part of parts) {
        const after = placedIn.get(part.id) ?? -1
        let index = bins.findIndex(
          (b, i) => i > after && b.cost + part.cost <= REQUESTS_PER_STEP,
        )
        if (index === -1) {
          index = bins.length
          bins.push({ familyIds: [], slices: {}, cost: 0 })
        }
        const target = bins[index]
        target.familyIds.push(part.id)
        target.cost += part.cost
        if (part.slice) target.slices[part.id] = part.slice
        placedIn.set(part.id, index)
      }

      for (const bin of bins) {
        steps.push({
          marketId: market.id,
          store,
          familyIds: bin.familyIds,
          ...(Object.keys(bin.slices).length > 0 ? { slices: bin.slices } : {}),
        })
      }
    }
  }

  return steps
}

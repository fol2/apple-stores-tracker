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
      for (const part of parts) {
        // Two slices of one family must not share a step: the step names each
        // family once, so the second slice would overwrite the first's range.
        const bin = bins.find(
          (b) => b.cost + part.cost <= REQUESTS_PER_STEP && !b.familyIds.includes(part.id),
        )
        const target = bin ?? { familyIds: [], slices: {}, cost: 0 }
        if (!bin) bins.push(target)
        target.familyIds.push(part.id)
        target.cost += part.cost
        if (part.slice) target.slices[part.id] = part.slice
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

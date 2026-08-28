import { describe, expect, it } from 'vitest'
import {
  planSweep,
  familyRequestCost,
  REQUESTS_PER_STEP,
  REQUESTS_PER_TICK,
  type SweepStep,
} from '../src/shared/plan'

import { FAMILIES, hasEducationPricing } from '../src/shared/families'
import { MARKETS } from '../src/shared/markets'
import type { FamilyStructure } from '../src/shared/types'

/** Mirrors the real catalogue's shape: a few CTO families, the rest catalogue. */
const structures = (overrides: Partial<Record<string, number>> = {}): FamilyStructure[] =>
  FAMILIES.map((family): FamilyStructure => {
    const variants = overrides[family.id] ?? (family.categoryId === 'mac' ? 3 : 0)
    return variants > 0
      ? {
          familyId: family.id,
          kind: 'cto',
          collection: 'X',
          variants: Array.from({ length: variants }, () => []),
          dimensions: [],
        }
      : { familyId: family.id, kind: 'catalog', variants: [], dimensions: [] }
  })

const costOf = (step: SweepStep, all: FamilyStructure[]) =>
  step.familyIds.reduce((sum, id) => {
    const structure = all.find((s) => s.familyId === id)!
    const slice = step.slices?.[id]
    return sum + (slice ? slice[1] - slice[0] : familyRequestCost(structure))
  }, 0)

describe('planSweep', () => {
  /**
   * The bug this exists to prevent: a step that asks for more subrequests than
   * one Worker invocation may make. Cloudflare aborts the whole invocation,
   * losing every family it had already collected — so the guard has to hold
   * for every step, not on average.
   */
  it('keeps every step inside one invocation’s request budget', () => {
    const all = structures()
    for (const step of planSweep(all)) {
      expect(costOf(step, all), `${step.marketId}:${step.store}`).not.toBeGreaterThan(
        REQUESTS_PER_STEP,
      )
    }
  })

  it('holds even when a family gains chip variants', () => {
    const all = structures({ 'macbook-pro': 12 })
    for (const step of planSweep(all)) {
      expect(costOf(step, all)).not.toBeGreaterThan(REQUESTS_PER_STEP)
    }
  })

  /**
   * The failure this was found by. A MacBook Pro costs one request per build
   * and Apple sells thirty-two of them, against a thirty-request tick budget —
   * so on the first real cron sweep two builds failed in every market, as a
   * logged error rather than a visible gap. An earlier version of this file
   * granted an oversized family a step of its own and called it unsplittable.
   */
  it('splits a family too expensive for one step, rather than losing its tail', () => {
    const all = structures({ 'macbook-pro': 32 })
    const steps = planSweep(all).filter((s) => s.marketId === 'uk' && s.store === 'retail')
    const mine = steps.filter((s) => s.familyIds.includes('macbook-pro'))

    expect(mine.length).toBeGreaterThan(1)
    for (const step of steps) {
      expect(costOf(step, all)).not.toBeGreaterThan(REQUESTS_PER_STEP)
      expect(costOf(step, all)).not.toBeGreaterThan(REQUESTS_PER_TICK)
    }

    // Every variant priced exactly once: the slices tile 0..32 with no gap and
    // no overlap, which is what "lost its tail" means when it is wrong.
    const covered = mine
      .map((s) => s.slices!['macbook-pro'])
      .sort((a, b) => a[0] - b[0])
    expect(covered[0][0]).toBe(0)
    expect(covered[covered.length - 1][1]).toBe(32)
    for (let i = 1; i < covered.length; i++) expect(covered[i][0]).toBe(covered[i - 1][1])
  })

  /** One step names each family once, so it cannot carry two of its slices. */
  it('never puts two slices of one family in the same step', () => {
    for (const step of planSweep(structures({ 'macbook-pro': 32, imac: 20 }))) {
      expect(new Set(step.familyIds).size).toBe(step.familyIds.length)
    }
  })

  /**
   * The step holding a family's first variants is the one that clears the last
   * sweep's results, so it has to run before the rest. Plain first-fit does not
   * give that: a small tail slice fits the spare room in an earlier family's
   * final step, while its own head still needs a step of its own further along.
   * The head then ran second and wiped the tail's offers — on a sweep with
   * nothing wrong with it, leaving a family short of builds and reporting
   * success. It takes two families splitting at once, which the catalogue is
   * one Apple announcement away from.
   */
  it('keeps every family’s slices in increasing step order', () => {
    const all = structures({ 'macbook-pro': 32, 'macbook-air': 18, 'mac-studio': 12, imac: 6 })
    for (const market of MARKETS) {
      for (const store of ['retail', 'education'] as const) {
        const steps = planSweep(all).filter((s) => s.marketId === market.id && s.store === store)
        const seen = new Map<string, number>()
        steps.forEach((step, index) => {
          for (const id of step.familyIds) {
            const slice = step.slices?.[id]
            if (!slice) return
            const previous = seen.get(id)
            if (previous !== undefined) {
              expect(index, `${id} in ${market.id}:${store}`).toBeGreaterThan(previous)
            }
            seen.set(id, index)
          }
        })
      }
    }
  })

  /** And the earlier step must be the earlier slice, not merely a different one. */
  it('runs a family’s first variants before its later ones', () => {
    const all = structures({ 'macbook-pro': 32, 'macbook-air': 18 })
    for (const id of ['macbook-pro', 'macbook-air']) {
      const order = planSweep(all)
        .filter((s) => s.marketId === 'uk' && s.store === 'retail' && s.slices?.[id])
        .map((s) => s.slices![id][0])
      expect(order.length).toBeGreaterThan(1)
      expect(order).toEqual([...order].sort((a, b) => a - b))
      expect(order[0]).toBe(0)
    }
  })

  it('covers every market and both stores', () => {
    const steps = planSweep(structures())
    for (const market of MARKETS) {
      expect(steps.some((s) => s.marketId === market.id && s.store === 'retail'), market.id).toBe(true)
      expect(steps.some((s) => s.marketId === market.id && s.store === 'education'), market.id).toBe(true)
    }
  })

  it('prices every family exactly once per market and store', () => {
    const steps = planSweep(structures())
    const retail = steps.filter((s) => s.marketId === 'uk' && s.store === 'retail')
    const seen = retail.flatMap((s) => s.familyIds)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.sort()).toEqual(FAMILIES.map((f) => f.id).sort())
  })

  it('still reaches every family when one of them had to be split', () => {
    const steps = planSweep(structures({ 'macbook-pro': 32 }))
    const seen = steps
      .filter((s) => s.marketId === 'uk' && s.store === 'retail')
      .flatMap((s) => s.familyIds)
    expect(new Set(seen)).toEqual(new Set(FAMILIES.map((f) => f.id)))
  })

  it('does not ask the education store for iPhone, which has no education price', () => {
    const steps = planSweep(structures())
    const eduFamilies = steps.filter((s) => s.store === 'education').flatMap((s) => s.familyIds)
    const iphones = FAMILIES.filter((f) => !hasEducationPricing(f)).map((f) => f.id)
    expect(iphones.length).toBeGreaterThan(0)
    for (const id of iphones) expect(eduFamilies).not.toContain(id)
  })
})

describe('packing efficiency', () => {
  /**
   * Family costs are lopsided, so naive in-order batching strands expensive
   * families in steps of their own. That is not a correctness bug — every step
   * still fits — but it doubled the length of a pass, which is the difference
   * between prices refreshing twice a day and once.
   */
  it('does not leave steps mostly empty', () => {
    const all = structures()
    const steps = planSweep(all)
    const total = steps.reduce((sum, step) => sum + costOf(step, all), 0)
    const perfect = Math.ceil(total / REQUESTS_PER_STEP)
    // Within a third of the theoretical minimum number of steps.
    expect(steps.length).toBeLessThanOrEqual(Math.ceil(perfect * 1.34))
  })
})

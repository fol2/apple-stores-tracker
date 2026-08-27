import { describe, expect, it } from 'vitest'
import { planSweep, familyRequestCost, REQUESTS_PER_STEP } from '../src/shared/plan'

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

const costOf = (step: { familyIds: string[] }, all: FamilyStructure[]) =>
  step.familyIds.reduce((sum, id) => {
    const structure = all.find((s) => s.familyId === id)!
    return sum + familyRequestCost(structure)
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
      // A step may exceed the target only when a single family costs more than
      // it, which cannot be split any further.
      const cost = costOf(step, all)
      expect(step.familyIds.length === 1 || cost, `${step.marketId}:${step.store}`).not.toBeGreaterThan(
        REQUESTS_PER_STEP,
      )
    }
  })

  it('holds even when a family gains chip variants', () => {
    const all = structures({ 'macbook-pro': 12 })
    for (const step of planSweep(all)) {
      if (step.familyIds.length > 1) expect(costOf(step, all)).not.toBeGreaterThan(REQUESTS_PER_STEP)
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

import { describe, expect, it } from 'vitest'
import { familiesReplacedBy, foldStep } from '../../src/worker/sweep-runner'
import type { SweepStep } from '../../src/shared/plan'
import type { Offer } from '../../src/shared/types'

const offer = (familyId: string, configKey: string, amount = 999): Offer => ({
  marketId: 'uk',
  familyId,
  store: 'retail',
  configKey,
  dimensions: [{ field: 'x', value: configKey, label: configKey }],
  amount,
  currency: 'GBP',
  partNumber: null,
  sourceUrl: 'https://www.apple.com/uk/shop',
})

const step = (familyIds: string[], slices?: SweepStep['slices']): SweepStep => ({
  marketId: 'uk',
  store: 'retail',
  familyIds,
  ...(slices ? { slices } : {}),
})

/**
 * A market's slice of the catalogue is built up across many ticks, and a
 * family too expensive for one tick is now spread over several of them. Which
 * of those clears the family's previous results decides whether a MacBook Pro
 * ends the sweep with all thirty-two of its builds or only the last two — and
 * either way the sweep reports success, so nothing else would catch it.
 */
describe('folding a step into the market slice', () => {
  it('replaces a family priced in one step', () => {
    const existing = { offers: [offer('imac', 'a', 1), offer('ipad', 'z')], errors: [] }
    const fresh = { offers: [offer('imac', 'a', 2)], errors: [] }

    const { offers } = foldStep(existing, fresh, step(['imac']))
    expect(offers.filter((o) => o.familyId === 'imac')).toEqual([offer('imac', 'a', 2)])
    // Families this step did not touch are left exactly as they were.
    expect(offers.find((o) => o.familyId === 'ipad')).toEqual(offer('ipad', 'z'))
  })

  it('accumulates the slices of a split family instead of overwriting them', () => {
    const first = foldStep(
      { offers: [offer('macbook-pro', 'stale')], errors: [] },
      { offers: [offer('macbook-pro', 'a'), offer('macbook-pro', 'b')], errors: [] },
      step(['macbook-pro'], { 'macbook-pro': [0, 2] }),
    )
    // The first slice clears what the last sweep left behind.
    expect(first.offers.map((o) => o.configKey)).toEqual(['a', 'b'])

    const second = foldStep(
      first,
      { offers: [offer('macbook-pro', 'c')], errors: [] },
      step(['macbook-pro'], { 'macbook-pro': [2, 3] }),
    )
    expect(second.offers.map((o) => o.configKey)).toEqual(['a', 'b', 'c'])
  })

  it('carries the errors the same way', () => {
    const first = foldStep(
      { offers: [], errors: [{ marketId: 'uk', store: 'retail' as const, familyId: 'macbook-pro', message: 'old' }] },
      { offers: [], errors: [{ marketId: 'uk', store: 'retail' as const, familyId: 'macbook-pro', message: 'one' }] },
      step(['macbook-pro'], { 'macbook-pro': [0, 2] }),
    )
    expect(first.errors.map((e) => e.message)).toEqual(['one'])

    const second = foldStep(
      first,
      { offers: [], errors: [{ marketId: 'uk', store: 'retail' as const, familyId: 'macbook-pro', message: 'two' }] },
      step(['macbook-pro'], { 'macbook-pro': [2, 3] }),
    )
    expect(second.errors.map((e) => e.message)).toEqual(['one', 'two'])
  })

  it('knows which families a step starts over', () => {
    expect(familiesReplacedBy(step(['imac', 'ipad']))).toEqual(['imac', 'ipad'])
    expect(familiesReplacedBy(step(['macbook-pro'], { 'macbook-pro': [0, 15] }))).toEqual([
      'macbook-pro',
    ])
    expect(familiesReplacedBy(step(['macbook-pro'], { 'macbook-pro': [15, 30] }))).toEqual([])
    // A step can mix a fresh family with a later slice of a split one.
    expect(
      familiesReplacedBy(step(['macbook-pro', 'homepod'], { 'macbook-pro': [30, 32] })),
    ).toEqual(['homepod'])
  })
})

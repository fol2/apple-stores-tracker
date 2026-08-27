import { describe, expect, it } from 'vitest'
import { compare, toBase } from '../src/shared/convert'
import { afterRefund, refundPolicy } from '../src/shared/refunds'
import { changedPoints } from '../src/shared/diff'
import { MARKETS } from '../src/shared/markets'
import type { FxRates, Offer } from '../src/shared/types'

const fx: FxRates = {
  base: 'GBP',
  fetchedAt: '2026-08-27T00:00:00.000Z',
  rates: { USD: 1.36, JPY: 216.64, EUR: 1.167, AUD: 1.896 },
}

const offer = (marketId: string, currency: string, amount: number): Offer => ({
  marketId,
  familyId: 'mac-mini',
  configKey: 'memory-dimensionMemory=24gb|storage-dimensionCapacity=512gb',
  dimensions: [],
  amount,
  currency,
  partNumber: null,
  sourceUrl: 'https://www.apple.com/shop/buy-mac/mac-mini',
})

describe('toBase', () => {
  it('passes base-currency amounts through untouched', () => {
    expect(toBase(1299, 'GBP', fx)).toBe(1299)
  })

  it('divides by the rate, since rates are quoted per unit of base', () => {
    expect(toBase(1360, 'USD', fx)).toBeCloseTo(1000, 6)
  })

  it('returns null for a currency with no rate rather than guessing', () => {
    expect(toBase(100, 'ZWL', fx)).toBeNull()
  })
})

describe('refund policies', () => {
  it('covers every market, so no market silently defaults', () => {
    for (const market of MARKETS) {
      expect(refundPolicy(market.id).note.length, market.id).toBeGreaterThan(0)
    }
  })

  it('leaves the price alone where no refund scheme exists', () => {
    expect(afterRefund(1299, refundPolicy('uk'))).toBe(1299)
    expect(afterRefund(999, refundPolicy('us'))).toBe(999)
  })

  it('refunds the consumption tax out of a tax-inclusive Japanese price', () => {
    // 10% tax inside a 149,800 yen price is 13,618; the rest is the net price.
    expect(afterRefund(149_800, refundPolicy('jp'))).toBeCloseTo(136_181.8, 1)
  })

  it('takes the 20% processing fee off Taiwan 5% business tax', () => {
    expect(refundPolicy('tw').rate).toBeCloseTo(0.0381, 4)
  })

  it('never refunds a price below zero', () => {
    expect(afterRefund(0, refundPolicy('jp'))).toBe(0)
  })
})

describe('compare', () => {
  const offers = [
    offer('uk', 'GBP', 1299),
    offer('us', 'USD', 1299),
    offer('jp', 'JPY', 199_800),
    offer('de', 'EUR', 1549),
  ]

  it('ranks markets cheapest first in the base currency', () => {
    const { rows, cheapest } = compare(offers, fx)
    // 199,800 yen is about 922 GBP; 1,299 USD about 955; 1,549 EUR about 1,327.
    expect(cheapest?.market.id).toBe('jp')
    expect(rows.filter((r) => r.offer).map((r) => r.market.id)).toEqual(['jp', 'us', 'uk', 'de'])
  })

  it('reports the spread between dearest and cheapest', () => {
    const { spread } = compare(offers, fx)
    expect(spread).toBeCloseTo(1549 / 1.167 - 199_800 / 216.64, 6)
  })

  it('re-ranks once refunds are applied', () => {
    // Japan refunds 10/110 while the US refunds nothing, which closes the gap.
    const plain = compare(offers, fx).rows.find((r) => r.market.id === 'jp')!
    const refunded = compare(offers, fx, { applyRefunds: true }).rows.find(
      (r) => r.market.id === 'jp',
    )!
    expect(refunded.baseAmount!).toBeLessThan(plain.baseAmount!)
    expect(compare(offers, fx, { applyRefunds: true }).rows[0].market.id).toBe('jp')
  })

  it('lists every market, so a gap reads as a gap and not as absence', () => {
    const { rows } = compare(offers, fx)
    expect(rows).toHaveLength(MARKETS.length)
    const notSold = rows.find((r) => r.market.id === 'sg')!
    expect(notSold.offer).toBeUndefined()
    expect(notSold.baseAmount).toBeNull()
  })

  it('ranks markets with no rate last, but still shows them', () => {
    const { rows, covered } = compare([...offers, offer('th', 'THB', 46_900)], fx)
    expect(covered).toBe(4)
    const thailand = rows.find((r) => r.market.id === 'th')!
    expect(thailand.offer).toBeDefined()
    expect(thailand.baseAmount).toBeNull()
  })
})

describe('changedPoints', () => {
  const today = '2026-08-27'

  it('records every configuration the first time it is seen', () => {
    expect(changedPoints([], [offer('uk', 'GBP', 1299)], today)).toHaveLength(1)
  })

  it('writes nothing when nothing moved', () => {
    const same = [offer('uk', 'GBP', 1299), offer('us', 'USD', 1299)]
    expect(changedPoints(same, same, today)).toEqual([])
  })

  it('writes only the row that actually changed', () => {
    const before = [offer('uk', 'GBP', 1299), offer('us', 'USD', 1299)]
    const after = [offer('uk', 'GBP', 1199), offer('us', 'USD', 1299)]
    const points = changedPoints(before, after, today)
    expect(points).toHaveLength(1)
    expect(points[0]).toMatchObject({ marketId: 'uk', amount: 1199, observedOn: today })
  })

  it('does not confuse two markets holding the same configuration', () => {
    const before = [offer('uk', 'GBP', 1299)]
    const after = [offer('uk', 'GBP', 1299), offer('de', 'EUR', 1299)]
    expect(changedPoints(before, after, today).map((p) => p.marketId)).toEqual(['de'])
  })

  it('leaves a withdrawn configuration alone instead of writing a zero', () => {
    expect(changedPoints([offer('uk', 'GBP', 1299)], [], today)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import { compare, convertBetween, toBase } from '../src/shared/convert'
import { afterRefund, refundPolicy } from '../src/shared/refunds'
import { changedPoints } from '../src/shared/diff'
import { MARKETS } from '../src/shared/markets'
import type { FxRates, Offer } from '../src/shared/types'

const fx: FxRates = {
  base: 'GBP',
  fetchedAt: '2026-08-27T00:00:00.000Z',
  rates: { USD: 1.36, JPY: 216.64, EUR: 1.167, AUD: 1.896 },
}

const offer = (
  marketId: string,
  currency: string,
  amount: number,
  store: 'retail' | 'education' = 'retail',
): Offer => ({
  marketId,
  familyId: 'mac-mini',
  store,
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

  it('refunds the GST component out of a tax-inclusive Australian price', () => {
    // 10% GST inside a A$1,449 price is A$131.73; the rest is the net price.
    expect(afterRefund(1449, refundPolicy('au'))).toBeCloseTo(1317.27, 2)
  })

  it('takes the 20% processing fee off Taiwan 5% business tax', () => {
    expect(refundPolicy('tw').rate).toBeCloseTo(0.0381, 4)
  })

  it('never refunds a price below zero', () => {
    expect(afterRefund(0, refundPolicy('au'))).toBe(0)
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
    // Australia refunds the 10% GST while the US refunds nothing.
    const withAu = [...offers, offer('au', 'AUD', 1899)]
    const plain = compare(withAu, fx).rows.find((r) => r.market.id === 'au')!
    const refunded = compare(withAu, fx, { applyRefunds: true }).rows.find(
      (r) => r.market.id === 'au',
    )!
    expect(refunded.displayAmount!).toBeLessThan(plain.displayAmount!)
  })

  it('lists every market, so a gap reads as a gap and not as absence', () => {
    const { rows } = compare(offers, fx)
    expect(rows).toHaveLength(MARKETS.length)
    const notSold = rows.find((r) => r.market.id === 'sg')!
    expect(notSold.offer).toBeUndefined()
    expect(notSold.displayAmount).toBeNull()
  })

  it('ranks markets with no rate last, but still shows them', () => {
    const { rows, covered } = compare([...offers, offer('th', 'THB', 46_900)], fx)
    expect(covered).toBe(4)
    const thailand = rows.find((r) => r.market.id === 'th')!
    expect(thailand.offer).toBeDefined()
    expect(thailand.displayAmount).toBeNull()
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

describe('convertBetween', () => {
  it('returns the amount unchanged when the currencies match', () => {
    expect(convertBetween(1299, 'JPY', 'JPY', fx)).toBe(1299)
  })

  it('converts through the base the rates are quoted against', () => {
    // 1,360 USD is 1,000 GBP, which is 216,640 JPY.
    expect(convertBetween(1360, 'USD', 'JPY', fx)).toBeCloseTo(216_640, 4)
  })

  it('round-trips back to where it started', () => {
    const there = convertBetween(999, 'EUR', 'AUD', fx)!
    expect(convertBetween(there, 'AUD', 'EUR', fx)).toBeCloseTo(999, 6)
  })

  it('returns null when either side has no rate', () => {
    expect(convertBetween(100, 'ZWL', 'GBP', fx)).toBeNull()
    expect(convertBetween(100, 'GBP', 'ZWL', fx)).toBeNull()
  })

  it('cannot reorder markets, since it scales every price alike', () => {
    const offers = [offer('us', 'USD', 1299), offer('jp', 'JPY', 199_800), offer('de', 'EUR', 1549)]
    const ranked = compare(offers, fx).rows.filter((r) => r.offer)
    const inJpy = ranked.map((r) => convertBetween(r.offer!.amount, r.offer!.currency, 'JPY', fx)!)
    expect(inJpy).toEqual([...inJpy].sort((a, b) => a - b))
  })
})

describe('refund policy confidence', () => {
  it('reports no refund for Japan, where Apple withdrew from the scheme', () => {
    expect(refundPolicy('jp').available).toBe(false)
    expect(afterRefund(149_800, refundPolicy('jp'))).toBe(149_800)
  })

  it('marks every offered refund as confirmed at Apple or not', () => {
    for (const market of MARKETS) {
      const policy = refundPolicy(market.id)
      if (!policy.available) continue
      expect(typeof policy.appleConfirmed, market.id).toBe('boolean')
    }
  })

  it('never claims Apple participation where the refund is unavailable', () => {
    for (const market of MARKETS) {
      const policy = refundPolicy(market.id)
      if (!policy.available) expect(policy.appleConfirmed, market.id).toBe(false)
    }
  })
})

describe('education pricing', () => {
  const offers = [
    offer('uk', 'GBP', 899),
    offer('uk', 'GBP', 799, 'education'),
    offer('us', 'USD', 899),
    offer('us', 'USD', 799, 'education'),
  ]

  it('quotes retail everywhere when no market is claimed', () => {
    const { rows } = compare(offers, fx)
    expect(rows.filter((r) => r.isEducation)).toHaveLength(0)
    expect(rows.find((r) => r.market.id === 'uk')!.offer!.amount).toBe(899)
    expect(rows).toHaveLength(MARKETS.length)
  })

  it('adds a row for the claimed market rather than replacing one', () => {
    const { rows } = compare(offers, fx, { educationMarketId: 'uk' })
    const uk = rows.filter((r) => r.market.id === 'uk')
    // Both prices stay visible, so the discount reads as a gap.
    expect(uk).toHaveLength(2)
    expect(uk.find((r) => r.isEducation)!.offer!.amount).toBe(799)
    expect(uk.find((r) => !r.isEducation)!.offer!.amount).toBe(899)
  })

  it('claims one market only, since you study in one country', () => {
    const { rows } = compare(offers, fx, { educationMarketId: 'uk' })
    expect(rows.filter((r) => r.isEducation).map((r) => r.market.id)).toEqual(['uk'])
    expect(rows.filter((r) => r.market.id === 'us')).toHaveLength(1)
  })

  it('records what retail costs, so the saving can be shown', () => {
    const { rows } = compare(offers, fx, { educationMarketId: 'uk' })
    const edu = rows.find((r) => r.isEducation)!
    expect(edu.retailDisplayAmount).toBe(899)
    expect(edu.retailDisplayAmount! - edu.displayAmount!).toBe(100)
  })

  it('adds no row where Apple has no education price', () => {
    const { rows } = compare([offer('de', 'EUR', 1049)], fx, { educationMarketId: 'de' })
    expect(rows.filter((r) => r.market.id === 'de')).toHaveLength(1)
    expect(rows.some((r) => r.isEducation)).toBe(false)
  })

  it('ranks the education row on price like any other', () => {
    const { rows } = compare(offers, fx, { educationMarketId: 'uk' })
    const amounts = rows.filter((r) => r.offer).map((r) => r.displayAmount!)
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b))
  })
})

describe('display currency', () => {
  const offers = [offer('us', 'USD', 1299), offer('jp', 'JPY', 199_800)]

  it('reports every figure in the requested currency', () => {
    const { rows, currency } = compare(offers, fx, { currency: 'JPY' })
    expect(currency).toBe('JPY')
    const us = rows.find((r) => r.market.id === 'us')!
    expect(us.displayAmount).toBeCloseTo((1299 / 1.36) * 216.64, 4)
  })

  it('keeps the same ranking whichever currency is chosen', () => {
    const inGbp = compare(offers, fx).rows.filter((r) => r.offer).map((r) => r.market.id)
    const inJpy = compare(offers, fx, { currency: 'JPY' }).rows
      .filter((r) => r.offer)
      .map((r) => r.market.id)
    expect(inJpy).toEqual(inGbp)
  })
})

describe('offers written before education pricing existed', () => {
  /**
   * The regression this pins: a snapshot collected by an older version has no
   * `store` field, and code that filters for `store === 'retail'` drops every
   * one of its offers. On the live site that emptied the comparison and left
   * the page loading forever, so the fallback belongs in the domain layer too.
   */
  const { store: _dropped, ...legacy } = offer('uk', 'GBP', 899)

  it('still ranks when the store is unknown', () => {
    const { rows } = compare([legacy as unknown as Offer], fx)
    const uk = rows.find((r) => r.market.id === 'uk')!
    expect(uk.offer?.amount).toBe(899)
    expect(uk.isEducation).toBe(false)
  })
})
